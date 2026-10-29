import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor, SetMetadata } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Response } from 'express';
import { from, lastValueFrom, type Observable } from 'rxjs';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../infra/prisma.service.js';
import { AppError } from '../http/api-error.js';
import type { AppRequest } from '../http/request-context.js';

export const IDEMPOTENT = 'ineed:idempotent';
export const IDEMPOTENCY_HEADER = 'idempotency-key';
const LOCK_MS = 60_000;

/**
 * Route financière : l'en-tête `Idempotency-Key` est obligatoire. Une requête renvoyée avec la même clé
 * (réponse perdue, double appui) reçoit la réponse d'origine sans être exécutée une seconde fois.
 * Même clé avec un contenu différent : refusée. Requête encore en cours : 409.
 */
export const Idempotent = () => SetMetadata(IDEMPOTENT, true);

@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!this.reflector.get<boolean>(IDEMPOTENT, ctx.getHandler())) return next.handle();
    return from(this.run(ctx, next));
  }

  private async run(ctx: ExecutionContext, next: CallHandler): Promise<unknown> {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const userId = req.user?.userId;
    if (!userId) throw new Error('Route idempotente sans utilisateur authentifié');
    const key = req.headers[IDEMPOTENCY_HEADER];
    if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key)) {
      throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Cette opération exige un en-tête Idempotency-Key (8 à 128 caractères).');
    }
    const path = req.originalUrl.split('?')[0]!;
    const hash = createHash('sha256').update(`${req.method} ${path}\n${JSON.stringify(req.body ?? null)}`).digest('hex');
    const now = new Date();
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO idempotency_keys (user_id, key, method, path, request_hash, locked_until, created_at)
      VALUES (${userId}::uuid, ${key}, ${req.method}, ${path}, ${hash}, ${new Date(now.getTime() + LOCK_MS)}, ${now})
      ON CONFLICT (user_id, key) DO NOTHING`;
    if (!inserted) {
      const row = await this.prisma.idempotencyKey.findUniqueOrThrow({ where: { userId_key: { userId, key } } });
      if (row.requestHash !== hash) throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'Cette clé a déjà servi pour une autre opération. Réessayez avec une nouvelle clé.');
      if (row.statusCode !== null) {
        res.status(row.statusCode);
        res.setHeader('Idempotent-Replayed', 'true');
        return row.responseBody;
      }
      if (row.lockedUntil && row.lockedUntil > now) throw new AppError(409, 'IDEMPOTENCY_IN_PROGRESS', 'Cette opération est déjà en cours. Patientez un instant puis actualisez.');
      // Exécution précédente interrompue sans réponse : reprise sous la même clé.
      await this.prisma.idempotencyKey.update({ where: { userId_key: { userId, key } }, data: { lockedUntil: new Date(now.getTime() + LOCK_MS) } });
    }
    try {
      const body: unknown = await lastValueFrom(next.handle() as Observable<unknown>, { defaultValue: null });
      const status = this.reflector.get<number>(HTTP_CODE_METADATA, ctx.getHandler()) ?? (req.method === 'POST' ? 201 : 200);
      await this.prisma.idempotencyKey.update({
        where: { userId_key: { userId, key } },
        data: { statusCode: status, responseBody: body === null || body === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(body)) as Prisma.InputJsonValue), lockedUntil: null },
      });
      return body;
    } catch (e) {
      // Échec : rien n'est mémorisé, la même clé peut être renvoyée (les opérations sont elles-mêmes sûres à rejouer).
      await this.prisma.idempotencyKey.delete({ where: { userId_key: { userId, key } } }).catch(() => undefined);
      throw e;
    }
  }
}

/** Clés de plus de 24 h effacées (worker). */
export async function purgeIdempotencyKeys(prisma: PrismaService, now = new Date()): Promise<number> {
  return prisma.$executeRaw`DELETE FROM idempotency_keys WHERE created_at < ${new Date(now.getTime() - 86_400_000)}`;
}
