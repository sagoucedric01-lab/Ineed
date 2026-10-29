import { Injectable, Logger } from '@nestjs/common';
import type { AddressSnapshot } from '../addresses/addresses.service.js';
import { AppError } from '../common/http/api-error.js';
import { formatDateTime, formatTime } from '../common/time/business-time.js';
import { Prisma, type DispatchRule, type RequestStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MissionsService } from '../missions/missions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { ProSearchService } from '../search/pro-search.service.js';
import { etaMinutes } from '../search/ranking.js';
import { DispatchRulesService } from '../settings/dispatch-rules.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;

export interface TickReport {
  started: number;
  waves: number;
  offersSent: number;
  offersExpired: number;
  reservationsExpired: number;
  noProvider: number;
  requestsExpired: number;
  missionsClosed: number;
  pingsPurged: number;
}

interface LockedRequest {
  id: string;
  clientId: string;
  cityId: string;
  categoryId: string;
  serviceId: string | null;
  mode: 'URGENT' | 'SCHEDULED';
  status: RequestStatus;
  zoneId: string | null;
  lat: number;
  lng: number;
  windowStart: Date | null;
  windowEnd: Date | null;
  currentWave: number;
  currentRadiusM: number | null;
  timezone: string;
  addressSnapshot: AddressSnapshot;
  categoryName: string;
  serviceName: string | null;
  reservedProId: string | null;
}

/** Statuts d'une offre encore ouverte (le professionnel peut répondre). */
const OPEN_OFFER = Prisma.sql`'SENT','SEEN'`;
const DEFAULT_RULE = {
  URGENT: { strategy: 'FIRST_ACCEPT', initialRadiusM: 3000, radiusStepM: 3000, maxRadiusM: 15000, prosPerWave: 5, waveIntervalS: 60, offerTtlS: 60, clientConfirmTtlS: 120, maxOffersShown: 1 },
  SCHEDULED: { strategy: 'CLIENT_CHOICE', initialRadiusM: 5000, radiusStepM: 5000, maxRadiusM: 20000, prosPerWave: 10, waveIntervalS: 600, offerTtlS: 7200, clientConfirmTtlS: 3600, maxOffersShown: 5 },
} as const;

const km = (m: number) => (m < 10_000 ? (m / 1000).toFixed(1).replace('.', ',') : String(Math.round(m / 1000)));

/**
 * Moteur d'attribution. Tout son état est en base (statuts, échéances, prochaine vague) : il est piloté par
 * `tick()`, appelé régulièrement par le worker et immédiatement après une publication. Un redémarrage du
 * serveur ne perd donc rien : le tick suivant reprend là où les échéances en sont.
 * Chaque demande est traitée dans sa propre transaction, verrouillée (FOR UPDATE SKIP LOCKED) : plusieurs
 * workers peuvent tourner en même temps sans traiter deux fois la même demande.
 */
@Injectable()
export class DispatchService {
  private readonly logger = new Logger('Attribution');

  constructor(
    private readonly prisma: PrismaService,
    private readonly search: ProSearchService,
    private readonly rules: DispatchRulesService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly missions: MissionsService,
  ) {}

  private async rule(r: Pick<LockedRequest, 'mode' | 'cityId' | 'categoryId' | 'serviceId'>): Promise<Pick<DispatchRule, keyof (typeof DEFAULT_RULE)['URGENT']>> {
    return (await this.rules.ruleFor({ mode: r.mode, cityId: r.cityId, categoryId: r.categoryId, serviceId: r.serviceId })) ?? DEFAULT_RULE[r.mode];
  }

