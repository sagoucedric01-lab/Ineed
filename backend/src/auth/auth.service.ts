import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/http/api-error.js';
import { normalizePhone, InvalidPhoneError } from '../common/phone/phone.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { AppKind } from './auth-user.js';
import { OtpService, type OtpChallengeView } from './otp/otp.service.js';
import { type IssuedTokens, type SessionMeta, SessionsService } from './sessions.service.js';

export interface LoginResult {
  tokens: IssuedTokens;
  user: { id: string; phone: string; firstName: string | null; lastName: string | null; roles: string[] };
  isNewUser: boolean;
  profileComplete: boolean;
}

export function parsePhoneOrThrow(input: string): string {
  try {
    return normalizePhone(input);
  } catch (e) {
    if (e instanceof InvalidPhoneError) throw new AppError(422, 'INVALID_PHONE', e.message);
    throw e;
  }
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  requestLoginCode(rawPhone: string, ip: string): Promise<OtpChallengeView> {
    return this.otp.request(parsePhoneOrThrow(rawPhone), 'LOGIN', ip);
  }

  /**
   * Connexion par code SMS. Le compte est créé à la première connexion (numéro vérifié) ;
   * le rôle correspondant à l'application (CLIENT ou PRO) est ajouté s'il manque.
   */
  async loginWithCode(challengeId: string, code: string, app: Exclude<AppKind, 'ADMIN'>, meta: SessionMeta): Promise<LoginResult> {
    const phone = await this.otp.verify(challengeId, code, 'LOGIN', meta.ip ?? 'inconnue');
    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phoneE164: phone } });
      if (existing && existing.status === 'SUSPENDED') {
        throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Votre compte est suspendu. Contactez l’assistance Ineed.');
      }
      const city = await tx.city.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } });
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { phoneVerifiedAt: existing.phoneVerifiedAt ?? new Date() } })
        : await tx.user.create({ data: { phoneE164: phone, phoneVerifiedAt: new Date(), homeCityId: city?.id ?? null } });
      const role = await tx.role.findUniqueOrThrow({ where: { code: app } });
      await tx.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId: role.id } },
        create: { userId: user.id, roleId: role.id },
        update: {},
      });
      const roles = (await tx.userRole.findMany({ where: { userId: user.id }, include: { role: true } })).map((r) => r.role.code);
      const tokens = await this.sessions.open(user.id, app, meta, tx);
      await this.audit.record(
        { actorId: user.id, actorRoles: roles, ip: meta.ip, userAgent: meta.userAgent },
        { action: existing ? 'auth.login' : 'auth.signup', entityType: 'user', entityId: user.id, after: { app } },
        tx,
      );
      return {
        tokens,
        user: { id: user.id, phone, firstName: user.firstName, lastName: user.lastName, roles },
        isNewUser: !existing,
        profileComplete: !!(user.firstName && user.lastName),
      };
    });
  }
}
