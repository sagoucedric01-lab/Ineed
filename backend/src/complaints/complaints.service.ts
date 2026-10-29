import { Injectable } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import type { AppKind } from '../auth/auth-user.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import type { ComplaintStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MissionsService } from '../missions/missions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import type { CreateComplaintDto } from './dto.js';

const OPEN: ComplaintStatus[] = ['OPEN', 'IN_REVIEW', 'WAITING_USER'];
const FILE_URL_TTL_S = 600;
const notFound = () => new AppError(404, 'NOT_FOUND', 'Cette réclamation n’existe pas.');

type ComplaintRow = Prisma.ComplaintGetPayload<{ include: { complaintMessages: { include: { file: true; author: true } }; mission: true; openedByUser: true } }>;

/**
 * Réclamations et assistance : un fil entre l'utilisateur et le support Ineed. Sur une mission en cours ou
 * terminée mais pas encore clôturée, la réclamation ouvre un litige (la clôture automatique et le reversement
 * attendent la décision). Les notes internes du support ne sont jamais montrées à l'utilisateur.
 */
@Injectable()
export class ComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly missions: MissionsService,
    private readonly notifications: NotificationsService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private include = { complaintMessages: { orderBy: { createdAt: 'asc' as const }, include: { file: true, author: true } }, mission: true, openedByUser: true } satisfies Prisma.ComplaintInclude;

  async create(userId: string, app: AppKind, dto: CreateComplaintDto, now = new Date()) {
    if (app === 'ADMIN') throw new AppError(403, 'FORBIDDEN', 'Vous n’avez pas accès à cette information.');
    let mission = null;
    if (dto.missionId) {
      mission = await this.prisma.mission.findFirst({ where: { id: dto.missionId, ...(app === 'PRO' ? { proId: userId } : { clientId: userId }) } });
      if (!mission) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      const open = await this.prisma.complaint.findFirst({ where: { missionId: mission.id, openedBy: userId, status: { in: OPEN } } });
      if (open) throw new AppError(409, 'COMPLAINT_ALREADY_OPEN', `Une réclamation est déjà en cours pour cette mission (${open.reference}) : complétez-la.`, { complaintId: open.id, reference: open.reference });
    }
    for (const fileId of dto.fileIds ?? []) await this.files.requireReady(userId, fileId, 'COMPLAINT_ATTACHMENT');
    const id = await this.prisma.$transaction(async (tx) => {
      const [seq] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('complaint_reference_seq') AS seq`;
      const reference = `REC-${now.getUTCFullYear()}-${String(seq!.seq).padStart(6, '0')}`;
      const c = await tx.complaint.create({
        data: { reference, missionId: mission?.id ?? null, openedBy: userId, openedFrom: app, category: dto.category, description: dto.description, createdAt: now },
      });
      for (const fileId of dto.fileIds ?? []) await tx.complaintMessage.create({ data: { complaintId: c.id, authorId: userId, body: '', fileId, createdAt: now } });
      if (mission && (mission.status === 'WORK_COMPLETED' || mission.status === 'IN_PROGRESS')) {
        // Litige : la mission n'est pas clôturée et le reversement attend la décision du support.
        try {
          await this.missions.transition(mission.id, 'DISPUTED', app === 'PRO' ? 'PRO' : 'CLIENT', userId, { now, reason: `Réclamation ${reference}` }, tx);
        } catch (e) {
          if (!(e instanceof AppError)) throw e;
        }
      }
      if (mission && app === 'CLIENT') {
        await this.notifications.notify(mission.proId, 'pro.COMPLAINT_OPENED', { reference, missionReference: mission.reference }, { complaintId: c.id, missionId: mission.id }, tx);
      }
      return c.id;
    });
    return this.getForUser(userId, id);
  }

  private async view(c: ComplaintRow, audience: 'USER' | 'SUPPORT') {
    const messages = await Promise.all(
      c.complaintMessages
        .filter((m) => audience === 'SUPPORT' || !m.isInternal)
        .map(async (m) => ({
          id: m.id,
          fromSupport: m.authorId !== c.openedBy,
          author: m.authorId === c.openedBy ? null : 'Équipe Ineed',
          body: m.body,
          internal: m.isInternal,
          fileUrl: m.file?.status === 'READY' ? await this.files.readUrl(m.file, FILE_URL_TTL_S) : null,
          createdAt: m.createdAt.toISOString(),
        })),
    );
    return {
      id: c.id,
      reference: c.reference,
      category: c.category,
      description: c.description,
      status: c.status,
      resolution: c.resolution,
      mission: c.mission ? { id: c.mission.id, reference: c.mission.reference, status: c.mission.status } : null,
      createdAt: c.createdAt.toISOString(),
      resolvedAt: c.resolvedAt?.toISOString() ?? null,
      messages: audience === 'SUPPORT' ? messages : messages.map(({ internal: _, ...m }) => m),
      ...(audience === 'SUPPORT' ? { openedBy: { id: c.openedBy, firstName: c.openedByUser.firstName, lastName: c.openedByUser.lastName }, openedFrom: c.openedFrom, refundId: c.refundId, assignedTo: c.assignedTo } : {}),
    };
  }

  async listForUser(userId: string) {
    const rows = await this.prisma.complaint.findMany({ where: { openedBy: userId }, orderBy: { createdAt: 'desc' }, take: 50, include: { mission: true } });
    return rows.map((c) => ({ id: c.id, reference: c.reference, category: c.category, status: c.status, missionReference: c.mission?.reference ?? null, createdAt: c.createdAt.toISOString() }));
  }

  async getForUser(userId: string, id: string) {
    const c = await this.prisma.complaint.findFirst({ where: { id, openedBy: userId }, include: this.include });
    if (!c) throw notFound();
    return this.view(c, 'USER');
  }

  async userMessage(userId: string, id: string, body: string, fileId?: string) {
    const c = await this.prisma.complaint.findFirst({ where: { id, openedBy: userId } });
    if (!c) throw notFound();
    if (!OPEN.includes(c.status)) throw new AppError(409, 'COMPLAINT_CLOSED', 'Cette réclamation est close. Ouvrez-en une nouvelle si besoin.');
    if (fileId) await this.files.requireReady(userId, fileId, 'COMPLAINT_ATTACHMENT');
    await this.prisma.$transaction(async (tx) => {
      await tx.complaintMessage.create({ data: { complaintId: id, authorId: userId, body, fileId: fileId ?? null } });
      // L'utilisateur a répondu : la réclamation revient au support.
      if (c.status === 'WAITING_USER') await tx.complaint.update({ where: { id }, data: { status: 'IN_REVIEW' } });
    });
    return this.getForUser(userId, id);
  }

  // ------------------------------------------------------------------ support (administration)

  async adminList(status?: ComplaintStatus, page = 1) {
    const rows = await this.prisma.complaint.findMany({
      where: status ? { status } : { status: { in: OPEN } },
      orderBy: { createdAt: 'asc' },
      skip: (page - 1) * 50,
      take: 50,
      include: { mission: true, openedByUser: true },
    });
    return rows.map((c) => ({ id: c.id, reference: c.reference, category: c.category, status: c.status, openedFrom: c.openedFrom, missionReference: c.mission?.reference ?? null, openedBy: c.openedByUser.firstName, createdAt: c.createdAt.toISOString() }));
  }

  async adminGet(id: string) {
    const c = await this.prisma.complaint.findUnique({ where: { id }, include: this.include });
    if (!c) throw notFound();
    return this.view(c, 'SUPPORT');
  }

  private notifyUser(tx: Prisma.TransactionClient, c: { id: string; openedBy: string; openedFrom: AppKind; reference: string }) {
    return this.notifications.notify(c.openedBy, c.openedFrom === 'PRO' ? 'pro.COMPLAINT_UPDATED' : 'client.COMPLAINT_UPDATED', { reference: c.reference }, { complaintId: c.id }, tx);
  }

  async supportMessage(ctx: AuditContext & { actorId: string }, id: string, body: string, internal: boolean) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.complaint.findUnique({ where: { id } });
      if (!c) throw notFound();
      if (!OPEN.includes(c.status) && !internal) throw new AppError(409, 'COMPLAINT_CLOSED', 'Cette réclamation est close.');
      await tx.complaintMessage.create({ data: { complaintId: id, authorId: ctx.actorId, body, isInternal: internal } });
      if (!internal) {
        await tx.complaint.update({ where: { id }, data: { status: 'WAITING_USER', assignedTo: c.assignedTo ?? ctx.actorId } });
        await this.notifyUser(tx, c);
      }
      await this.audit.record(ctx, { action: internal ? 'complaint.note' : 'complaint.reply', entityType: 'complaint', entityId: id }, tx);
    });
    return this.adminGet(id);
  }

  async setStatus(ctx: AuditContext & { actorId: string }, id: string, status: ComplaintStatus, resolution?: string, refundId?: string) {
    await this.prisma.$transaction(async (tx) => {
      const c = await tx.complaint.findUnique({ where: { id } });
      if (!c) throw notFound();
      if (!OPEN.includes(c.status)) throw new AppError(409, 'COMPLAINT_CLOSED', 'Cette réclamation est déjà close.');
      const closing = status === 'RESOLVED' || status === 'REJECTED';
      if (closing && !resolution) throw new AppError(422, 'RESOLUTION_REQUIRED', 'Indiquez la décision prise : elle sera communiquée à l’utilisateur.');
      if (refundId) {
        const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
        if (!refund || !c.missionId || refund.payment.missionId !== c.missionId) throw new AppError(422, 'REFUND_MISMATCH', 'Ce remboursement ne concerne pas la mission de la réclamation.');
      }
      await tx.complaint.update({
        where: { id },
        data: { status, resolution: resolution ?? c.resolution, refundId: refundId ?? c.refundId, resolvedAt: closing ? new Date() : null, assignedTo: c.assignedTo ?? ctx.actorId },
      });
      if (closing) {
        await tx.complaintMessage.create({ data: { complaintId: id, authorId: ctx.actorId, body: resolution! } });
        await this.notifyUser(tx, c);
      }
      await this.audit.record(ctx, { action: 'complaint.status', entityType: 'complaint', entityId: id, before: { status: c.status }, after: { status, resolution, refundId } }, tx);
    });
    return this.adminGet(id);
  }
}
