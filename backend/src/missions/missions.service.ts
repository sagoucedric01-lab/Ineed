import { Injectable } from '@nestjs/common';
import type { AddressSnapshot } from '../addresses/addresses.service.js';
import { BillingService } from '../billing/billing.service.js';
import { LedgerService } from '../billing/ledger.service.js';
import { RefundsService } from '../billing/refunds.service.js';
import { paymentView, quoteView } from '../billing/views.js';
import { AppError } from '../common/http/api-error.js';
import { formatXof } from '../common/money/xof.js';
import { FilesService } from '../files/files.service.js';
import { Prisma, type MissionStatus, type PricingModel } from '../generated/prisma/client.js';
import { pointSql } from '../geo/geo.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { etaMinutes } from '../search/ranking.js';
import { SettingsService } from '../settings/settings.service.js';
import { cancellationTerms, checkTransition, initialMissionStatus, type MissionActor } from './state-machine.js';

type Tx = Prisma.TransactionClient;
type Db = PrismaService | Tx;

export interface LocationPoint {
  lat: number;
  lng: number;
  accuracyM?: number;
  recordedAt: Date;
}

/** Au-delà, une position est signalée comme suspecte (indice, jamais une preuve). */
const MAX_ACCURACY_M = 200;
const MAX_SPEED_MS = 150 / 3.6;
/** Le client est alerté quand la position n'a pas été mise à jour depuis ce délai. */
const TRACKING_STALE_MS = 3 * 60_000;
const MEDIA_URL_TTL_S = 600;

interface MissionRow {
  id: string;
  reference: string;
  requestId: string;
  clientId: string;
  proId: string;
  pricingModel: PricingModel;
  status: MissionStatus;
  arrivedAt: Date | null;
  enRouteAt: Date | null;
  autoCloseAt: Date | null;
}

const TIMESTAMP_FOR: Partial<Record<MissionStatus, string>> = {
  CONFIRMED: 'confirmedAt',
  PAYMENT_PENDING: 'paymentPendingSince',
  EN_ROUTE: 'enRouteAt',
  ARRIVED: 'arrivedAt',
  IN_PROGRESS: 'startedAt',
  WORK_COMPLETED: 'workCompletedAt',
  CLOSED: 'closedAt',
  CANCELLED: 'cancelledAt',
  DISPUTED: 'disputedAt',
};

const ACTOR_LABEL: Record<MissionActor, string> = { CLIENT: 'le client', PRO: 'le professionnel', ADMIN: 'l’équipe Ineed', SYSTEM: 'Ineed', PAYMENT: 'Ineed' };

