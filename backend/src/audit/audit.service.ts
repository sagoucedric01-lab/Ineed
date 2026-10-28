import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

export interface AuditContext {
  actorId?: string | null;
  actorRoles?: string[];
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
}

type Db = PrismaService | Prisma.TransactionClient;

/**
 * Journal d'audit des actions sensibles (table en ajout seul, protégée par trigger).
 * À appeler dans la même transaction que l'action, pour qu'une action ne puisse pas exister sans sa trace.
 */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(ctx: AuditContext, entry: AuditEntry, db: Db = this.prisma): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: ctx.actorId ?? null,
        actorRoles: ctx.actorRoles ?? [],
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: entry.before ?? undefined,
        after: entry.after ?? undefined,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        requestId: ctx.requestId ?? null,
      },
    });
  }
}
