import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env.js';
import { AppError } from '../common/http/api-error.js';
import { opaqueToken, sha256 } from '../common/crypto/tokens.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { AppKind } from './auth-user.js';
import { TokensService } from './tokens.service.js';

export interface SessionMeta {
  ip?: string | null;
  userAgent?: string | null;
  deviceLabel?: string | null;
}

export interface IssuedTokens {
  tokenType: 'Bearer';
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
}

/** Délai pendant lequel la réutilisation d'un jeton déjà échangé est tolérée (requêtes concurrentes, réseau). */
export const ROTATION_GRACE_MS = 10_000;

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Sessions par appareil (« familles »). Chaque échange de jeton de rafraîchissement crée une nouvelle ligne
 * de la même famille et révoque la précédente. Si un jeton déjà échangé est présenté à nouveau (vol probable),
 * toute la famille est révoquée.
 */
@Injectable()
export class SessionsService {
  private readonly logger = new Logger('Sessions');

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private refreshTtlMs(app: AppKind): number {
    return app === 'ADMIN' ? this.env.ADMIN_REFRESH_TOKEN_TTL_HOURS * 3_600_000 : this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  }

  async open(userId: string, app: AppKind, meta: SessionMeta, db: Db = this.prisma): Promise<IssuedTokens> {
    return this.issue(db, { userId, app, familyId: randomUUID(), meta });
  }

  /** Expiration glissante : chaque rotation repousse l'échéance (60 jours sans activité, 12 h pour l'admin). */
  private async issue(db: Db, p: { userId: string; app: AppKind; familyId: string; meta: SessionMeta }): Promise<IssuedTokens> {
    const refreshToken = opaqueToken();
    const expiresAt = new Date(Date.now() + this.refreshTtlMs(p.app));
    await db.session.create({
      data: {
        userId: p.userId,
        app: p.app,
        familyId: p.familyId,
        refreshTokenHash: sha256(refreshToken),
        deviceLabel: p.meta.deviceLabel?.slice(0, 120) ?? null,
        ip: p.meta.ip ?? null,
        userAgent: p.meta.userAgent?.slice(0, 300) ?? null,
        expiresAt,
      },
    });
    const access = await this.tokens.signAccess({ sub: p.userId, fid: p.familyId, app: p.app });
    return {
      tokenType: 'Bearer',
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  /** Échange un jeton de rafraîchissement contre une nouvelle paire (rotation). */
  async rotate(refreshToken: string, meta: SessionMeta): Promise<IssuedTokens> {
    const hash = sha256(refreshToken);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; user_id: string; app: AppKind; family_id: string; expires_at: Date; revoked_at: Date | null; revoked_reason: string | null; device_label: string | null; status: string }[]
      >`SELECT s.id, s.user_id, s.app, s.family_id, s.expires_at, s.revoked_at, s.revoked_reason, s.device_label, u.status
          FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.refresh_token_hash = ${hash} FOR UPDATE OF s`;
      const s = rows[0];
      const invalid = new AppError(401, 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous pour continuer.');
      if (!s) throw invalid;
      if (s.revoked_at) {
        if (s.revoked_reason === 'ROTATED' && Date.now() - s.revoked_at.getTime() > ROTATION_GRACE_MS) {
          // Jeton déjà échangé présenté de nouveau : on coupe tous les appareils de cette famille.
          await this.revokeFamily(s.family_id, 'REUSE_DETECTED', tx);
          this.logger.warn({ familyId: s.family_id, userId: s.user_id }, 'Réutilisation d’un jeton de rafraîchissement : session révoquée');
        }
        throw invalid;
      }
      if (s.expires_at.getTime() <= Date.now() || s.status !== 'ACTIVE') throw invalid;
      await tx.session.update({ where: { id: s.id }, data: { revokedAt: new Date(), revokedReason: 'ROTATED', lastUsedAt: new Date() } });
      return this.issue(tx, {
        userId: s.user_id,
        app: s.app,
        familyId: s.family_id,
        meta: { ...meta, deviceLabel: s.device_label },
      });
    });
  }

  async revokeFamily(familyId: string, reason: string, db: Db = this.prisma): Promise<void> {
    await db.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  async revokeAllForUser(userId: string, reason: string, db: Db = this.prisma): Promise<void> {
    await db.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } });
  }

  /** Appareils connectés : une ligne active par famille. */
  async listActive(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { familyId: true, app: true, deviceLabel: true, createdAt: true, lastUsedAt: true, ip: true },
      orderBy: { lastUsedAt: 'desc' },
    });
  }
}
