import { Injectable } from '@nestjs/common';
import type { AppKind } from '../auth/auth-user.js';
import { AppError } from '../common/http/api-error.js';
import { RateLimiterService } from '../common/rate-limit/rate-limiter.service.js';
import { FilesService } from '../files/files.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { detectContactSharing } from './contact-filter.js';

/** Demande encore ouverte : le client et un professionnel qui a accepté ou proposé peuvent échanger. */
const OPEN_REQUEST = ['MATCHING', 'OFFERS_RECEIVED', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION'];
const ENGAGED_OFFER = ['ACCEPTED', 'SELECTED'];
const MESSAGE_URL_TTL_S = 600;
const PAGE = 50;

type Role = 'CLIENT' | 'PRO';

type ConversationRow = Prisma.ConversationGetPayload<{
  include: { client: true; pro: true; request: { include: { category: true; service: true } }; mission: true };
}>;

const notFound = () => new AppError(404, 'NOT_FOUND', 'Cette conversation n’existe pas.');

/**
 * Messagerie entre un client et un professionnel, au sujet d'une demande active ou d'une mission.
 * Les coordonnées ne sont jamais exposées : tout passe par Ineed. Un message renvoyé après une coupure
 * (même identifiant côté application) n'est enregistré qu'une fois.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly settings: SettingsService,
    private readonly rateLimiter: RateLimiterService,
  ) {}

  private include = { client: true, pro: true, request: { include: { category: true, service: true } }, mission: true } satisfies Prisma.ConversationInclude;

  /** Rôle de l'utilisateur dans la conversation, selon l'application utilisée ; 404 s'il n'y participe pas. */
  private roleIn(c: { clientId: string; proId: string }, userId: string, app: AppKind): Role {
    if (app === 'CLIENT' && c.clientId === userId) return 'CLIENT';
    if (app === 'PRO' && c.proId === userId) return 'PRO';
    throw notFound();
  }

  // ------------------------------------------------------------------ ouverture

  /** Ouvre (ou retrouve) la conversation entre le client et un professionnel au sujet d'une demande. */
  async open(userId: string, app: AppKind, requestId: string, proId?: string) {
    const req = await this.prisma.serviceRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
    let pro: string;
    if (app === 'CLIENT') {
      if (req.clientId !== userId || !proId) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
      pro = proId;
    } else if (app === 'PRO') {
      pro = userId;
    } else {
      throw new AppError(403, 'FORBIDDEN', 'Vous n’avez pas accès à cette information.');
    }
    const mission = await this.prisma.mission.findFirst({ where: { requestId, proId: pro }, orderBy: { createdAt: 'desc' } });
    if (!mission) {
      const offer = await this.prisma.requestOffer.findFirst({ where: { requestId, proId: pro, status: { in: ENGAGED_OFFER as never } } });
      if (!offer || !OPEN_REQUEST.includes(req.status)) {
        throw new AppError(403, 'CONVERSATION_NOT_ALLOWED', 'La messagerie s’ouvre quand le professionnel a accepté la demande ou qu’une mission est confirmée.');
      }
    }
    const c = await this.prisma.conversation.upsert({
      where: { requestId_proId: { requestId, proId: pro } },
      create: { requestId, clientId: req.clientId, proId: pro, missionId: mission?.id ?? null },
      update: mission ? { missionId: mission.id } : {},
      include: this.include,
    });
    return this.view(c, app === 'CLIENT' ? 'CLIENT' : 'PRO', userId);
  }

  /** Écriture possible ? Lecture seule une fois la mission terminée depuis N jours, ou la demande close sans mission. */
  private async canWrite(c: ConversationRow): Promise<boolean> {
    if (c.isLocked) return false;
    if (c.mission) {
      const end = c.mission.closedAt ?? c.mission.cancelledAt;
      if (!end) return true;
      const days = await this.settings.number('messages.write_after_close_days', 7);
      return Date.now() - end.getTime() < days * 86_400_000;
    }
    if (!OPEN_REQUEST.includes(c.request.status)) return false;
    return (await this.prisma.requestOffer.count({ where: { requestId: c.requestId, proId: c.proId, status: { in: ENGAGED_OFFER as never } } })) > 0;
  }

  private async unread(conversationId: string, userId: string): Promise<number> {
    const [r] = await this.prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM messages m
      LEFT JOIN conversation_reads cr ON cr.conversation_id = m.conversation_id AND cr.user_id = ${userId}::uuid
      WHERE m.conversation_id = ${conversationId}::uuid AND m.sender_id <> ${userId}::uuid
        AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)`;
    return Number(r!.n);
  }

  private async view(c: ConversationRow, role: Role, userId: string) {
    const last = await this.prisma.message.findFirst({ where: { conversationId: c.id }, orderBy: { createdAt: 'desc' } });
    return {
      id: c.id,
      requestId: c.requestId,
      missionId: c.missionId,
      missionReference: c.mission?.reference ?? null,
      subject: c.request.service?.name ?? c.request.category.name,
      /** Seul le prénom du client et le nom commercial du professionnel sont montrés. */
      otherParty: role === 'CLIENT' ? { name: c.pro.businessName } : { name: c.client.firstName ?? 'Client' },
      canWrite: await this.canWrite(c),
      unread: await this.unread(c.id, userId),
      lastMessage: last ? { body: last.hiddenAt ? null : last.body, hasPhoto: !!last.fileId, fromMe: last.senderId === userId, createdAt: last.createdAt.toISOString() } : null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
    };
  }

  // ------------------------------------------------------------------ lecture

  async list(userId: string, app: AppKind) {
    const where: Prisma.ConversationWhereInput = app === 'CLIENT' ? { clientId: userId } : app === 'PRO' ? { proId: userId } : { id: '00000000-0000-0000-0000-000000000000' };
    const rows = await this.prisma.conversation.findMany({ where, orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }], take: 100, include: this.include });
    return Promise.all(rows.map((c) => this.view(c, app === 'CLIENT' ? 'CLIENT' : 'PRO', userId)));
  }

  async get(userId: string, app: AppKind, id: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id }, include: this.include });
    if (!c) throw notFound();
    return this.view(c, this.roleIn(c, userId, app), userId);
  }

  async messages(userId: string, app: AppKind, id: string, before?: Date) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c) throw notFound();
    this.roleIn(c, userId, app);
    const rows = await this.prisma.message.findMany({
      where: { conversationId: id, ...(before ? { createdAt: { lt: before } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: PAGE,
      include: { file: true },
    });
    const reads = await this.prisma.conversationRead.findMany({ where: { conversationId: id } });
    const otherRead = reads.find((r) => r.userId !== userId)?.lastReadAt ?? null;
    const items = await Promise.all(rows.reverse().map((m) => this.messageView(m, userId, otherRead)));
    return { items, hasMore: rows.length === PAGE };
  }

  private async messageView(m: Prisma.MessageGetPayload<{ include: { file: true } }>, userId: string, otherReadAt: Date | null) {
    const hidden = m.hiddenAt !== null;
    return {
      id: m.id,
      clientMsgId: m.clientMsgId,
      fromMe: m.senderId === userId,
      body: hidden ? null : m.body,
      hidden,
      photoUrl: !hidden && m.file?.status === 'READY' ? await this.files.readUrl(m.file, MESSAGE_URL_TTL_S) : null,
      createdAt: m.createdAt.toISOString(),
      /** Lu par l'autre participant (pour mes propres messages). */
      read: m.senderId === userId && otherReadAt !== null && m.createdAt <= otherReadAt,
    };
  }

  // ------------------------------------------------------------------ écriture

  async send(userId: string, app: AppKind, id: string, input: { clientMsgId: string; body?: string; fileId?: string }) {
    const c = await this.prisma.conversation.findUnique({ where: { id }, include: this.include });
    if (!c) throw notFound();
    const role = this.roleIn(c, userId, app);
    // Message déjà reçu (renvoi après une coupure réseau) : même réponse, aucun doublon ni nouvelle notification.
    const existing = await this.prisma.message.findUnique({ where: { senderId_clientMsgId: { senderId: userId, clientMsgId: input.clientMsgId } }, include: { file: true } });
    if (existing) {
      if (existing.conversationId !== id) throw new AppError(422, 'CLIENT_MSG_ID_REUSED', 'Cet identifiant de message a déjà servi dans une autre conversation.');
      return { message: await this.messageView(existing, userId, null), duplicate: true, warning: null };
    }
    if (!(await this.canWrite(c))) throw new AppError(409, 'CONVERSATION_READ_ONLY', 'Cette conversation est terminée : vous pouvez la relire mais plus y écrire. Pour un problème, ouvrez une réclamation.');
    const body = input.body?.trim() || null;
    if (!body && !input.fileId) throw new AppError(422, 'MESSAGE_EMPTY', 'Écrivez un message ou ajoutez une photo.');
    await this.rateLimiter.consume({ name: 'messages:user', limit: 30, windowSeconds: 60 }, userId);
    if (input.fileId) await this.files.requireReady(userId, input.fileId, 'MESSAGE_PHOTO');
    const now = new Date();
    const otherId = role === 'CLIENT' ? c.proId : c.clientId;
    const otherApp: AppKind = role === 'CLIENT' ? 'PRO' : 'CLIENT';
    const { message, created } = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO messages (conversation_id, sender_id, body, file_id, client_msg_id, created_at)
        VALUES (${id}::uuid, ${userId}::uuid, ${body}, ${input.fileId ?? null}::uuid, ${input.clientMsgId}, ${now})
        ON CONFLICT (sender_id, client_msg_id) DO NOTHING RETURNING id`;
      const msg = await tx.message.findUniqueOrThrow({ where: { senderId_clientMsgId: { senderId: userId, clientMsgId: input.clientMsgId } }, include: { file: true } });
      if (!rows.length) return { message: msg, created: false };
      await tx.conversation.update({ where: { id }, data: { lastMessageAt: now } });
      // Ma lecture avance avec mon propre message.
      await tx.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId } }, create: { conversationId: id, userId, lastReadAt: now }, update: { lastReadAt: now } });
      // Une seule notification tant que l'autre participant n'a pas lu les précédentes.
      const pending = await tx.notification.count({ where: { userId: otherId, type: `${otherApp === 'PRO' ? 'pro' : 'client'}.NEW_MESSAGE`, readAt: null, data: { path: ['conversationId'], equals: id } } });
      if (!pending) {
        const sender = role === 'CLIENT' ? (c.client.firstName ?? 'Votre client') : c.pro.businessName;
        const preview = body ? (body.length > 80 ? `${body.slice(0, 79)}…` : body) : 'Photo';
        await this.notifications.notify(otherId, `${otherApp === 'PRO' ? 'pro' : 'client'}.NEW_MESSAGE`, { senderName: sender, preview }, { conversationId: id }, tx);
      }
      return { message: msg, created: true };
    });
    const forMe = await this.messageView(message, userId, null);
    if (created) {
      const forOther = await this.messageView(message, otherId, null);
      await this.realtime.publish(otherId, otherApp, { type: 'message', conversationId: id, message: forOther });
      await this.realtime.publish(userId, app, { type: 'message', conversationId: id, message: forMe });
    }
    return { message: forMe, duplicate: !created, warning: body && detectContactSharing(body) ? 'CONTACT_SHARING' : null };
  }

  async markRead(userId: string, app: AppKind, id: string) {
    const c = await this.prisma.conversation.findUnique({ where: { id } });
    if (!c) throw notFound();
    const role = this.roleIn(c, userId, app);
    const now = new Date();
    await this.prisma.conversationRead.upsert({ where: { conversationId_userId: { conversationId: id, userId } }, create: { conversationId: id, userId, lastReadAt: now }, update: { lastReadAt: now } });
    // Notifications de nouveaux messages de cette conversation : lues aussi.
    await this.prisma.notification.updateMany({ where: { userId, readAt: null, type: { endsWith: '.NEW_MESSAGE' }, data: { path: ['conversationId'], equals: id } }, data: { readAt: now } });
    const otherId = role === 'CLIENT' ? c.proId : c.clientId;
    await this.realtime.publish(otherId, role === 'CLIENT' ? 'PRO' : 'CLIENT', { type: 'read', conversationId: id, readAt: now.toISOString() });
  }

  /** Total de messages non lus (pastille de l'application). */
  async unreadTotal(userId: string, app: AppKind): Promise<number> {
    const col = app === 'PRO' ? 'pro_id' : 'client_id';
    const [r] = await this.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN conversation_reads cr ON cr.conversation_id = c.id AND cr.user_id = $1::uuid
       WHERE c.${col} = $1::uuid AND m.sender_id <> $1::uuid AND (cr.last_read_at IS NULL OR m.created_at > cr.last_read_at)`,
      userId,
    );
    return Number(r!.n);
  }
}
