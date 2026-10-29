import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError } from '../common/http/api-error.js';
import type { AppRequest } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { AuthUser } from './auth-user.js';
import { ACCESS_RULE, type AccessRule, IS_PUBLIC } from './decorators.js';
import { TokensService } from './tokens.service.js';

const FORBIDDEN = () => new AppError(403, 'FORBIDDEN', 'Vous n’avez pas accès à cette information.');

/**
 * Garde globale : toute route exige un jeton d'accès valide, sauf si elle est marquée @Public().
 * À chaque requête, la session (famille) et le statut du compte sont relus en base : une déconnexion,
 * une suspension ou un retrait de rôle prennent effet immédiatement.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const header = req.headers.authorization;
    const match = typeof header === 'string' ? /^Bearer ([A-Za-z0-9._-]+)$/.exec(header) : null;
    if (!match) throw new AppError(401, 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous pour continuer.');
    const user = await this.authenticate(match[1]!);
    req.user = user;

    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE, targets);
    if (!rule) return true;
    if (rule.app && user.app !== rule.app) throw FORBIDDEN();
    if (rule.roles?.length && !rule.roles.some((r) => user.roles.includes(r))) throw FORBIDDEN();
    if (rule.permissions?.length && !rule.permissions.every((p) => user.permissions.has(p))) throw FORBIDDEN();
    return true;
  }

  /** Vérifie un jeton d'accès et relit en base la session et le compte (aussi utilisé par la connexion temps réel). */
  async authenticate(token: string): Promise<AuthUser> {
    const claims = await this.tokens.verifyAccess(token);
    const rows = await this.prisma.$queryRaw<{ status: string; roles: string[] | null; permissions: string[] | null; session_ok: boolean }[]>`
      SELECT u.status,
             array_remove(array_agg(DISTINCT r.code), NULL) AS roles,
             array_remove(array_agg(DISTINCT rp.permission_code), NULL) AS permissions,
             EXISTS (SELECT 1 FROM sessions s WHERE s.family_id = ${claims.fid}::uuid AND s.user_id = u.id
                       AND s.app = ${claims.app}::app_kind AND s.revoked_at IS NULL AND s.expires_at > now()) AS session_ok
        FROM users u
        LEFT JOIN user_roles ur ON ur.user_id = u.id
        LEFT JOIN roles r ON r.id = ur.role_id
        LEFT JOIN role_permissions rp ON rp.role_id = r.id
       WHERE u.id = ${claims.sub}::uuid
       GROUP BY u.id`;
    const row = rows[0];
    if (!row || !row.session_ok) throw new AppError(401, 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous pour continuer.');
    if (row.status === 'SUSPENDED') throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Votre compte est suspendu. Contactez l’assistance Ineed.');
    if (row.status !== 'ACTIVE') throw new AppError(401, 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous pour continuer.');
    return { userId: claims.sub, familyId: claims.fid, app: claims.app, roles: row.roles ?? [], permissions: new Set(row.permissions ?? []) };
  }
}
