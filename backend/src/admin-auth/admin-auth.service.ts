import { Inject, Injectable } from '@nestjs/common';
import { type AuditContext, AuditService } from '../audit/audit.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { TokensService } from '../auth/tokens.service.js';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/http/api-error.js';
import { SecretBox } from '../common/crypto/secret-box.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../common/crypto/totp.js';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { dummyHash, hashPassword, passwordProblems, verifyPassword } from './passwords.js';

export const ADMIN_LOCKOUT = { maxFailures: 5, lockMinutes: 15 };
const INVALID = () => new AppError(401, 'INVALID_CREDENTIALS', 'Adresse e-mail, mot de passe ou code incorrect.');

@Injectable()
export class AdminAuthService {
  private readonly box: SecretBox;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    private readonly sessions: SessionsService,
    private readonly limiter: RateLimiterService,
    private readonly redis: RedisService,
    private readonly audit: AuditService,
    @Inject(ENV) env: Env,
  ) {
    this.box = new SecretBox(env.DATA_ENCRYPTION_KEY_B64);
  }

  /** Étape 1 : mot de passe. Retourne un ticket pour l'étape TOTP (et, au premier passage, la graine à enregistrer). */
  async login(email: string, password: string, ctx: AuditContext) {
    const normalized = email.trim().toLowerCase();
    await this.limiter.consume({ name: 'admin-login:ip', limit: 20, windowSeconds: 3600 }, ctx.ip ?? 'inconnue');
    await this.limiter.consume({ name: 'admin-login:email', limit: 10, windowSeconds: 900 }, normalized);
    const user = await this.prisma.user.findFirst({
      where: { email: normalized, status: 'ACTIVE', userRoles: { some: { role: { code: { startsWith: 'ADMIN_' } } } } },
      include: { adminCredential: true },
    });
    const cred = user?.adminCredential;
    if (!user || !cred) {
      await verifyPassword(await dummyHash(), password);
      throw INVALID();
    }
    if (cred.lockedUntil && cred.lockedUntil.getTime() > Date.now()) {
      const minutes = Math.ceil((cred.lockedUntil.getTime() - Date.now()) / 60_000);
      throw new AppError(429, 'ACCOUNT_LOCKED', `Compte temporairement bloqué après plusieurs échecs. Réessayez dans ${minutes} min.`, { retryAfterSeconds: minutes * 60 });
    }
    if (!(await verifyPassword(cred.passwordHash, password))) {
      const failures = cred.failedAttempts + 1;
      await this.prisma.adminCredential.update({
        where: { userId: user.id },
        data: failures >= ADMIN_LOCKOUT.maxFailures
          ? { failedAttempts: 0, lockedUntil: new Date(Date.now() + ADMIN_LOCKOUT.lockMinutes * 60_000) }
          : { failedAttempts: failures },
      });
      await this.audit.record({ ...ctx, actorId: user.id }, { action: 'admin.login_failed', entityType: 'user', entityId: user.id, after: { failures } });
      throw INVALID();
    }
    await this.prisma.adminCredential.update({ where: { userId: user.id }, data: { failedAttempts: 0, lockedUntil: null } });
    const mfaToken = await this.tokens.signMfaTicket(user.id);
    if (cred.totpEnabledAt && cred.totpSecretEnc) return { mfaToken, totpSetupRequired: false as const };
    // Première connexion : nouvelle graine TOTP, activée seulement après saisie d'un code valide.
    const secret = generateTotpSecret();
    await this.prisma.adminCredential.update({ where: { userId: user.id }, data: { totpSecretEnc: this.box.seal(secret), totpEnabledAt: null } });
    return { mfaToken, totpSetupRequired: true as const, totpSecret: secret, otpauthUrl: otpauthUrl(secret, normalized) };
  }

  /** Étape 2 : code TOTP. Active la double authentification au premier passage, puis ouvre une session ADMIN. */
  async verifyTotp(mfaToken: string, code: string, ctx: AuditContext) {
    const userId = await this.tokens.verifyMfaTicket(mfaToken);
    await this.limiter.consume({ name: 'admin-totp:user', limit: 10, windowSeconds: 900 }, userId);
    const cred = await this.prisma.adminCredential.findUnique({ where: { userId } });
    if (!cred?.totpSecretEnc) throw INVALID();
    const secret = this.box.open(cred.totpSecretEnc);
    if (!verifyTotp(secret, code)) {
      await this.audit.record({ ...ctx, actorId: userId }, { action: 'admin.totp_failed', entityType: 'user', entityId: userId });
      throw INVALID();
    }
    // Un code TOTP ne peut servir qu'une fois (protection contre le rejeu pendant sa fenêtre de validité).
    const fresh = await this.redis.client.set(`ineed:totp-used:${userId}:${code}`, '1', 'EX', 120, 'NX');
    if (fresh !== 'OK') throw INVALID();
    return this.prisma.$transaction(async (tx) => {
      if (!cred.totpEnabledAt) await tx.adminCredential.update({ where: { userId }, data: { totpEnabledAt: new Date() } });
      const tokens = await this.sessions.open(userId, 'ADMIN', { ip: ctx.ip, userAgent: ctx.userAgent, deviceLabel: 'Administration web' }, tx);
      await this.audit.record({ ...ctx, actorId: userId }, { action: cred.totpEnabledAt ? 'admin.login' : 'admin.totp_enabled', entityType: 'user', entityId: userId }, tx);
      return tokens;
    });
  }

  async changePassword(userId: string, current: string, next: string, ctx: AuditContext) {
    const cred = await this.prisma.adminCredential.findUnique({ where: { userId } });
    if (!cred || !(await verifyPassword(cred.passwordHash, current))) throw INVALID();
    const problems = passwordProblems(next);
    if (problems.length) throw new AppError(422, 'WEAK_PASSWORD', `Le nouveau mot de passe doit contenir ${problems.join(' et ')}.`);
    await this.prisma.adminCredential.update({ where: { userId }, data: { passwordHash: await hashPassword(next), passwordChangedAt: new Date() } });
    await this.audit.record(ctx, { action: 'admin.password_changed', entityType: 'user', entityId: userId });
  }
}
