import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { detectContactSharing } from '../messaging/contact-filter.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;
type ReviewRow = Prisma.ReviewGetPayload<{ include: { client: true } }>;

/** Nom affiché sous un avis : prénom et initiale du nom, jamais l'identité complète. */
export function reviewerName(firstName: string | null, lastName: string | null): string {
  if (!firstName) return 'Client Ineed';
  return lastName ? `${firstName} ${lastName.charAt(0).toUpperCase()}.` : firstName;
}

/**
 * Avis : seulement après une mission réellement clôturée, par son client, une seule fois, dans un délai donné
 * (contrôles ici et en base). Un commentaire contenant des coordonnées attend la modération avant publication.
 * La note moyenne du professionnel ne compte que les avis publiés.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  /** Avis possible maintenant ? null si oui, sinon la raison (code). */
  async eligibility(clientId: string, missionId: string, now = new Date()): Promise<string | null> {
    const m = await this.prisma.mission.findFirst({ where: { id: missionId, clientId } });
    if (!m) return 'NOT_FOUND';
    if (m.status !== 'CLOSED' || !m.closedAt) return 'REVIEW_NOT_ALLOWED';
    if (await this.prisma.review.count({ where: { missionId } })) return 'REVIEW_EXISTS';
    const days = await this.settings.number('review.window_days', 30);
    if (now.getTime() - m.closedAt.getTime() > days * 86_400_000) return 'REVIEW_WINDOW_CLOSED';
    return null;
  }

  async create(clientId: string, missionId: string, rating: number, comment: string | undefined, now = new Date()) {
    const refusal = await this.eligibility(clientId, missionId, now);
    switch (refusal) {
      case null:
        break;
      case 'NOT_FOUND':
        throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      case 'REVIEW_EXISTS':
        throw new AppError(409, 'REVIEW_EXISTS', 'Vous avez déjà donné votre avis sur cette mission.');
      case 'REVIEW_WINDOW_CLOSED':
        throw new AppError(409, 'REVIEW_WINDOW_CLOSED', 'Le délai pour donner votre avis sur cette mission est dépassé.');
      default:
        throw new AppError(409, 'REVIEW_NOT_ALLOWED', 'Vous pourrez donner votre avis une fois l’intervention terminée et la mission clôturée.');
    }
    const status = detectContactSharing(comment) ? 'PENDING_MODERATION' : 'PUBLISHED';
    const review = await this.prisma.$transaction(async (tx) => {
      const m = await tx.mission.findUniqueOrThrow({ where: { id: missionId } });
      const r = await tx.review.create({ data: { missionId, clientId, proId: m.proId, rating, comment: comment ?? null, status, createdAt: now } });
      await this.refreshRating(tx, m.proId);
      if (status === 'PUBLISHED') await this.notifications.notify(m.proId, 'pro.NEW_REVIEW', { rating: String(rating) }, { missionId, reviewId: r.id }, tx);
      return r;
    });
    return { id: review.id, rating: review.rating, comment: review.comment, status: review.status, proReply: null, createdAt: review.createdAt.toISOString() };
  }

  /** Note moyenne et nombre d'avis publiés, recalculés dans la transaction de l'avis. */
  async refreshRating(tx: Tx, proId: string): Promise<void> {
    await tx.$executeRaw`
      UPDATE pro_profiles p SET rating_avg = COALESCE(s.avg, 0), rating_count = COALESCE(s.n, 0)
      FROM (SELECT round(avg(rating)::numeric, 2) AS avg, count(*)::int AS n FROM reviews WHERE pro_id = ${proId}::uuid AND status = 'PUBLISHED') s
      WHERE p.user_id = ${proId}::uuid`;
  }

  async forMission(clientId: string, missionId: string) {
    const m = await this.prisma.mission.findFirst({ where: { id: missionId, clientId }, include: { review: true } });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    const r = m.review;
    return {
      canReview: (await this.eligibility(clientId, missionId)) === null,
      review: r ? { id: r.id, rating: r.rating, comment: r.comment, status: r.status, proReply: r.proReply, createdAt: r.createdAt.toISOString() } : null,
    };
  }

  private publicView(r: ReviewRow) {
    return { id: r.id, rating: r.rating, comment: r.comment, author: reviewerName(r.client.firstName, r.client.lastName), proReply: r.proReply, createdAt: r.createdAt.toISOString() };
  }

  /** Avis publiés d'un professionnel validé (profil public). */
  async publicList(proId: string, page = 1, pageSize = 20) {
    const rows = await this.prisma.review.findMany({ where: { proId, status: 'PUBLISHED' }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { client: true } });
    return rows.map((r) => this.publicView(r));
  }

  async forPro(proId: string, page = 1) {
    const rows = await this.prisma.review.findMany({ where: { proId, status: { not: 'HIDDEN' } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * 20, take: 20, include: { client: true, mission: true } });
    return rows.map((r) => ({ ...this.publicView(r), status: r.status, missionReference: r.mission.reference }));
  }

  async reply(proId: string, reviewId: string, reply: string) {
    const r = await this.prisma.review.findFirst({ where: { id: reviewId, proId }, include: { client: true } });
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Cet avis n’existe pas.');
    if (r.proReply) throw new AppError(409, 'REVIEW_ALREADY_REPLIED', 'Vous avez déjà répondu à cet avis.');
    const updated = await this.prisma.review.update({ where: { id: reviewId }, data: { proReply: reply }, include: { client: true } });
    return this.publicView(updated);
  }
}