@Injectable()
export class MissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
    private readonly billing: BillingService,
    private readonly refunds: RefundsService,
    private readonly ledger: LedgerService,
  ) {}

  // ------------------------------------------------------------------ création

  /** Crée la mission d'une demande attribuée (appelé dans la transaction de confirmation du client). */
  async create(tx: Tx, p: { requestId: string; offerId: string; clientId: string; proId: string; scheduledStartAt: Date | null; now: Date }) {
    const req = await tx.serviceRequest.findUniqueOrThrow({ where: { id: p.requestId } });
    const [seqRow] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('mission_reference_seq') AS seq`;
    const reference = `IN-${p.now.getUTCFullYear()}-${String(seqRow!.seq).padStart(6, '0')}`;
    const status = initialMissionStatus(req.pricingModel);
    const m = await tx.mission.create({
      data: {
        reference, requestId: p.requestId, offerId: p.offerId, clientId: p.clientId, proId: p.proId, pricingModel: req.pricingModel, status,
        scheduledStartAt: p.scheduledStartAt, confirmedAt: status === 'CONFIRMED' ? p.now : null, createdAt: p.now, updatedAt: p.now,
      },
    });
    await tx.missionStatusHistory.create({ data: { missionId: m.id, fromStatus: null, toStatus: status, actorId: p.clientId, createdAt: p.now } });
    // Prix fixe ou frais de déplacement connus : le paiement est demandé tout de suite.
    if (status === 'CONFIRMED') await this.transition(m.id, 'PAYMENT_PENDING', 'SYSTEM', null, { now: p.now }, tx);
    return { id: m.id, reference };
  }

  // ------------------------------------------------------------------ transitions

  private async lock(tx: Tx, missionId: string): Promise<MissionRow | null> {
    const [m] = await tx.$queryRaw<MissionRow[]>`
      SELECT id, reference, request_id AS "requestId", client_id AS "clientId", pro_id AS "proId", pricing_model::text AS "pricingModel",
             status::text AS status, arrived_at AS "arrivedAt", en_route_at AS "enRouteAt", auto_close_at AS "autoCloseAt"
      FROM missions WHERE id = ${missionId}::uuid FOR UPDATE`;
    return m ?? null;
  }

  /**
   * Applique une transition de la machine à états. Répéter une action déjà appliquée (réponse perdue après une
   * coupure réseau) renvoie l'état courant sans rien enregistrer deux fois.
   */
  async transition(
    missionId: string,
    to: MissionStatus,
    actor: MissionActor,
    actorUserId: string | null,
    opts: { reason?: string; metadata?: Record<string, unknown>; report?: string; now?: Date } = {},
    db?: Tx,
  ): Promise<{ status: MissionStatus; changed: boolean }> {
    const run = async (tx: Tx) => {
      const now = opts.now ?? new Date();
      const m = await this.lock(tx, missionId);
      if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      if (actor === 'CLIENT' && m.clientId !== actorUserId) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      if (actor === 'PRO' && m.proId !== actorUserId) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      if (m.status === to) return { status: m.status, changed: false };
      const hasPendingQuote = (await tx.quote.count({ where: { missionId, status: 'SUBMITTED' } })) > 0;
      const hasUnpaidSupplement = to === 'WORK_COMPLETED' && (await this.billing.hasUnpaidSupplement(tx, missionId));
      const check = checkTransition(m.status, to, actor, { pricingModel: m.pricingModel, arrivedAt: m.arrivedAt, autoCloseAt: m.autoCloseAt, hasPendingQuote, hasUnpaidSupplement, now });
      if (!check.ok) {
        const message =
          check.reason === 'TRANSITION_NOT_ALLOWED' || check.reason === 'ACTOR_NOT_ALLOWED'
            ? to === 'CANCELLED' && m.status === 'IN_PROGRESS'
              ? 'Les travaux ont commencé : l’intervention ne peut plus être annulée. En cas de problème, signalez-le.'
              : 'Cette action n’est pas possible à cette étape de la mission.'
            : check.reason;
        throw new AppError(409, 'MISSION_TRANSITION_REFUSED', message, { from: m.status, to });
      }

      const data: Record<string, unknown> = { status: to, version: { increment: 1 }, updatedAt: now };
      const ts = TIMESTAMP_FOR[to];
      if (ts) data[ts] = now;
      const metadata: Record<string, unknown> = { ...opts.metadata };
      if (to === 'PAYMENT_PENDING') data.paymentReminderAt = null;
      if (to === 'WORK_COMPLETED') data.autoCloseAt = new Date(now.getTime() + (await this.settings.number('mission.auto_close_hours', 48)) * 3_600_000);
      if (to === 'CANCELLED') {
        data.cancelledBy = actorUserId;
        data.cancelReason = opts.reason ?? null;
        metadata.terms = cancellationTerms(m.status, actor, m.enRouteAt);
      }
      await tx.mission.update({ where: { id: missionId }, data });
      await tx.missionStatusHistory.create({
        data: { missionId, fromStatus: m.status, toStatus: to, actorId: actorUserId, reason: opts.reason ?? null, metadata: Object.keys(metadata).length ? (metadata as Prisma.InputJsonValue) : undefined, createdAt: now },
      });
      if (opts.report) await tx.missionReport.create({ data: { missionId, authorId: actorUserId!, body: opts.report, createdAt: now } });
      if (to === 'CANCELLED') {
        // Devis en attente retirés : la mission ne peut plus être engagée.
        await tx.quote.updateMany({ where: { missionId, status: 'SUBMITTED' }, data: { status: 'WITHDRAWN', decidedAt: now } });
        const r = await this.refunds.onMissionCancelled(tx, missionId, metadata.terms as 'FREE' | 'TRAVEL_FEE_DUE', now);
        metadata.refundedXof = Number(r.refundedXof);
        metadata.retainedXof = Number(r.retainedXof);
      }
      await this.afterTransition(tx, m, to, actor, metadata, now);
      return { status: to, changed: true };
    };
    return db ? run(db) : this.prisma.$transaction(run);
  }

  private async afterTransition(tx: Tx, m: MissionRow, to: MissionStatus, actor: MissionActor, metadata: Record<string, unknown>, now: Date) {
    const pro = await tx.proProfile.findUniqueOrThrow({ where: { userId: m.proId } });
    const ids = { missionId: m.id };
    switch (to) {
      case 'CONFIRMED':
        // Devis accepté avant le déplacement : le paiement est demandé.
        await this.transition(m.id, 'PAYMENT_PENDING', 'SYSTEM', null, { now }, tx);
        break;
      case 'PAYMENT_PENDING': {
        const due = await this.billing.due(tx, m.id);
        if (!due || due.amountXof === 0n) {
          // Rien à régler (frais de déplacement offerts) : la mission continue sans paiement.
          await this.transition(m.id, 'PAYMENT_CONFIRMED', 'PAYMENT', null, { now, reason: 'Aucun montant à régler' }, tx);
        }
        break;
      }
      case 'EN_ROUTE':
        await this.notifications.notify(m.clientId, 'client.PRO_EN_ROUTE', { proName: pro.businessName }, ids, tx);
        break;
      case 'ARRIVED':
        await this.notifications.notify(m.clientId, 'client.PRO_ARRIVED', { proName: pro.businessName }, ids, tx);
        if (m.pricingModel === 'TRAVEL_PLUS_DIAGNOSIS') {
          // Diagnostic sur place : la mission attend le devis des travaux.
          await this.transition(m.id, 'AWAITING_QUOTE', 'SYSTEM', null, { now }, tx);
        }
        break;
      case 'IN_PROGRESS':
        await this.notifications.notify(m.clientId, 'client.WORK_STARTED', { proName: pro.businessName }, ids, tx);
        break;
      case 'WORK_COMPLETED':
        await this.notifications.notify(m.clientId, 'client.WORK_COMPLETED', { proName: pro.businessName }, ids, tx);
        break;
      case 'CLOSED':
        await tx.proProfile.update({ where: { userId: m.proId }, data: { missionsCompleted: { increment: 1 } } });
        await this.notifications.notify(m.proId, 'pro.MISSION_VALIDATED', { reference: m.reference }, ids, tx);
        await this.notifications.notify(m.clientId, 'client.REVIEW_REQUEST', { proName: pro.businessName }, ids, tx);
        break;
      case 'DISPUTED':
        if (actor === 'CLIENT') await this.notifications.notify(m.proId, 'pro.MISSION_DISPUTED', { reference: m.reference }, ids, tx);
        break;
      case 'CANCELLED': {
        const refunded = BigInt(Number(metadata.refundedXof ?? 0));
        const retained = BigInt(Number(metadata.retainedXof ?? 0));
        const refundInfo =
          refunded > 0n
            ? retained > 0n
              ? `${formatXof(refunded)} vous sont remboursés ; ${formatXof(retained)} de frais de déplacement restent dus.`
              : `${formatXof(refunded)} vous sont remboursés.`
            : retained > 0n
              ? `${formatXof(retained)} de frais de déplacement restent dus.`
              : 'Aucun frais ne vous sera facturé.';
        if (actor === 'PRO') {
          await tx.proProfile.update({ where: { userId: m.proId }, data: { cancellationsByPro: { increment: 1 } } });
          const reassign = await this.settings.get<boolean>('mission.reassign_on_pro_cancel', true);
          if (reassign) await this.reopenRequest(tx, m.requestId, m.proId, now);
          else await this.cancelRequest(tx, m.requestId, null, 'Annulation par le professionnel', now);
          await this.notifications.notify(m.clientId, 'client.MISSION_CANCELLED', { reference: m.reference, refundInfo: reassign ? `${refundInfo} Nous recherchons un autre professionnel.` : refundInfo }, ids, tx);
        } else {
          await this.cancelRequest(tx, m.requestId, actor === 'CLIENT' ? m.clientId : null, actor === 'CLIENT' ? 'Annulation par le client' : 'Annulation par l’équipe Ineed', now);
          await this.notifications.notify(m.proId, 'pro.MISSION_CANCELLED', { reference: m.reference, actor: ACTOR_LABEL[actor] }, ids, tx);
          if (actor !== 'CLIENT') await this.notifications.notify(m.clientId, 'client.MISSION_CANCELLED', { reference: m.reference, refundInfo }, ids, tx);
        }
        break;
      }
      default:
        break;
    }
  }

  /** Le professionnel s'est désisté : la demande repart en recherche (il n'est pas sollicité de nouveau). */
  private async reopenRequest(tx: Tx, requestId: string, proId: string, now: Date) {
    // Son offre passe « refusée » : il n'est pas sollicité de nouveau et la nouvelle offre retenue reste unique.
    await tx.requestOffer.updateMany({ where: { requestId, proId, status: 'SELECTED' }, data: { status: 'DECLINED', declineReason: 'Désistement après attribution', respondedAt: now } });
    const req = await tx.serviceRequest.findUniqueOrThrow({ where: { id: requestId } });
    const urgentMinutes = await this.settings.number('dispatch.urgent_max_minutes', 30);
    await tx.serviceRequest.update({
      where: { id: requestId },
      data: {
        status: 'MATCHING', reservedProId: null, nextWaveAt: now, version: { increment: 1 }, updatedAt: now,
        ...(req.mode === 'URGENT' ? { matchingDeadlineAt: new Date(now.getTime() + urgentMinutes * 60_000) } : {}),
      },
    });
    await tx.requestStatusHistory.create({ data: { requestId, fromStatus: 'ASSIGNED', toStatus: 'MATCHING', actorId: null, reason: 'Annulation par le professionnel : nouvelle recherche', createdAt: now } });
  }

  private async cancelRequest(tx: Tx, requestId: string, actorId: string | null, reason: string, now: Date) {
    await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason, reservedProId: null, nextWaveAt: null, version: { increment: 1 }, updatedAt: now } });
    await tx.requestStatusHistory.create({ data: { requestId, fromStatus: 'ASSIGNED', toStatus: 'CANCELLED', actorId, reason, createdAt: now } });
  }

  // ------------------------------------------------------------------ tâches de fond

  /** Clôture automatique des missions terminées dont le client n'a pas répondu à temps. */
  async autoClose(now: Date): Promise<number> {
    const due = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM missions WHERE status = 'WORK_COMPLETED' AND auto_close_at <= ${now} LIMIT 200`;
    let n = 0;
    for (const { id } of due) {
      try {
        const r = await this.transition(id, 'CLOSED', 'SYSTEM', null, { now, reason: 'Clôture automatique sans réponse du client' });
        if (r.changed) n++;
      } catch (e) {
        // Mission modifiée entre-temps (litige ouvert) : rien à faire.
        if (!(e instanceof AppError)) throw e;
      }
    }
    return n;
  }

  /** Politique de conservation : positions de trajet effacées N jours après la fin de la mission. */
  async purgeLocationPings(now: Date): Promise<number> {
    const days = await this.settings.number('location.ping_retention_days', 30);
    const before = new Date(now.getTime() - days * 86_400_000);
    return this.prisma.$executeRaw`
      DELETE FROM location_pings p USING missions m
      WHERE p.mission_id = m.id AND COALESCE(m.closed_at, m.cancelled_at) < ${before}`;
  }

  // ------------------------------------------------------------------ suivi du trajet

  /**
   * Positions envoyées pendant le trajet (par lots : l'application renvoie après une coupure ce qu'elle n'a pas
   * pu transmettre). Doublons ignorés ; positions imprécises ou vitesses impossibles marquées suspectes.
   */
  async recordLocations(proId: string, missionId: string, points: LocationPoint[], now = new Date()) {
    const m = await this.prisma.mission.findFirst({ where: { id: missionId, proId } });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    if (m.status !== 'EN_ROUTE' || !m.enRouteAt) return { accepted: 0, ignored: points.length };
    const [last] = await this.prisma.$queryRaw<{ lat: number; lng: number; recordedAt: Date }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng, recorded_at AS "recordedAt"
      FROM location_pings WHERE mission_id = ${missionId}::uuid AND NOT is_suspicious ORDER BY recorded_at DESC LIMIT 1`;
    let previous = last ?? null;
    let accepted = 0;
    const sorted = [...points].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
    for (const p of sorted) {
      if (p.recordedAt.getTime() < m.enRouteAt.getTime() - 60_000 || p.recordedAt.getTime() > now.getTime() + 60_000) continue;
      let suspicious = (p.accuracyM ?? 0) > MAX_ACCURACY_M;
      if (previous && !suspicious) {
        const [dist] = await this.prisma.$queryRaw<{ d: number }[]>`SELECT ST_Distance(${pointSql(previous)}, ${pointSql(p)}) AS d`;
        const seconds = Math.max(1, (p.recordedAt.getTime() - previous.recordedAt.getTime()) / 1000);
        suspicious = dist!.d / seconds > MAX_SPEED_MS;
      }
      const n = await this.prisma.$executeRaw`
        INSERT INTO location_pings (mission_id, user_id, location, accuracy_m, recorded_at, received_at, is_suspicious)
        VALUES (${missionId}::uuid, ${proId}::uuid, ${pointSql(p)}, ${p.accuracyM ?? null}, ${p.recordedAt}, ${now}, ${suspicious})
        ON CONFLICT (mission_id, user_id, recorded_at) DO NOTHING`;
      accepted += n;
      if (n && !suspicious) previous = { lat: p.lat, lng: p.lng, recordedAt: p.recordedAt };
    }
    return { accepted, ignored: points.length - accepted };
  }

  private async tracking(m: { id: string; status: MissionStatus; requestId: string }, now: Date) {
    if (m.status !== 'EN_ROUTE') return null;
    const [p] = await this.prisma.$queryRaw<{ lat: number; lng: number; recordedAt: Date; distanceM: number }[]>`
      SELECT ST_Y(lp.location::geometry) AS lat, ST_X(lp.location::geometry) AS lng, lp.recorded_at AS "recordedAt",
             ST_Distance(lp.location, r.location) AS "distanceM"
      FROM location_pings lp JOIN missions mi ON mi.id = lp.mission_id JOIN service_requests r ON r.id = mi.request_id
      WHERE lp.mission_id = ${m.id}::uuid AND NOT lp.is_suspicious ORDER BY lp.recorded_at DESC LIMIT 1`;
    if (!p) return { position: null, stale: true, distanceM: null, etaMinutes: null, recordedAt: null };
    const speed = await this.settings.number('search.eta_speed_kmh', 18);
    return {
      position: { lat: p.lat, lng: p.lng },
      recordedAt: p.recordedAt.toISOString(),
      stale: now.getTime() - p.recordedAt.getTime() > TRACKING_STALE_MS,
      distanceM: Math.round(Number(p.distanceM)),
      etaMinutes: etaMinutes(Number(p.distanceM), speed, 0),
    };
  }

  // ------------------------------------------------------------------ lecture

  private include = {
    request: { include: { category: true, service: true, requestStatusHistories: { orderBy: { id: 'asc' as const } }, requestMedia: { include: { file: true } } } },
    pro: { include: { user: { include: { avatarFile: true } } } },
    client: { select: { id: true, firstName: true } },
    missionStatusHistories: { orderBy: { id: 'asc' as const } },
    missionReports: { orderBy: { createdAt: 'asc' as const } },
  } satisfies Prisma.MissionInclude;

  private async view(m: Prisma.MissionGetPayload<{ include: MissionsService['include'] }>, audience: 'CLIENT' | 'PRO' | 'ADMIN', now = new Date()) {
    const snapshot = m.request.addressSnapshot as unknown as AddressSnapshot;
    const avatar = m.pro.user.avatarFile?.status === 'READY' ? m.pro.user.avatarFile : null;
    const cancelled = m.missionStatusHistories.find((h) => h.toStatus === 'CANCELLED');
    const actorOf = (id: string | null) => (id === null ? 'SYSTEM' : id === m.clientId ? 'CLIENT' : id === m.proId ? 'PRO' : 'ADMIN');
    const timeline = [
      ...m.request.requestStatusHistories.map((h) => ({ kind: 'REQUEST', id: h.id, status: h.toStatus, at: h.createdAt, actor: actorOf(h.actorId), reason: h.reason })),
      ...m.missionStatusHistories.map((h) => ({ kind: 'MISSION', id: h.id, status: h.toStatus, at: h.createdAt, actor: actorOf(h.actorId), reason: h.reason })),
    ]
      // À horodatage égal (même transaction) : la demande avant la mission, puis l'ordre d'enregistrement.
      .sort((a, b) => a.at.getTime() - b.at.getTime() || (a.kind === b.kind ? Number(a.id - b.id) : a.kind === 'REQUEST' ? -1 : 1))
      .map(({ id: _, ...e }) => ({ ...e, at: e.at.toISOString() }));
    const base = {
      id: m.id,
      reference: m.reference,
      status: m.status,
      pricingModel: m.pricingModel,
      scheduledStartAt: m.scheduledStartAt?.toISOString() ?? null,
      enRouteAt: m.enRouteAt?.toISOString() ?? null,
      arrivedAt: m.arrivedAt?.toISOString() ?? null,
      startedAt: m.startedAt?.toISOString() ?? null,
      workCompletedAt: m.workCompletedAt?.toISOString() ?? null,
      autoCloseAt: m.autoCloseAt?.toISOString() ?? null,
      closedAt: m.closedAt?.toISOString() ?? null,
      cancelledAt: m.cancelledAt?.toISOString() ?? null,
      cancelledBy: cancelled ? actorOf(cancelled.actorId) : null,
      cancelReason: m.cancelReason,
      request: {
        id: m.requestId,
        mode: m.request.mode,
        category: { id: m.request.category.id, name: m.request.category.name, iconKey: m.request.category.iconKey },
        service: m.request.service ? { id: m.request.service.id, name: m.request.service.name } : null,
        description: m.request.description,
      },
      pro: { id: m.proId, businessName: m.pro.businessName, avatarUrl: avatar ? await this.files.readUrl(avatar) : null },
      report: m.missionReports.at(-1)?.body ?? null,
      timeline,
    };
    if (audience === 'CLIENT') {
      return {
        ...base,
        place: { zoneName: snapshot.zoneName, cityName: snapshot.cityName, label: snapshot.label, landmark: snapshot.landmark },
        tracking: await this.tracking(m, now),
        /** Conditions qui s'appliqueraient si le client annulait maintenant (null : annulation impossible). */
        cancelTerms: checkTransition(m.status, 'CANCELLED', 'CLIENT', { pricingModel: m.pricingModel, arrivedAt: m.arrivedAt, autoCloseAt: m.autoCloseAt, hasPendingQuote: false, hasUnpaidSupplement: false, now }).ok
          ? cancellationTerms(m.status, 'CLIENT', m.enRouteAt)
          : null,
        money: await this.money(m, 'CLIENT', now),
      };
    }
    // Professionnel retenu : adresse précise et prénom du client, uniquement une fois la mission créée.
    const [loc] = await this.prisma.$queryRaw<{ lat: number; lng: number }[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng FROM service_requests WHERE id = ${m.requestId}::uuid`;
    const media = await Promise.all(
      m.request.requestMedia
        .filter((x) => x.file.status === 'READY')
        .map(async (x) => ({ fileId: x.fileId, kind: x.kind, mimeType: x.file.mimeType, url: await this.files.readUrl(x.file, MEDIA_URL_TTL_S) })),
    );
    return {
      ...base,
      client: { firstName: m.client.firstName },
      place: { ...snapshot, location: loc ? { lat: loc.lat, lng: loc.lng } : null },
      media: audience === 'PRO' ? media : media.map(({ url: _, ...x }) => x),
      money: await this.money(m, audience, now),
    };
  }

  /** Devis (toutes versions), paiements, montant dû ; côté professionnel : commission et net de la mission. */
  private async money(m: { id: string; proId: string; status: MissionStatus }, audience: 'CLIENT' | 'PRO' | 'ADMIN', now: Date) {
    const [quotes, payments] = await Promise.all([
      this.prisma.quote.findMany({ where: { missionId: m.id, status: { not: 'DRAFT' } }, orderBy: { version: 'asc' }, include: { quoteLines: true } }),
      this.prisma.payment.findMany({ where: { missionId: m.id }, orderBy: { initiatedAt: 'asc' }, include: { refunds: true, commission: true } }),
    ]);
    let due = null;
    try {
      const d = await this.billing.due(this.prisma, m.id);
      due = d && d.amountXof > 0n ? { purpose: d.purpose, quoteId: d.quoteId, amountXof: Number(d.amountXof), label: d.label } : null;
    } catch (e) {
      if (!(e instanceof AppError)) throw e;
    }
    const succeeded = payments.filter((p) => p.status === 'SUCCEEDED');
    const paidXof = succeeded.reduce((s, p) => s + p.amountXof, 0n);
    const refundedXof = payments.flatMap((p) => p.refunds).filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amountXof, 0n);
    const base = { quotes: quotes.map((q) => quoteView(q, now)), due, paidXof: Number(paidXof), refundedXof: Number(refundedXof) };
    if (audience === 'CLIENT') return { ...base, payments: payments.map(paymentView) };
    const commissionXof = succeeded.reduce((s, p) => s + (p.commission?.amountXof ?? 0n), 0n);
    return {
      ...base,
      payments: payments.filter((p) => p.status === 'SUCCEEDED').map((p) => ({ id: p.id, purpose: p.purpose, amountXof: Number(p.amountXof), confirmedAt: p.confirmedAt?.toISOString() ?? null, isSandbox: p.isSandbox })),
      commissionXof: Number(commissionXof),
      /** Montant dû au professionnel pour cette mission (après commission et remboursements). */
      netXof: Number(await this.ledger.proPayable(m.proId, m.id)),
    };
  }

  async getForClient(clientId: string, id: string) {
    const m = await this.prisma.mission.findFirst({ where: { id, clientId }, include: this.include });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    return this.view(m, 'CLIENT');
  }

  async getForPro(proId: string, id: string) {
    const m = await this.prisma.mission.findFirst({ where: { id, proId }, include: this.include });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    return this.view(m, 'PRO');
  }

  async getForAdmin(id: string) {
    const m = await this.prisma.mission.findFirst({ where: { id }, include: this.include });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    return { ...(await this.view(m, 'ADMIN')), clientId: m.clientId };
  }

  async list(where: Prisma.MissionWhereInput, page = 1, pageSize = 20, db: Db = this.prisma) {
    const rows = await db.mission.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { request: { include: { category: true, service: true } }, pro: true },
    });
    return rows.map((m) => ({
      id: m.id,
      reference: m.reference,
      status: m.status,
      scheduledStartAt: m.scheduledStartAt?.toISOString() ?? null,
      createdAt: m.createdAt.toISOString(),
      category: { id: m.request.category.id, name: m.request.category.name, iconKey: m.request.category.iconKey },
      service: m.request.service ? { id: m.request.service.id, name: m.request.service.name } : null,
      zoneName: (m.request.addressSnapshot as unknown as AddressSnapshot).zoneName,
      proName: m.pro.businessName,
    }));
  }
}
