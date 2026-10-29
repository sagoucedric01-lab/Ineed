import { Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService, type AuditContext } from '../audit/audit.service.js';
import { AppError } from '../common/http/api-error.js';
import { formatXof } from '../common/money/xof.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { BillingService } from './billing.service.js';
import { LedgerService } from './ledger.service.js';
import { cancellationRefunds, computeCommission, refundedCommission } from './money-rules.js';
import { PAYMENT_PROVIDER, ProviderUnavailableError, type PaymentProvider } from './providers/payment-provider.js';

type Tx = Prisma.TransactionClient;

const ACTIVE_REFUND = ['REQUESTED', 'APPROVED', 'PROCESSING', 'SUCCEEDED'] as const;

/**
 * Remboursements : calculés par le barème à l'annulation, ou décidés par un administrateur habilité.
 * Exécutés auprès du prestataire par le worker ; inscrits au grand livre une fois effectués.
 * Le total remboursé ne dépasse jamais le montant payé (contrôle en base).
 */
@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Remboursements');

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  private async refundedSoFar(db: Tx, paymentId: string): Promise<bigint> {
    const r = await db.refund.aggregate({ where: { paymentId, status: { in: [...ACTIVE_REFUND] } }, _sum: { amountXof: true } });
    return r._sum.amountXof ?? 0n;
  }

  /**
   * Annulation d'une mission : remboursements selon les conditions enregistrées (gratuite ou frais de
   * déplacement dus). Appelé dans la transaction de l'annulation. Renvoie les montants rendus et retenus.
   */
  async onMissionCancelled(tx: Tx, missionId: string, terms: 'FREE' | 'TRAVEL_FEE_DUE', now: Date): Promise<{ refundedXof: bigint; retainedXof: bigint }> {
    const paid = await tx.payment.findMany({ where: { missionId, status: 'SUCCEEDED' }, orderBy: { confirmedAt: 'asc' } });
    if (!paid.length) return { refundedXof: 0n, retainedXof: 0n };
    const items = [];
    for (const p of paid) items.push({ paymentId: p.id, purpose: p.purpose, amountXof: p.amountXof, refundedXof: await this.refundedSoFar(tx, p.id) });
    const travelFee = terms === 'TRAVEL_FEE_DUE' ? await this.billing.travelFee(tx, missionId) : 0n;
    let refunded = 0n;
    let retained = 0n;
    for (const r of cancellationRefunds(items, terms, travelFee)) {
      retained += r.retainedXof;
      if (r.amountXof <= 0n) continue;
      refunded += r.amountXof;
      await this.approve(tx, { paymentId: r.paymentId, amountXof: r.amountXof, reason: terms === 'FREE' ? 'Annulation sans frais' : 'Annulation : frais de déplacement retenus', key: `cancel:${r.paymentId}`, by: null, now });
    }
    return { refundedXof: refunded, retainedXof: retained };
  }

  /** Remboursement intégral automatique (paiement en double, ou reçu après l'annulation de la mission). */
  async refundInFull(tx: Tx, paymentId: string, reason: string, now: Date) {
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const left = p.amountXof - (await this.refundedSoFar(tx, paymentId));
    if (left > 0n) await this.approve(tx, { paymentId, amountXof: left, reason, key: `full:${paymentId}`, by: null, now });
  }

  private async approve(tx: Tx, r: { paymentId: string; amountXof: bigint; reason: string; key: string; by: string | null; now: Date }) {
    const existing = await tx.refund.findUnique({ where: { idempotencyKey: r.key } });
    if (existing) return existing;
    return tx.refund.create({ data: { paymentId: r.paymentId, amountXof: r.amountXof, reason: r.reason, status: 'APPROVED', requestedBy: r.by, approvedBy: r.by, idempotencyKey: r.key, createdAt: r.now } });
  }

  /** Remboursement décidé par l'administration (litige, geste commercial). Permission refund.approve. */
  async adminRefund(ctx: AuditContext & { actorId: string }, paymentId: string, amountXof: bigint, reason: string, key: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
      const p = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!p) throw new AppError(404, 'NOT_FOUND', 'Ce paiement n’existe pas.');
      if (p.status !== 'SUCCEEDED') throw new AppError(409, 'PAYMENT_NOT_CAPTURED', 'Seul un paiement réussi peut être remboursé.');
      const left = p.amountXof - (await this.refundedSoFar(tx, paymentId));
      const fullKey = `admin:${key}`;
      const existing = await tx.refund.findUnique({ where: { idempotencyKey: fullKey } });
      if (existing) return existing;
      if (amountXof > left) throw new AppError(422, 'REFUND_EXCEEDS_PAID', `Le remboursement ne peut pas dépasser ${formatXof(left)} (montant payé moins les remboursements déjà faits).`, { maxXof: left.toString() });
      const refund = await this.approve(tx, { paymentId, amountXof, reason, key: fullKey, by: ctx.actorId, now: new Date() });
      await this.audit.record(ctx, { action: 'refund.approve', entityType: 'refund', entityId: refund.id, after: { paymentId, amountXof: amountXof.toString(), reason } }, tx);
      return refund;
    });
  }

  /** Exécution auprès du prestataire des remboursements approuvés (worker). */
  async executeApproved(now = new Date()): Promise<number> {
    const todo = await this.prisma.refund.findMany({ where: { status: 'APPROVED' }, orderBy: { createdAt: 'asc' }, take: 50, include: { payment: true } });
    let done = 0;
    for (const r of todo) {
      // Prise en charge exclusive : un seul processus exécute ce remboursement.
      const claimed = await this.prisma.refund.updateMany({ where: { id: r.id, status: 'APPROVED' }, data: { status: 'PROCESSING' } });
      if (!claimed.count) continue;
      try {
        const out = await this.provider.refund({ merchantReference: r.payment.merchantReference, providerTxnId: r.payment.providerTxnId, amountXof: r.amountXof, refundReference: r.id });
        if (out.status === 'SUCCEEDED') {
          await this.prisma.$transaction((tx) => this.markSucceeded(tx, r.id, out.providerRefundId, null, now));
          done++;
        } else if (out.status === 'FAILED') {
          await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', failureMessage: out.message, completedAt: now } });
        }
        // MANUAL : reste « en cours » jusqu'à la saisie de la référence par l'administration.
      } catch (e) {
        if (!(e instanceof ProviderUnavailableError)) throw e;
        this.logger.warn(`Remboursement ${r.id} non exécuté (${e.message}) : nouvel essai plus tard`);
        await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'APPROVED' } });
      }
    }
    return done;
  }

  /** Remboursement exécuté hors API (espace marchand du prestataire) : saisie de sa référence. */
  async completeManual(ctx: AuditContext & { actorId: string }, refundId: string, providerRefundId: string) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.refund.findUnique({ where: { id: refundId } });
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Ce remboursement n’existe pas.');
      if (r.status === 'SUCCEEDED') return r;
      if (r.status !== 'PROCESSING') throw new AppError(409, 'REFUND_NOT_PROCESSING', 'Ce remboursement n’est pas en attente d’exécution manuelle.');
      await this.markSucceeded(tx, refundId, providerRefundId, ctx.actorId, new Date());
      await this.audit.record(ctx, { action: 'refund.complete', entityType: 'refund', entityId: refundId, after: { providerRefundId } }, tx);
      return tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    });
  }

  private async markSucceeded(tx: Tx, refundId: string, providerRefundId: string | null, by: string | null, now: Date) {
    const r = await tx.refund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', providerRefundId, completedAt: now }, include: { payment: { include: { commission: true, mission: true } } } });
    const p = r.payment;
    const commission = p.commission?.amountXof ?? 0n;
    const done = (await tx.refund.aggregate({ where: { paymentId: p.id, status: 'SUCCEEDED' }, _sum: { amountXof: true } }))._sum.amountXof ?? 0n;
    let target: bigint;
    if (r.idempotencyKey.startsWith('cancel:') && commission > 0n) {
      // Annulation : seuls les frais de déplacement sont retenus ; la commission ne porte sur eux que si la règle le prévoit.
      const rule = p.commission?.ruleId ? await tx.commissionRule.findUnique({ where: { id: p.commission.ruleId } }) : null;
      const kept = rule?.appliesToTravelFee ? computeCommission(p.amountXof - done, { rateBps: rule.rateBps, minXof: rule.minXof, appliesToTravelFee: true }).amountXof : 0n;
      target = commission - (kept < commission ? kept : commission);
    } else {
      // Autre remboursement : part proportionnelle cumulée, pour qu'un remboursement total rende toute la commission.
      target = refundedCommission(commission, done, p.amountXof);
    }
    const [given] = await tx.$queryRaw<{ total: bigint }[]>`
      SELECT COALESCE(sum(e.amount_xof), 0)::bigint AS total FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
      WHERE t.kind = 'REFUND' AND t.payment_id = ${p.id}::uuid AND e.account = 'INEED_REVENUE'`;
    await this.ledger.refund(tx, { refundId, paymentId: p.id, missionId: p.missionId, proId: p.mission.proId, amountXof: r.amountXof, commissionShareXof: target - given!.total, createdBy: by, reference: p.merchantReference }, now);
    await this.notifications.notify(p.payerId, 'client.REFUND_COMPLETED', { amount: formatXof(r.amountXof) }, { missionId: p.missionId, paymentId: p.id }, tx);
  }
}
