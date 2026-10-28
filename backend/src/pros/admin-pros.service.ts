import { Injectable } from '@nestjs/common';
import { type AuditContext, AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import type { VerificationStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { type VerificationAction, VERIFICATION_TRANSITIONS } from './pro-requirements.js';
import { ProsService } from './pros.service.js';

const NOTIFICATION_BY_ACTION: Partial<Record<VerificationAction, string>> = {
  approve: 'pro.VERIFICATION_APPROVED',
  reject: 'pro.VERIFICATION_REJECTED',
  requestInfo: 'pro.VERIFICATION_INFO_REQUESTED',
};

@Injectable()
export class AdminProsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pros: ProsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(status: VerificationStatus | undefined, page: number, pageSize: number) {
    const where = status ? { verificationStatus: status } : {};
    const [total, rows] = await Promise.all([
      this.prisma.proProfile.count({ where }),
      this.prisma.proProfile.findMany({
        where,
        // File d'attente : les dossiers soumis le plus anciennement d'abord.
        orderBy: { updatedAt: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { firstName: true, lastName: true, phoneE164: true } }, proCategories: { include: { category: true } } },
      }),
    ]);
    return {
      total,
      page,
      pageSize,
      items: rows.map((p) => ({
        id: p.userId,
        businessName: p.businessName,
        kind: p.kind,
        ownerName: [p.user.firstName, p.user.lastName].filter(Boolean).join(' ') || null,
        phone: p.user.phoneE164,
        categories: p.proCategories.map((c) => c.category.name),
        verificationStatus: p.verificationStatus,
        updatedAt: p.updatedAt.toISOString(),
      })),
    };
  }

  async detail(proId: string) {
    const view = await this.pros.view(proId);
    if (!view) throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: proId }, select: { firstName: true, lastName: true, phoneE164: true, phoneVerifiedAt: true, status: true } });
    const history = await this.prisma.proVerificationEvent.findMany({ where: { proId }, orderBy: { createdAt: 'desc' } });
    return {
      id: proId,
      owner: { firstName: user.firstName, lastName: user.lastName, phone: user.phoneE164, phoneVerifiedAt: user.phoneVerifiedAt?.toISOString() ?? null, accountStatus: user.status },
      profile: view,
      history: history.map((e) => ({ from: e.fromStatus, to: e.toStatus, note: e.note, actorId: e.actorId, at: e.createdAt.toISOString() })),
    };
  }

  /** URL de consultation (60 s) d'un justificatif privé ; chaque consultation est journalisée. */
  async documentUrl(documentId: string, ctx: AuditContext) {
    const doc = await this.prisma.verificationDocument.findUnique({ where: { id: documentId }, include: { file: true } });
    if (!doc || doc.file.status !== 'READY') throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    await this.audit.record(ctx, { action: 'document.view', entityType: 'verification_document', entityId: documentId, after: { proId: doc.proId, typeCode: doc.typeCode } });
    return { url: await this.files.readUrl(doc.file, 60), mimeType: doc.file.mimeType, expiresInSeconds: 60 };
  }

  /**
   * Applique une décision. Mise à jour conditionnelle sur le statut attendu : deux administrateurs
   * qui décident en même temps ne peuvent pas produire deux décisions.
   */
  async decide(proId: string, action: VerificationAction, ctx: AuditContext, note?: string, rejectedDocumentIds: string[] = []) {
    const t = VERIFICATION_TRANSITIONS[action];
    if ((action === 'reject' || action === 'requestInfo' || action === 'suspend') && !note?.trim()) {
      throw new AppError(422, 'REASON_REQUIRED', 'Indiquez un motif : il sera communiqué au professionnel.');
    }
    const before = await this.prisma.proProfile.findUnique({ where: { userId: proId } });
    if (!before) throw new AppError(404, 'NOT_FOUND', 'Cet élément n’existe plus ou a été supprimé.');
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const data =
        action === 'approve'
          ? { verificationStatus: t.to, verifiedAt: now, verifiedBy: ctx.actorId ?? null }
          : action === 'suspend'
            ? { verificationStatus: t.to, isOnline: false }
            : { verificationStatus: t.to };
      const updated = await tx.proProfile.updateMany({ where: { userId: proId, verificationStatus: { in: [...t.from] } }, data: { ...data, updatedAt: now } });
      if (updated.count !== 1) {
        throw new AppError(409, 'INVALID_TRANSITION', `Action impossible : le dossier est au statut ${before.verificationStatus}.`);
      }
      if (action === 'approve') {
        await tx.verificationDocument.updateMany({ where: { proId, status: 'PENDING' }, data: { status: 'APPROVED', reviewedBy: ctx.actorId ?? null, reviewedAt: now } });
      }
      if (rejectedDocumentIds.length) {
        const r = await tx.verificationDocument.updateMany({
          where: { proId, id: { in: rejectedDocumentIds }, status: 'PENDING' },
          data: { status: 'REJECTED', rejectionReason: note ?? null, reviewedBy: ctx.actorId ?? null, reviewedAt: now },
        });
        if (r.count !== rejectedDocumentIds.length) throw new AppError(422, 'INVALID_DOCUMENTS', 'Un des documents indiqués n’appartient pas à ce dossier ou a déjà été examiné.');
      }
      await tx.proVerificationEvent.create({ data: { proId, fromStatus: before.verificationStatus, toStatus: t.to, actorId: ctx.actorId ?? null, note: note?.trim() || null } });
      await this.audit.record(ctx, {
        action: `pro.${action}`, entityType: 'pro_profile', entityId: proId,
        before: { status: before.verificationStatus }, after: { status: t.to, note: note ?? null, rejectedDocumentIds },
      }, tx);
      const notification = NOTIFICATION_BY_ACTION[action];
      if (notification) await this.notifications.notify(proId, notification, {}, { screen: 'verification' }, tx);
    });
    return this.detail(proId);
  }
}