  private async lock(tx: Tx, id: string, statuses: RequestStatus[], skipLocked = true): Promise<LockedRequest | null> {
    const [row] = await tx.$queryRaw<LockedRequest[]>`
      SELECT r.id, r.client_id AS "clientId", r.city_id AS "cityId", r.category_id AS "categoryId", r.service_id AS "serviceId",
             r.mode::text AS mode, r.status::text AS status, r.zone_id AS "zoneId",
             ST_Y(r.location::geometry) AS lat, ST_X(r.location::geometry) AS lng,
             lower(r.desired_window) AS "windowStart", upper(r.desired_window) AS "windowEnd",
             r.current_wave AS "currentWave", r.current_radius_m AS "currentRadiusM", c.timezone,
             r.address_snapshot AS "addressSnapshot", cat.name AS "categoryName", s.name AS "serviceName", r.reserved_pro_id AS "reservedProId"
      FROM service_requests r
      JOIN cities c ON c.id = r.city_id
      JOIN categories cat ON cat.id = r.category_id
      LEFT JOIN services s ON s.id = r.service_id
      WHERE r.id = ${id}::uuid AND r.status::text IN (${Prisma.join(statuses)})
      FOR UPDATE OF r ${skipLocked ? Prisma.sql`SKIP LOCKED` : Prisma.empty}`;
    return row ?? null;
  }

  /** Même horodatage que le reste de la transaction : l'ordre de la chronologie du client reste exact. */
  private async history(tx: Tx, now: Date, requestId: string, from: RequestStatus | null, to: RequestStatus, actorId: string | null, reason?: string) {
    await tx.requestStatusHistory.create({ data: { requestId, fromStatus: from, toStatus: to, actorId, reason: reason ?? null, createdAt: now } });
  }

  private slotText(r: Pick<LockedRequest, 'windowStart' | 'windowEnd' | 'timezone'>): string {
    if (!r.windowStart || !r.windowEnd) return 'dès que possible';
    return `le ${formatDateTime(r.windowStart, r.timezone).replace(' à ', ' de ')} à ${formatTime(r.windowEnd, r.timezone)}`;
  }

  // ------------------------------------------------------------------ tick

  async tick(now = new Date()): Promise<TickReport> {
    const report: TickReport = { started: 0, waves: 0, offersSent: 0, offersExpired: 0, reservationsExpired: 0, noProvider: 0, requestsExpired: 0, missionsClosed: 0, pingsPurged: 0 };
    report.offersExpired = await this.expireOffers(now);
    report.reservationsExpired = await this.expireReservations(now);
    report.requestsExpired = await this.expireDeadlines(now);
    report.started = await this.startPublished(now);
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM service_requests WHERE status = 'MATCHING' AND next_wave_at <= ${now} ORDER BY next_wave_at LIMIT 200`;
    for (const { id } of due) {
      const r = await this.runWave(id, now);
      if (r) {
        report.waves++;
        report.offersSent += r.sent;
        if (r.noProvider) report.noProvider++;
      }
    }
    report.missionsClosed = await this.missions.autoClose(now);
    report.pingsPurged = await this.missions.purgeLocationPings(now);
    return report;
  }

  /** Traitement immédiat d'une demande qui vient d'être publiée (sinon pris en charge au tick suivant). */
  async kick(requestId: string): Promise<void> {
    const now = new Date();
    await this.startPublished(now, requestId);
    await this.runWave(requestId, now);
  }

  private async startPublished(now: Date, onlyId?: string): Promise<number> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM service_requests WHERE status = 'PUBLISHED' ${onlyId ? Prisma.sql`AND id = ${onlyId}::uuid` : Prisma.empty} LIMIT 200`;
    let n = 0;
    for (const { id } of ids) {
      const done = await this.prisma.$transaction(async (tx) => {
        const r = await this.lock(tx, id, ['PUBLISHED']);
        if (!r) return false;
        const rule = await this.rule(r);
        const deadline =
          r.mode === 'URGENT'
            ? new Date(now.getTime() + (await this.settings.number('dispatch.urgent_max_minutes', 30)) * 60_000)
            : // Programmé : propositions reçues jusqu'à une heure avant le début du créneau.
              new Date(Math.max(now.getTime(), (r.windowStart?.getTime() ?? now.getTime()) - 3_600_000));
        await tx.serviceRequest.update({
          where: { id },
          data: { status: 'MATCHING', currentWave: 0, currentRadiusM: rule.initialRadiusM, nextWaveAt: now, matchingDeadlineAt: deadline, version: { increment: 1 }, updatedAt: now },
        });
        await this.history(tx, now, id, 'PUBLISHED', 'MATCHING', null);
        return true;
      });
      if (done) n++;
    }
    return n;
  }

