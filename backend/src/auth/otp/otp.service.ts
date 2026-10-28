import { Inject, Injectable } from '@nestjs/common';
import { AppError } from '../../common/http/api-error.js';
import { RateLimiterService } from '../../common/rate-limit/rate-limiter.service.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { SettingsService } from '../../settings/settings.service.js';
import { OTP_PROVIDER, type OtpProvider } from './otp-provider.js';

export type OtpPurpose = 'LOGIN' | 'PHONE_CHANGE' | 'ACCOUNT_DELETION';

export interface OtpChallengeView {
  challengeId: string;
  expiresAt: string;
  resendAvailableAt: string;
  /** Vrai si aucun SMS n'est réellement envoyé (fournisseur de développement). */
  devMode: boolean;
}

export const OTP_LIMITS = {
  perPhone: { name: 'otp:phone', limit: 3, windowSeconds: 600 },
  perIp: { name: 'otp:ip', limit: 10, windowSeconds: 3600 },
  verifyPerIp: { name: 'otp-verify:ip', limit: 30, windowSeconds: 3600 },
  resendCooldownSeconds: 60,
} as const;

@Injectable()
export class OtpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly limiter: RateLimiterService,
    @Inject(OTP_PROVIDER) private readonly provider: OtpProvider,
  ) {}

  get isDevelopment(): boolean {
    return this.provider.isDevelopment;
  }

  async request(phone: string, purpose: OtpPurpose, ip: string): Promise<OtpChallengeView> {
    await this.limiter.consume(OTP_LIMITS.perIp, ip);
    const last = await this.prisma.otpChallenge.findFirst({ where: { phoneE164: phone, purpose }, orderBy: { createdAt: 'desc' } });
    const cooldownMs = OTP_LIMITS.resendCooldownSeconds * 1000;
    if (last && Date.now() - last.createdAt.getTime() < cooldownMs) {
      const retryAfterSeconds = Math.ceil((cooldownMs - (Date.now() - last.createdAt.getTime())) / 1000);
      throw new AppError(429, 'OTP_RESEND_TOO_SOON', `Patientez ${retryAfterSeconds} s avant de demander un nouveau code.`, { retryAfterSeconds });
    }
    await this.limiter.consume(OTP_LIMITS.perPhone, phone);

    const ttlMinutes = await this.settings.number('otp.ttl_minutes', 10);
    const maxAttempts = await this.settings.number('otp.max_attempts', 5);
    const started = await this.provider.start(phone);
    const challenge = await this.prisma.otpChallenge.create({
      data: {
        phoneE164: phone,
        purpose,
        provider: this.provider.name,
        codeHash: started.codeHash ?? null,
        providerRef: started.providerRef ?? null,
        maxAttempts,
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
        ip,
      },
    });
    return {
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      resendAvailableAt: new Date(challenge.createdAt.getTime() + cooldownMs).toISOString(),
      devMode: this.provider.isDevelopment,
    };
  }

  /**
   * Vérifie un code et consomme le défi. Retourne le numéro vérifié.
   * Chaque essai erroné est compté même si la requête échoue ; deux vérifications simultanées
   * du même défi sont sérialisées (verrou de ligne) : un code ne sert qu'une fois.
   */
  async verify(challengeId: string, code: string, purpose: OtpPurpose, ip: string, expectedPhone?: string): Promise<string> {
    await this.limiter.consume(OTP_LIMITS.verifyPerIp, ip);
    const outcome = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; phone_e164: string; purpose: string; code_hash: string | null; provider_ref: string | null; attempts: number; max_attempts: number; expires_at: Date; consumed_at: Date | null }[]
      >`SELECT id, phone_e164, purpose, code_hash, provider_ref, attempts, max_attempts, expires_at, consumed_at
          FROM otp_challenges WHERE id = ${challengeId}::uuid FOR UPDATE`;
      const c = rows[0];
      if (!c || c.purpose !== purpose || (expectedPhone && c.phone_e164 !== expectedPhone)) return { kind: 'not_found' as const };
      if (c.consumed_at || c.expires_at.getTime() <= Date.now()) return { kind: 'expired' as const };
      if (c.attempts >= c.max_attempts) return { kind: 'locked' as const };
      const ok = await this.provider.check(c.phone_e164, code, { codeHash: c.code_hash, providerRef: c.provider_ref });
      if (!ok) {
        await tx.otpChallenge.update({ where: { id: c.id }, data: { attempts: { increment: 1 } } });
        const left = c.max_attempts - c.attempts - 1;
        return left > 0 ? { kind: 'wrong' as const, attemptsLeft: left } : { kind: 'locked' as const };
      }
      await tx.otpChallenge.update({ where: { id: c.id }, data: { consumedAt: new Date(), attempts: { increment: 1 } } });
      return { kind: 'ok' as const, phone: c.phone_e164 };
    });
    switch (outcome.kind) {
      case 'ok':
        return outcome.phone;
      case 'wrong':
        throw new AppError(400, 'OTP_INVALID', 'Code incorrect.', { attemptsLeft: outcome.attemptsLeft });
      case 'locked':
        throw new AppError(429, 'OTP_TOO_MANY_ATTEMPTS', 'Trop d’essais pour ce code. Demandez-en un nouveau.');
      case 'expired':
        throw new AppError(400, 'OTP_EXPIRED', 'Ce code a expiré. Demandez-en un nouveau.');
      default:
        throw new AppError(400, 'OTP_NOT_FOUND', 'Ce code n’est plus valable. Demandez-en un nouveau.');
    }
  }
}
