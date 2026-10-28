import type { Request } from 'express';
import type { AuditContext } from '../../audit/audit.service.js';
import type { AuthUser } from '../../auth/auth-user.js';

export type AppRequest = Request & { id?: string; user?: AuthUser };

/** Adresse IP du client (derrière le proxy de confiance configuré dans Express). */
export function clientIp(req: AppRequest): string {
  return req.ip ?? req.socket.remoteAddress ?? 'inconnue';
}

export function auditContext(req: AppRequest): AuditContext {
  return {
    actorId: req.user?.userId ?? null,
    actorRoles: req.user?.roles ?? [],
    ip: req.ip ?? null,
    userAgent: req.headers['user-agent']?.slice(0, 300) ?? null,
    requestId: typeof req.id === 'string' ? req.id : null,
  };
}
