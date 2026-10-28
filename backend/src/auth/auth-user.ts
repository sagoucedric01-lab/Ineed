export type AppKind = 'CLIENT' | 'PRO' | 'ADMIN';

/** Utilisateur authentifié attaché à la requête par AccessGuard (rôles et permissions relus en base à chaque requête). */
export interface AuthUser {
  userId: string;
  familyId: string;
  app: AppKind;
  roles: string[];
  permissions: Set<string>;
}
