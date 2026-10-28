import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AppKind, AuthUser } from './auth-user.js';

export const IS_PUBLIC = 'ineed:public';
export const ACCESS_RULE = 'ineed:access';

export interface AccessRule {
  /** Application dont doit provenir la session (CLIENT, PRO ou ADMIN). */
  app?: AppKind;
  /** L'utilisateur doit avoir au moins un de ces rôles. */
  roles?: string[];
  /** L'utilisateur doit avoir toutes ces permissions. */
  permissions?: string[];
}

/** Route accessible sans authentification. Toute autre route exige un jeton valide (garde globale). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Access = (rule: AccessRule) => SetMetadata(ACCESS_RULE, rule);

/** Route d'administration : session ADMIN (mot de passe + double authentification) et permission explicite. */
export const AdminOnly = (...permissions: [string, ...string[]]) => Access({ app: 'ADMIN', permissions });

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
  if (!req.user) throw new Error('CurrentUser utilisé sur une route publique');
  return req.user;
});
