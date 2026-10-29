import { Injectable } from '@nestjs/common';
import type { AddressSnapshot } from '../addresses/addresses.service.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MIN_RATINGS } from '../search/ranking.js';

const MEDIA_URL_TTL_S = 600;
const num = (v: bigint | null) => (v === null ? null : Number(v));

/** Lecture des offres : côté professionnel (sans adresse précise ni nom du client), côté client (propositions). */
@Injectable()
export class OffersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  private async proView(offerId: string, proId: string) {
    const o = await this.prisma.requestOffer.findFirst({
      where: { id: offerId, proId },
      include: { request: { include: { category: true, service: true, requestMedia: { include: { file: true } } } } },
    });
    if (!o) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’est plus disponible.');
    const r = o.request;
    const snapshot = r.addressSnapshot as unknown as AddressSnapshot;
    const [w] = await this.prisma.$queryRaw<{ start: Date | null; end: Date | null }[]>`
      SELECT lower(desired_window) AS start, upper(desired_window) AS "end" FROM service_requests WHERE id = ${r.id}::uuid`;
    const mission = o.status === 'SELECTED' ? await this.prisma.mission.findFirst({ where: { offerId: o.id, status: { not: 'CANCELLED' } } }) : null;
    return {
      id: o.id,
      status: o.status,
      requestId: r.id,
      mode: r.mode,
      pricingModel: r.pricingModel,
      category: { id: r.category.id, name: r.category.name, iconKey: r.category.iconKey },
      service: r.service ? { id: r.service.id, name: r.service.name } : null,
      description: r.description,
      /** Quartier et distance approximative seulement : l'adresse précise est communiquée après confirmation du client. */
      zoneName: snapshot.zoneName ?? snapshot.cityName,
      distanceM: o.distanceM,
      etaMinutes: o.etaS === null ? null : Math.round(o.etaS / 60),
      window: w?.start && w.end ? { start: w.start.toISOString(), end: w.end.toISOString() } : null,
      budgetXof: num(r.budgetXof),
      media: await Promise.all(
        r.requestMedia
          .filter((m) => m.file.status === 'READY')
          .map(async (m) => ({ fileId: m.fileId, kind: m.kind, mimeType: m.file.mimeType, url: await this.files.readUrl(m.file, MEDIA_URL_TTL_S) })),
      ),
      sentAt: o.sentAt.toISOString(),
      expiresAt: o.expiresAt.toISOString(),
      proposal: o.respondedAt && o.status !== 'DECLINED'
        ? { proposedStartAt: o.proposedStartAt?.toISOString() ?? null, proposedPriceXof: num(o.proposedPriceXof), proposedTravelFeeXof: num(o.proposedTravelFeeXof), message: o.message }
        : null,
      missionId: mission?.id ?? null,
    };
  }

  /** Ouverture par le professionnel : l'offre passe « vue ». */
  async openForPro(proId: string, offerId: string, now = new Date()) {
    await this.prisma.requestOffer.updateMany({ where: { id: offerId, proId, status: 'SENT' }, data: { status: 'SEEN', seenAt: now } });
    return this.proView(offerId, proId);
  }

  /** Offres en attente de réponse, puis réponses récentes (7 jours). */
  async listForPro(proId: string, now = new Date()) {
    const rows = await this.prisma.requestOffer.findMany({
      where: {
        proId,
        OR: [{ status: { in: ['SENT', 'SEEN'] }, expiresAt: { gt: now } }, { status: { in: ['ACCEPTED', 'SELECTED'] }, sentAt: { gt: new Date(now.getTime() - 7 * 86_400_000) } }],
      },
      orderBy: { sentAt: 'desc' },
      take: 50,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.proView(r.id, proId)));
  }

  /** Propositions reçues par le client, et professionnel réservé le cas échéant. */
  async listForClient(clientId: string, requestId: string) {
    const r = await this.prisma.serviceRequest.findFirst({ where: { id: requestId, clientId } });
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
    const offers = await this.prisma.requestOffer.findMany({
      where: { requestId, status: { in: ['ACCEPTED', 'SELECTED'] } },
      include: { pro: { include: { user: { include: { avatarFile: true } } } } },
      orderBy: [{ proposedPriceXof: 'asc' }, { respondedAt: 'asc' }],
    });
    return {
      requestStatus: r.status,
      reservedProId: r.reservedProId,
      reservationExpiresAt: r.reservationExpiresAt?.toISOString() ?? null,
      offers: await Promise.all(
        offers.map(async (o) => {
          const avatar = o.pro.user.avatarFile?.status === 'READY' ? o.pro.user.avatarFile : null;
          return {
            id: o.id,
            status: o.status,
            reserved: o.proId === r.reservedProId,
            distanceM: o.distanceM,
            etaMinutes: o.etaS === null ? null : Math.round(o.etaS / 60),
            proposedStartAt: o.proposedStartAt?.toISOString() ?? null,
            proposedPriceXof: num(o.proposedPriceXof),
            proposedTravelFeeXof: num(o.proposedTravelFeeXof),
            message: o.message,
            pro: {
              id: o.proId,
              businessName: o.pro.businessName,
              avatarUrl: avatar ? await this.files.readUrl(avatar) : null,
              verified: o.pro.verificationStatus === 'APPROVED' && o.pro.verifiedAt !== null,
              ratingAvg: o.pro.ratingCount >= MIN_RATINGS ? Math.round(Number(o.pro.ratingAvg) * 10) / 10 : null,
              ratingCount: o.pro.ratingCount,
              missionsCompleted: o.pro.missionsCompleted,
            },
          };
        }),
      ),
    };
  }
}