  /** Une vague : sollicite les meilleurs professionnels pas encore contactés, en élargissant le rayon si besoin. */
  async runWave(requestId: string, now = new Date()): Promise<{ sent: number; noProvider: boolean } | null> {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, requestId, ['MATCHING']);
      if (!r) return null;
      const rule = await this.rule(r);
      let radius = r.currentWave === 0 ? (r.currentRadiusM ?? rule.initialRadiusM) : Math.min((r.currentRadiusM ?? rule.initialRadiusM) + rule.radiusStepM, rule.maxRadiusM);
      const query = {
        cityId: r.cityId,
        timezone: r.timezone,
        categoryId: r.categoryId,
        mode: r.mode,
        point: { lat: r.lat, lng: r.lng },
        zoneId: r.zoneId,
        window: r.windowStart && r.windowEnd ? { start: r.windowStart, end: r.windowEnd } : undefined,
        excludeUserId: r.clientId,
        excludeOffersOf: r.id,
        now,
      };
      let found = await this.search.candidates({ ...query, radiusM: radius }, tx);
      // Personne de nouveau dans ce rayon : élargissement immédiat jusqu'au rayon maximal.
      while (found.length === 0 && radius < rule.maxRadiusM) {
        radius = Math.min(radius + rule.radiusStepM, rule.maxRadiusM);
        found = await this.search.candidates({ ...query, radiusM: radius }, tx);
      }
      const batch = found.slice(0, rule.prosPerWave);

      if (batch.length === 0) {
        const [openRow] = await tx.$queryRaw<{ open: number }[]>`
          SELECT count(*)::int AS open FROM request_offers WHERE request_id = ${r.id}::uuid AND status IN (${OPEN_OFFER})`;
        if (openRow!.open > 0) {
          // Des professionnels peuvent encore répondre : on attend l'expiration de leurs offres.
          await tx.serviceRequest.update({ where: { id: r.id }, data: { currentRadiusM: radius, nextWaveAt: new Date(now.getTime() + rule.waveIntervalS * 1000), updatedAt: now } });
          return { sent: 0, noProvider: false };
        }
        await tx.serviceRequest.update({ where: { id: r.id }, data: { status: 'NO_PROVIDER_FOUND', currentRadiusM: radius, nextWaveAt: null, version: { increment: 1 }, updatedAt: now } });
        await this.history(tx, now, r.id, 'MATCHING', 'NO_PROVIDER_FOUND', null, `Rayon maximal atteint (${km(radius)} km)`);
        await this.notifications.notify(r.clientId, 'client.REQUEST_NO_PROVIDER', {}, { requestId: r.id }, tx);
        return { sent: 0, noProvider: true };
      }

