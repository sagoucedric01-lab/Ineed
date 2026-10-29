import { Injectable } from '@nestjs/common';
import { quoteView } from '../billing/views.js';
import { AppError } from '../common/http/api-error.js';
import { formatXof } from '../common/money/xof.js';
import { formatDateTime } from '../common/time/business-time.js';
import type { MissionStatus, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MissionsService } from '../missions/missions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { SubmitQuoteDto } from './dto.js';

type Tx = Prisma.TransactionClient;

interface LockedMission {
  id: string;
  reference: string;
  clientId: string;
  proId: string;
  status: MissionStatus;
  arrivedAt: Date | null;
}

const notFound = () => new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');

/**
 * Devis : chaque modification est une nouvelle version (l'ancienne passe « remplacée ») ; un devis soumis est
 * immuable (contrôle en base). Devis initial avant l'intervention, frais supplémentaires pendant les travaux :
 * ils ne s'appliquent que si le client les accepte.
 */
@Injectable()
export class QuotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly missions: MissionsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
  ) {}

  private async lock(tx: Tx, missionId: string): Promise<LockedMission | null> {
    const [m] = await tx.$queryRaw<LockedMission[]>`
      SELECT id, reference, client_id AS "clientId", pro_id AS "proId", status::text AS status, arrived_at AS "arrivedAt"
      FROM missions WHERE id = ${missionId}::uuid FOR UPDATE`;
    return m ?? null;
  }

  async submit(proId: string, missionId: string, dto: SubmitQuoteDto, now = new Date()) {
    const quoteId = await this.prisma.$transaction(async (tx) => {
      const m = await this.lock(tx, missionId);
      if (!m || m.proId !== proId) throw notFound();
      const kind = m.status === 'AWAITING_QUOTE' || m.status === 'QUOTE_PENDING_APPROVAL' ? 'INITIAL' : m.status === 'IN_PROGRESS' ? 'SUPPLEMENT' : null;
      if (!kind) throw new AppError(409, 'QUOTE_NOT_EXPECTED', 'Un devis ne peut pas être envoyé à cette étape de la mission.');
      if (kind === 'SUPPLEMENT' && dto.lines.some((l) => !l.justification)) {
        throw new AppError(422, 'JUSTIFICATION_REQUIRED', 'Expliquez au client pourquoi chaque frais supplémentaire est nécessaire.');
      }
      const lines = dto.lines.map((l, i) => ({ kind: l.kind, label: l.label, quantity: l.quantity ?? 1, unitPriceXof: BigInt(l.unitPriceXof), justification: l.justification ?? null, position: i }));
      const total = lines.reduce((s, l) => s + l.unitPriceXof * BigInt(l.quantity), 0n);
      const max = BigInt(await this.settings.number('quote.max_total_xof', 5_000_000));
      if (total <= 0n) throw new AppError(422, 'QUOTE_EMPTY', 'Le montant du devis doit être supérieur à zéro.');
      if (total > max) throw new AppError(422, 'QUOTE_TOO_HIGH', `Le montant d’un devis est limité à ${formatXof(max)}. Contactez l’assistance pour un chantier plus important.`);
      // Les opérateurs Mobile Money n'acceptent que des montants multiples de 5 F CFA.
      if (total % 5n !== 0n) throw new AppError(422, 'QUOTE_AMOUNT_NOT_PAYABLE', 'Le total doit être un multiple de 5 F CFA pour pouvoir être payé par Mobile Money.');

      const current = await tx.quote.findFirst({ where: { missionId, status: 'SUBMITTED' } });
      if (current) await tx.quote.update({ where: { id: current.id }, data: { status: 'SUPERSEDED', decidedAt: now } });
      const last = await tx.quote.aggregate({ where: { missionId }, _max: { version: true } });
      const validHours = dto.validForHours ?? (await this.settings.number('quote.default_validity_hours', 48));
      const q = await tx.quote.create({
        data: {
          missionId, version: (last._max.version ?? 0) + 1, kind, supersedesId: current?.kind === kind ? current.id : null, status: 'DRAFT', totalXof: total,
          validUntil: new Date(now.getTime() + validHours * 3_600_000), conditions: dto.conditions ?? null, estimatedDurationMin: dto.estimatedDurationMin ?? null,
          createdBy: proId, createdAt: now, quoteLines: { create: lines },
        },
      });
      // Soumission : lignes figées à partir de maintenant (contrôle en base).
      await tx.quote.update({ where: { id: q.id }, data: { status: 'SUBMITTED', submittedAt: now } });
      if (kind === 'INITIAL' && m.status === 'AWAITING_QUOTE') await this.missions.transition(missionId, 'QUOTE_PENDING_APPROVAL', 'PRO', proId, { now }, tx);
      const pro = await tx.proProfile.findUniqueOrThrow({ where: { userId: proId } });
      await this.notifications.notify(
        m.clientId,
        kind === 'INITIAL' ? 'client.QUOTE_RECEIVED' : 'client.QUOTE_SUPPLEMENT_RECEIVED',
        { proName: pro.businessName, amount: formatXof(total), validUntil: formatDateTime(q.validUntil) },
        { missionId, quoteId: q.id },
        tx,
      );
      return q.id;
    });
    return this.one(quoteId);
  }

  async withdraw(proId: string, missionId: string, quoteId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const m = await this.lock(tx, missionId);
      if (!m || m.proId !== proId) throw notFound();
      const q = await tx.quote.findFirst({ where: { id: quoteId, missionId } });
      if (!q) throw new AppError(404, 'NOT_FOUND', 'Ce devis n’existe pas.');
      if (q.status === 'WITHDRAWN') return;
      if (q.status !== 'SUBMITTED') throw new AppError(409, 'QUOTE_DECIDED', 'Ce devis n’est plus en attente : il ne peut pas être retiré.');
      await tx.quote.update({ where: { id: q.id }, data: { status: 'WITHDRAWN', decidedAt: now } });
      if (q.kind === 'INITIAL' && m.status === 'QUOTE_PENDING_APPROVAL') {
        await this.missions.transition(missionId, 'AWAITING_QUOTE', 'SYSTEM', null, { now, reason: 'Devis retiré par le professionnel' }, tx);
      }
    });
    return this.one(quoteId);
  }

  /** Vérifie que le devis est la version courante et encore valable. Renvoie null s'il est déjà dans l'état voulu. */
  private current(q: { status: string; validUntil: Date } | null, wanted: 'ACCEPTED' | 'REJECTED', now: Date): 'DONE' | 'OK' {
    if (!q) throw new AppError(404, 'NOT_FOUND', 'Ce devis n’existe pas.');
    if (q.status === wanted) return 'DONE';
    if (q.status === 'SUPERSEDED') throw new AppError(409, 'QUOTE_SUPERSEDED', 'Le professionnel a envoyé une nouvelle version de ce devis. Consultez la dernière version.');
    if (q.status === 'EXPIRED' || (q.status === 'SUBMITTED' && q.validUntil <= now)) throw new AppError(409, 'QUOTE_EXPIRED', 'Ce devis n’est plus valable. Demandez une nouvelle version au professionnel.');
    if (q.status !== 'SUBMITTED') throw new AppError(409, 'QUOTE_DECIDED', 'Ce devis a déjà reçu une réponse.');
    return 'OK';
  }

  async accept(clientId: string, missionId: string, quoteId: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const m = await this.lock(tx, missionId);
      if (!m || m.clientId !== clientId) throw notFound();
      const q = await tx.quote.findFirst({ where: { id: quoteId, missionId } });
      if (this.current(q, 'ACCEPTED', now) === 'DONE') return;
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'ACCEPTED', decidedAt: now, decidedBy: clientId } });
      if (q!.kind === 'INITIAL') {
        // Avant le déplacement : confirmation puis paiement ; après le diagnostic sur place : paiement des travaux.
        await this.missions.transition(missionId, m.arrivedAt ? 'PAYMENT_PENDING' : 'CONFIRMED', 'CLIENT', clientId, { now, metadata: { quoteId } }, tx);
      }
      await this.notifications.notify(m.proId, 'pro.QUOTE_ACCEPTED', { amount: formatXof(q!.totalXof), reference: m.reference }, { missionId, quoteId }, tx);
    });
    return this.one(quoteId);
  }

  async reject(clientId: string, missionId: string, quoteId: string, reason: string | undefined, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const m = await this.lock(tx, missionId);
      if (!m || m.clientId !== clientId) throw notFound();
      const q = await tx.quote.findFirst({ where: { id: quoteId, missionId } });
      if (this.current(q, 'REJECTED', now) === 'DONE') return;
      await tx.quote.update({ where: { id: quoteId }, data: { status: 'REJECTED', decidedAt: now, decidedBy: clientId, rejectionReason: reason ?? null } });
      if (q!.kind === 'INITIAL' && m.status === 'QUOTE_PENDING_APPROVAL') {
        await this.missions.transition(missionId, 'AWAITING_QUOTE', 'CLIENT', clientId, { now, reason: reason ?? 'Devis refusé' }, tx);
      }
      await this.notifications.notify(m.proId, 'pro.QUOTE_REJECTED', { reference: m.reference }, { missionId, quoteId }, tx);
    });
    return this.one(quoteId);
  }

  /** Devis arrivés à échéance sans réponse (worker). */
  async expireDue(now = new Date()): Promise<number> {
    const due = await this.prisma.quote.findMany({ where: { status: 'SUBMITTED', validUntil: { lte: now } }, select: { id: true, missionId: true }, take: 200 });
    let n = 0;
    for (const d of due) {
      await this.prisma.$transaction(async (tx) => {
        const m = await this.lock(tx, d.missionId);
        const changed = await tx.quote.updateMany({ where: { id: d.id, status: 'SUBMITTED', validUntil: { lte: now } }, data: { status: 'EXPIRED', decidedAt: now } });
        if (!changed.count || !m) return;
        n++;
        const q = await tx.quote.findUniqueOrThrow({ where: { id: d.id } });
        if (q.kind === 'INITIAL' && m.status === 'QUOTE_PENDING_APPROVAL') {
          await this.missions.transition(m.id, 'AWAITING_QUOTE', 'SYSTEM', null, { now, reason: 'Devis expiré sans réponse' }, tx);
        }
        await this.notifications.notify(m.proId, 'pro.QUOTE_EXPIRED', { reference: m.reference }, { missionId: m.id, quoteId: q.id }, tx);
      });
    }
    return n;
  }

  private async one(id: string) {
    return quoteView(await this.prisma.quote.findUniqueOrThrow({ where: { id }, include: { quoteLines: true } }));
  }

  async list(missionId: string, owner: { clientId: string } | { proId: string }) {
    const m = await this.prisma.mission.findFirst({ where: { id: missionId, ...owner } });
    if (!m) throw notFound();
    const rows = await this.prisma.quote.findMany({ where: { missionId, status: { not: 'DRAFT' } }, orderBy: { version: 'asc' }, include: { quoteLines: true } });
    const now = new Date();
    return rows.map((q) => quoteView(q, now));
  }
}