      const wave = r.currentWave + 1;
      const expiresAt = new Date(now.getTime() + rule.offerTtlS * 1000);
      const speed = await this.settings.number('search.eta_speed_kmh', 18);
      const departure = await this.settings.number('search.eta_departure_minutes', 10);
      for (const c of batch) {
        // Distance arrondie à 100 m : le professionnel ne connaît qu'une position approximative avant confirmation.
        const distanceM = Math.round((c.distanceM ?? radius) / 100) * 100;
        const fields = {
          wave, status: 'SENT' as const, distanceM, sentAt: now, expiresAt, seenAt: null, respondedAt: null, declineReason: null,
          proposedStartAt: null, proposedPriceXof: null, proposedTravelFeeXof: null, message: null,
          etaS: r.mode === 'URGENT' && c.distanceM !== null ? etaMinutes(c.distanceM, speed, departure) * 60 : null,
        };
        // Une offre retirée (demande attribuée puis annulée par un autre professionnel) est réutilisée.
        // (Pas d'upsert natif : l'index partiel « une seule offre retenue » perturbe le ON CONFLICT généré.)
        const previous = await tx.requestOffer.findUnique({ where: { requestId_proId: { requestId: r.id, proId: c.id } } });
        if (previous) await tx.requestOffer.update({ where: { id: previous.id }, data: fields });
        else await tx.requestOffer.create({ data: { requestId: r.id, proId: c.id, ...fields } });
        await tx.proProfile.update({ where: { userId: c.id }, data: { offersReceived: { increment: 1 } } });
        const vars = { distance: `${km(distanceM)} km`, serviceName: r.serviceName ?? r.categoryName, zone: r.addressSnapshot.zoneName ?? r.addressSnapshot.cityName, seconds: String(rule.offerTtlS), slot: this.slotText(r) };
        await this.notifications.notify(c.id, r.mode === 'URGENT' ? 'pro.NEW_REQUEST_URGENT' : 'pro.NEW_REQUEST_SCHEDULED', vars, { requestId: r.id }, tx);
      }
      await tx.serviceRequest.update({
        where: { id: r.id },
        data: { currentWave: wave, currentRadiusM: radius, nextWaveAt: new Date(now.getTime() + rule.waveIntervalS * 1000), updatedAt: now },
      });
      return { sent: batch.length, noProvider: false };
    });
  }

  // ------------------------------------------------------------------ échéances

  /** Offres sans réponse à l'échéance : expirées (le professionnel ne peut plus accepter). */
  private async expireOffers(now: Date): Promise<number> {
    return this.prisma.$executeRaw`
      UPDATE request_offers SET status = 'EXPIRED' WHERE status IN (${OPEN_OFFER}) AND expires_at <= ${now}`;
  }

  /** Réservation non confirmée à temps par le client : le professionnel est libéré, la recherche reprend. */
  private async expireReservations(now: Date): Promise<number> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM service_requests
      WHERE status IN ('PROVISIONALLY_RESERVED','AWAITING_CLIENT_CONFIRMATION') AND reservation_expires_at <= ${now} LIMIT 200`;
    let n = 0;
    for (const { id } of ids) {
      const done = await this.prisma.$transaction(async (tx) => {
        const r = await this.lock(tx, id, ['PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION']);
        if (!r) return false;
        await this.release(tx, r, now, 'EXPIRED', null, 'Le client n’a pas confirmé à temps');
        await this.notifications.notify(r.reservedProId!, 'pro.RESERVATION_EXPIRED', {}, { requestId: r.id }, tx);
        return true;
      });
      if (done) n++;
    }
    return n;
  }

  /** Libère le professionnel réservé : retour aux propositions reçues (programmé) ou nouvelle vague (urgence). */
  private async release(tx: Tx, r: LockedRequest, now: Date, offerStatus: 'EXPIRED' | 'NOT_SELECTED', actorId: string | null, reason: string) {
    await tx.requestOffer.updateMany({ where: { requestId: r.id, proId: r.reservedProId!, status: 'ACCEPTED' }, data: { status: offerStatus } });
    const remaining = await tx.requestOffer.count({ where: { requestId: r.id, status: 'ACCEPTED' } });
    const to: RequestStatus = r.mode === 'SCHEDULED' && remaining > 0 ? 'OFFERS_RECEIVED' : 'MATCHING';
    await tx.serviceRequest.update({
      where: { id: r.id },
      data: { status: to, reservedProId: null, reservationExpiresAt: null, nextWaveAt: to === 'MATCHING' ? now : null, version: { increment: 1 }, updatedAt: now },
    });
    await this.history(tx, now, r.id, r.status, to, actorId, reason);
  }

  /** Échéance de recherche dépassée : urgence sans professionnel, ou programmé sans choix du client. */
  private async expireDeadlines(now: Date): Promise<number> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM service_requests WHERE status IN ('MATCHING','OFFERS_RECEIVED') AND matching_deadline_at <= ${now} LIMIT 200`;
    let n = 0;
    for (const { id } of ids) {
      const done = await this.prisma.$transaction(async (tx) => {
        const r = await this.lock(tx, id, ['MATCHING', 'OFFERS_RECEIVED']);
        if (!r) return false;
        const to: RequestStatus = r.mode === 'URGENT' ? 'NO_PROVIDER_FOUND' : 'EXPIRED';
        await tx.$executeRaw`UPDATE request_offers SET status = 'EXPIRED' WHERE request_id = ${r.id}::uuid AND status IN ('SENT','SEEN','ACCEPTED')`;
        await tx.serviceRequest.update({ where: { id: r.id }, data: { status: to, nextWaveAt: null, version: { increment: 1 }, updatedAt: now } });
        await this.history(tx, now, r.id, r.status, to, null, 'Délai de recherche dépassé');
        await this.notifications.notify(r.clientId, 'client.REQUEST_NO_PROVIDER', {}, { requestId: r.id }, tx);
        return true;
      });
      if (done) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ réponses des professionnels

  private async lockOffer(tx: Tx, offerId: string, proId: string) {
    const [offer] = await tx.$queryRaw<{ id: string; requestId: string; status: string; expiresAt: Date }[]>`
      SELECT id, request_id AS "requestId", status::text AS status, expires_at AS "expiresAt"
      FROM request_offers WHERE id = ${offerId}::uuid AND pro_id = ${proId}::uuid FOR UPDATE`;
    if (!offer) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’est plus disponible.');
    return offer;
  }

  private assertOpen(offer: { status: string; expiresAt: Date }, now: Date) {
    if (offer.status === 'ACCEPTED') throw new AppError(409, 'OFFER_ALREADY_ACCEPTED', 'Vous avez déjà répondu à cette demande.');
    if (!['SENT', 'SEEN'].includes(offer.status) || offer.expiresAt <= now) throw new AppError(409, 'OFFER_EXPIRED', 'Cette demande n’est plus disponible.');
  }

  /**
   * Urgence : le premier professionnel qui accepte obtient une réservation temporaire. La mise à jour
   * conditionnelle (statut MATCHING) garantit un seul gagnant même si plusieurs acceptent au même instant.
   */
  async acceptUrgent(proId: string, offerId: string, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, offerId, proId);
      const [req] = await tx.$queryRaw<{ mode: string; clientId: string; cityId: string; categoryId: string; serviceId: string | null; reservedProId: string | null; reservationExpiresAt: Date | null }[]>`
        SELECT mode::text AS mode, client_id AS "clientId", city_id AS "cityId", category_id AS "categoryId", service_id AS "serviceId",
               reserved_pro_id AS "reservedProId", reservation_expires_at AS "reservationExpiresAt"
        FROM service_requests WHERE id = ${offer.requestId}::uuid`;
      // Acceptation renvoyée après une coupure réseau : la réservation obtenue est confirmée, sans doublon.
      if (offer.status === 'ACCEPTED' && req!.reservedProId === proId) {
        return { offerId: offer.id, requestId: offer.requestId, status: 'ACCEPTED', reservationExpiresAt: req!.reservationExpiresAt?.toISOString() ?? null };
      }
      this.assertOpen(offer, now);
      if (req!.mode !== 'URGENT') throw new AppError(409, 'PROPOSAL_REQUIRED', 'Pour une demande programmée, envoyez une proposition.');
      const rule = await this.rule({ mode: 'URGENT', cityId: req!.cityId, categoryId: req!.categoryId, serviceId: req!.serviceId });
      const expires = new Date(now.getTime() + rule.clientConfirmTtlS * 1000);
      const won = await tx.$executeRaw`
        UPDATE service_requests SET status = 'AWAITING_CLIENT_CONFIRMATION', reserved_pro_id = ${proId}::uuid,
               reservation_expires_at = ${expires}, next_wave_at = NULL, version = version + 1, updated_at = ${now}
        WHERE id = ${offer.requestId}::uuid AND status = 'MATCHING'`;
      if (won === 0) throw new AppError(409, 'OFFER_TAKEN', 'Un autre professionnel a été plus rapide. Restez disponible pour la prochaine demande.');
      await tx.requestOffer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED', respondedAt: now } });
      await tx.proProfile.update({ where: { userId: proId }, data: { offersAccepted: { increment: 1 } } });
      await this.history(tx, now, offer.requestId, 'MATCHING', 'PROVISIONALLY_RESERVED', proId);
      // Le client est prévenu dans la même transaction : la réservation attend sa confirmation.
      const pro = await tx.proProfile.findUniqueOrThrow({ where: { userId: proId } });
      await this.notifications.notify(req!.clientId, 'client.REQUEST_RESERVED', { proName: pro.businessName, minutes: String(Math.round(rule.clientConfirmTtlS / 60)) }, { requestId: offer.requestId }, tx);
      await this.history(tx, now, offer.requestId, 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION', null);
      return { offerId: offer.id, requestId: offer.requestId, status: 'ACCEPTED', reservationExpiresAt: expires.toISOString() };
    });
  }

  /** Programmé : le professionnel propose un horaire (et un prix s'il le souhaite) ; le client comparera. */
  async propose(proId: string, offerId: string, p: { proposedStartAt: Date; proposedPriceXof?: number; proposedTravelFeeXof?: number; message?: string }, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, offerId, proId);
      this.assertOpen(offer, now);
      const r = await this.lock(tx, offer.requestId, ['MATCHING', 'OFFERS_RECEIVED'], false);
      if (!r) throw new AppError(409, 'OFFER_EXPIRED', 'Cette demande n’est plus disponible.');
      if (r.mode !== 'SCHEDULED') throw new AppError(409, 'ACCEPT_INSTEAD', 'Pour une urgence, acceptez directement la demande.');
      if (!r.windowStart || !r.windowEnd || p.proposedStartAt < r.windowStart || p.proposedStartAt >= r.windowEnd) {
        throw new AppError(422, 'PROPOSAL_OUTSIDE_WINDOW', 'Proposez une heure d’arrivée comprise dans le créneau du client.');
      }
      const rule = await this.rule(r);
      await tx.requestOffer.update({
        where: { id: offer.id },
        data: {
          status: 'ACCEPTED', respondedAt: now, proposedStartAt: p.proposedStartAt, message: p.message ?? null,
          proposedPriceXof: p.proposedPriceXof === undefined ? null : BigInt(p.proposedPriceXof),
          proposedTravelFeeXof: p.proposedTravelFeeXof === undefined ? null : BigInt(p.proposedTravelFeeXof),
        },
      });
      await tx.proProfile.update({ where: { userId: proId }, data: { offersAccepted: { increment: 1 } } });
      if (r.status === 'MATCHING') {
        // Les propositions arrivent désormais : plus de nouvelle vague.
        await tx.serviceRequest.update({ where: { id: r.id }, data: { status: 'OFFERS_RECEIVED', nextWaveAt: null, version: { increment: 1 }, updatedAt: now } });
        await this.history(tx, now, r.id, 'MATCHING', 'OFFERS_RECEIVED', proId);
      }
      const accepted = await tx.requestOffer.count({ where: { requestId: r.id, status: 'ACCEPTED' } });
      if (accepted >= rule.maxOffersShown) {
        // Assez de propositions : les autres professionnels sollicités sont libérés.
        await tx.$executeRaw`UPDATE request_offers SET status = 'WITHDRAWN' WHERE request_id = ${r.id}::uuid AND status IN (${OPEN_OFFER})`;
      }
      const pro = await tx.proProfile.findUniqueOrThrow({ where: { userId: proId } });
      await this.notifications.notify(r.clientId, 'client.OFFER_RECEIVED', { proName: pro.businessName, serviceName: r.serviceName ?? r.categoryName }, { requestId: r.id }, tx);
      return { offerId: offer.id, requestId: r.id, status: 'ACCEPTED' };
    });
  }

  async decline(proId: string, offerId: string, reason: string | undefined, now = new Date()) {
    return this.prisma.$transaction(async (tx) => {
      const offer = await this.lockOffer(tx, offerId, proId);
      if (offer.status === 'DECLINED') return { offerId, status: 'DECLINED' };
      this.assertOpen(offer, now);
      await tx.requestOffer.update({ where: { id: offer.id }, data: { status: 'DECLINED', declineReason: reason ?? null, respondedAt: now } });
      // Tous les sollicités ont répondu ou expiré : la vague suivante peut partir sans attendre.
      await tx.$executeRaw`
        UPDATE service_requests SET next_wave_at = ${now}
        WHERE id = ${offer.requestId}::uuid AND status = 'MATCHING'
          AND NOT EXISTS (SELECT 1 FROM request_offers o WHERE o.request_id = ${offer.requestId}::uuid AND o.status IN (${OPEN_OFFER}))`;
      return { offerId: offer.id, status: 'DECLINED' };
    });
  }

  // ------------------------------------------------------------------ décisions du client

  /** Programmé : le client choisit une proposition ; il confirme ensuite les conditions. */
  async choose(clientId: string, requestId: string, offerId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, requestId, ['OFFERS_RECEIVED'], false);
      if (!r || r.clientId !== clientId) throw new AppError(409, 'REQUEST_NOT_CHOOSING', 'Aucune proposition n’est à choisir pour cette demande.');
      const offer = await tx.requestOffer.findFirst({ where: { id: offerId, requestId, status: 'ACCEPTED' } });
      if (!offer) throw new AppError(409, 'OFFER_EXPIRED', 'Cette proposition n’est plus disponible.');
      const rule = await this.rule(r);
      await tx.serviceRequest.update({
        where: { id: requestId },
        data: { status: 'AWAITING_CLIENT_CONFIRMATION', reservedProId: offer.proId, reservationExpiresAt: new Date(now.getTime() + rule.clientConfirmTtlS * 1000), version: { increment: 1 }, updatedAt: now },
      });
      await this.history(tx, now, requestId, 'OFFERS_RECEIVED', 'AWAITING_CLIENT_CONFIRMATION', clientId);
    });
  }

  /** Le client confirme le professionnel réservé : la demande est attribuée et la mission créée, dans la même transaction. */
  async confirm(clientId: string, requestId: string, now = new Date()): Promise<{ missionId: string; reference: string }> {
    return this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, requestId, ['AWAITING_CLIENT_CONFIRMATION', 'PROVISIONALLY_RESERVED', 'ASSIGNED'], false);
      if (!r || r.clientId !== clientId) throw new AppError(409, 'NOTHING_TO_CONFIRM', 'Aucun professionnel n’attend votre confirmation pour cette demande.');
      if (r.status === 'ASSIGNED') {
        // Confirmation renvoyée après une coupure réseau : la mission déjà créée est renvoyée.
        const existing = await tx.mission.findFirstOrThrow({ where: { requestId, status: { not: 'CANCELLED' } } });
        return { missionId: existing.id, reference: existing.reference };
      }
      const [res] = await tx.$queryRaw<{ expires: Date }[]>`SELECT reservation_expires_at AS expires FROM service_requests WHERE id = ${requestId}::uuid`;
      if (res!.expires <= now) throw new AppError(409, 'RESERVATION_EXPIRED', 'Le délai de confirmation est dépassé. Nous recherchons un autre professionnel.');
      const offer = await tx.requestOffer.findFirstOrThrow({ where: { requestId, proId: r.reservedProId!, status: 'ACCEPTED' } });
      await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'ASSIGNED', reservationExpiresAt: null, nextWaveAt: null, version: { increment: 1 }, updatedAt: now } });
      await this.history(tx, now, requestId, r.status, 'ASSIGNED', clientId);
      await tx.requestOffer.update({ where: { id: offer.id }, data: { status: 'SELECTED' } });
      // Les autres professionnels : ceux qui avaient proposé sont prévenus, les offres ouvertes sont retirées.
      const others = await tx.requestOffer.findMany({ where: { requestId, id: { not: offer.id }, status: { in: ['SENT', 'SEEN', 'ACCEPTED'] } } });
      for (const o of others) {
        await tx.requestOffer.update({ where: { id: o.id }, data: { status: o.status === 'ACCEPTED' ? 'NOT_SELECTED' : 'WITHDRAWN' } });
        if (o.status === 'ACCEPTED') {
          await this.notifications.notify(o.proId, 'pro.REQUEST_ASSIGNED_TO_OTHER', { serviceName: r.serviceName ?? r.categoryName, zone: r.addressSnapshot.zoneName ?? r.addressSnapshot.cityName }, { requestId }, tx);
        }
      }
      const scheduledStart = offer.proposedStartAt ?? r.windowStart;
      const mission = await this.missions.create(tx, { requestId, offerId: offer.id, clientId, proId: offer.proId, scheduledStartAt: scheduledStart, now });
      const pro = await tx.proProfile.findUniqueOrThrow({ where: { userId: offer.proId } });
      await this.notifications.notify(offer.proId, 'pro.REQUEST_CONFIRMED_BY_CLIENT', { reference: mission.reference }, { missionId: mission.id }, tx);
      await this.notifications.notify(clientId, 'client.APPOINTMENT_CONFIRMED', { proName: pro.businessName, slot: scheduledStart ? `le ${formatDateTime(scheduledStart, r.timezone)}` : 'dès que possible', reference: mission.reference }, { missionId: mission.id }, tx);
      return { missionId: mission.id, reference: mission.reference };
    });
  }

  /** Le client ne retient pas le professionnel réservé : il est libéré et la recherche continue. */
  async declineReservation(clientId: string, requestId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, requestId, ['AWAITING_CLIENT_CONFIRMATION', 'PROVISIONALLY_RESERVED'], false);
      if (!r || r.clientId !== clientId) throw new AppError(409, 'NOTHING_TO_CONFIRM', 'Aucun professionnel n’attend votre confirmation pour cette demande.');
      const proId = r.reservedProId!;
      await this.release(tx, r, now, 'NOT_SELECTED', clientId, 'Professionnel non retenu par le client');
      await this.notifications.notify(proId, 'pro.REQUEST_ASSIGNED_TO_OTHER', { serviceName: r.serviceName ?? r.categoryName, zone: r.addressSnapshot.zoneName ?? r.addressSnapshot.cityName }, { requestId }, tx);
    });
  }

  /** Aucun professionnel trouvé : le client relance la recherche, éventuellement en programmant un créneau. */
  async retry(clientId: string, requestId: string, change: { window?: { start: Date; end: Date } }, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const r = await this.lock(tx, requestId, ['NO_PROVIDER_FOUND'], false);
      if (!r || r.clientId !== clientId) throw new AppError(409, 'REQUEST_NOT_RETRYABLE', 'Cette demande ne peut pas être relancée.');
      if (change.window) {
        await tx.$executeRaw`UPDATE service_requests SET mode = 'SCHEDULED', desired_window = tstzrange(${change.window.start}::timestamptz, ${change.window.end}::timestamptz, '[)') WHERE id = ${requestId}::uuid`;
      }
      // Les offres expirées ou refusées restent : ces professionnels ne sont pas sollicités de nouveau.
      await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'PUBLISHED', version: { increment: 1 }, updatedAt: now } });
      await this.history(tx, now, requestId, 'NO_PROVIDER_FOUND', 'PUBLISHED', clientId, change.window ? 'Passage en demande programmée' : 'Nouvelle recherche');
    });
    await this.kick(requestId);
  }

  /** Annulation de la demande par le client : offres retirées, professionnel réservé prévenu. */
  async onRequestCancelled(tx: Tx, requestId: string, reservedProId: string | null) {
    await tx.$executeRaw`UPDATE request_offers SET status = 'WITHDRAWN' WHERE request_id = ${requestId}::uuid AND status IN ('SENT','SEEN','ACCEPTED')`;
    if (reservedProId) await this.notifications.notify(reservedProId, 'pro.RESERVATION_EXPIRED', {}, { requestId }, tx);
  }
}
