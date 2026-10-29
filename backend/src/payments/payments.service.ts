import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { LedgerService } from '../billing/ledger.service.js';
import { PAYMENT_PROVIDER, ProviderUnavailableError, type PaymentProvider, type VerifyResult } from '../billing/providers/payment-provider.js';
import { RefundsService } from '../billing/refunds.service.js';
import { paymentView } from '../billing/views.js';
import { AppError } from '../common/http/api-error.js';
import { formatXof } from '../common/money/xof.js';
import { ENV, type Env } from '../config/env.js';
import { Prisma, type Payment } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MissionsService } from '../missions/missions.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { SettingsService } from '../settings/settings.service.js';

type Tx = Prisma.TransactionClient;

/** Délai minimal entre deux vérifications d'un même paiement en attente. */
const REVERIFY_AFTER_MS = 30_000;
/** Vérification déclenchée par l'application qui consulte le paiement (au plus toutes les 5 s). */
const ON_READ_VERIFY_AFTER_MS = 5_000;
/** Marge après l'échéance d'un paiement avant de le déclarer expiré (validation tardive sur le téléphone). */
const EXPIRY_GRACE_MS = 5 * 60_000;

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface PaymentsTickReport {
  verified: number;
  succeeded: number;
  expired: number;
  reminders: number;
  missionsCancelled: number;
}

/**
 * Paiements des missions. Le statut « réussi » ne vient jamais de l'application ni du contenu d'une
 * notification : il est établi par une vérification serveur à serveur auprès du prestataire, puis appliqué
 * une seule fois (verrou sur le paiement, garantie d'unicité en base) avec ses écritures au grand livre.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Paiements');

  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
    private readonly ledger: LedgerService,
    private readonly refunds: RefundsService,
    private readonly missions: MissionsService,
    private readonly notifications: NotificationsService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get providerName(): string {
    return this.provider.name;
  }

  private async newReference(tx: Tx, now: Date): Promise<string> {
    const [row] = await tx.$queryRaw<{ seq: bigint }[]>`SELECT nextval('payment_reference_seq') AS seq`;
    const suffix = Array.from(randomBytes(4), (b) => ALPHABET[b % ALPHABET.length]).join('');
    // Lettres et chiffres uniquement (format accepté par les prestataires) ; suffixe aléatoire pour qu'une base
    // de test et la production partageant un compte marchand ne produisent jamais la même référence.
    return `INP${now.getUTCFullYear()}${String(row!.seq).padStart(6, '0')}${suffix}`;
  }

  // ------------------------------------------------------------------ paiement par le client

  async initiate(clientId: string, missionId: string, idempotencyKey: string, now = new Date()) {
    const { payment, fresh } = await this.prisma.$transaction(async (tx) => {
      const [m] = await tx.$queryRaw<{ id: string; clientId: string; reference: string }[]>`
        SELECT id, client_id AS "clientId", reference FROM missions WHERE id = ${missionId}::uuid FOR UPDATE`;
      if (!m || m.clientId !== clientId) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
      const sameKey = await tx.payment.findUnique({ where: { payerId_idempotencyKey: { payerId: clientId, idempotencyKey } } });
      if (sameKey) return { payment: sameKey, fresh: false };
      const due = await this.billing.due(tx, missionId);
      if (!due || due.amountXof <= 0n) throw new AppError(409, 'NOTHING_DUE', 'Aucun paiement n’est attendu pour cette mission en ce moment.');
      // Tentative encore ouverte pour le même objet : on la reprend plutôt que d'en créer une seconde.
      const open = await tx.payment.findFirst({
        where: { missionId, purpose: due.purpose, quoteId: due.quoteId, status: { in: ['INITIATED', 'PENDING'] }, checkoutUrl: { not: null }, expiresAt: { gt: now } },
        orderBy: { initiatedAt: 'desc' },
      });
      if (open) return { payment: open, fresh: false };
      const ttl = await this.settings.number('payment.checkout_ttl_minutes', 30);
      const p = await tx.payment.create({
        data: {
          missionId, quoteId: due.quoteId, payerId: clientId, purpose: due.purpose, grossAmountXof: due.amountXof, discountXof: 0n, amountXof: due.amountXof,
          provider: this.provider.name, isSandbox: this.provider.isSandbox, merchantReference: await this.newReference(tx, now), status: 'INITIATED',
          idempotencyKey, initiatedAt: now, expiresAt: new Date(now.getTime() + ttl * 60_000),
        },
      });
      return { payment: p, fresh: true };
    });
    if (!fresh) return this.view(payment.id);

    const [mission, payer] = await Promise.all([
      this.prisma.mission.findUniqueOrThrow({ where: { id: missionId }, include: { request: { include: { category: true, service: true } } } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: clientId } }),
    ]);
    const base = this.env.PUBLIC_API_URL ?? '';
    try {
      const r = await this.provider.initiate({
        merchantReference: payment.merchantReference,
        amountXof: payment.amountXof,
        description: `Mission ${mission.reference} ${mission.request.service?.name ?? mission.request.category.name}`,
        customerPhoneE164: payer.phoneE164,
        customerFirstName: payer.firstName,
        notifyUrl: `${base}/v1/payments/notify/${this.provider.name}`,
        returnUrl: this.env.PAYMENT_RETURN_URL ?? `${base}/v1/payments/return`,
      });
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'PENDING', checkoutUrl: r.checkoutUrl, providerTxnId: r.providerTxnId } });
    } catch (e) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      this.logger.warn(`Création du paiement ${payment.merchantReference} refusée : ${e.message}`);
      await this.prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureCode: 'PROVIDER_UNAVAILABLE', failureMessage: 'Le service de paiement n’a pas répondu.' } });
      throw new AppError(503, 'PAYMENT_PROVIDER_UNAVAILABLE', 'Le service de paiement ne répond pas pour le moment. Réessayez dans un instant ; vous n’avez pas été débité.');
    }
    return this.view(payment.id);
  }

  private async view(id: string) {
    return paymentView(await this.prisma.payment.findUniqueOrThrow({ where: { id }, include: { refunds: true } }));
  }

  /** Consultation par le client : un paiement en attente est revérifié auprès du prestataire avant réponse. */
  async getForClient(clientId: string, paymentId: string, now = new Date()) {
    const p = await this.prisma.payment.findFirst({ where: { id: paymentId, payerId: clientId } });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Ce paiement n’existe pas.');
    if ((p.status === 'PENDING' || p.status === 'INITIATED') && p.checkoutUrl && now.getTime() - (p.lastVerifiedAt ?? p.initiatedAt).getTime() >= ON_READ_VERIFY_AFTER_MS) {
      await this.verifyAndApply(p.id, now);
    }
    return this.view(p.id);
  }

  async listForMission(clientId: string, missionId: string) {
    const m = await this.prisma.mission.findFirst({ where: { id: missionId, clientId } });
    if (!m) throw new AppError(404, 'NOT_FOUND', 'Cette mission n’existe pas.');
    const rows = await this.prisma.payment.findMany({ where: { missionId }, orderBy: { initiatedAt: 'asc' }, include: { refunds: true } });
    return rows.map(paymentView);
  }

  // ------------------------------------------------------------------ notifications du prestataire

  /**
   * Notification (webhook) : enregistrée telle quelle, dédoublonnée, signature contrôlée. Elle ne sert que de
   * signal : le résultat est obtenu par vérification serveur à serveur. Rejouer la même notification n'a aucun effet.
   */
  async handleNotification(providerName: string, headers: Record<string, string | string[] | undefined>, body: unknown, now = new Date()): Promise<{ received: true; duplicate: boolean }> {
    if (providerName !== this.provider.name) throw new AppError(404, 'NOT_FOUND', 'Prestataire inconnu.');
    const n = this.provider.parseNotification(headers, body);
    const payment = n.merchantReference ? await this.prisma.payment.findUnique({ where: { merchantReference: n.merchantReference } }) : null;
    const [inserted] = await this.prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO payment_provider_events (provider, provider_event_id, payment_id, payload, signature_valid, received_at)
      VALUES (${providerName}, ${n.eventId}, ${payment?.id ?? null}::uuid, ${JSON.stringify(n.payload)}::jsonb, ${n.signatureValid}, ${now})
      ON CONFLICT (provider, provider_event_id) DO NOTHING RETURNING id`;
    const event = inserted ?? (await this.prisma.paymentProviderEvent.findUniqueOrThrow({ where: { provider_providerEventId: { provider: providerName, providerEventId: n.eventId } }, select: { id: true } }));
    const existing = await this.prisma.paymentProviderEvent.findUniqueOrThrow({ where: { id: event.id } });
    if (!n.signatureValid) {
      this.logger.warn(`Notification ${providerName} à signature invalide (référence ${n.merchantReference ?? 'absente'}) : ignorée`);
      throw new AppError(401, 'INVALID_SIGNATURE', 'Signature de la notification invalide.');
    }
    if (existing.processedAt) return { received: true, duplicate: true };
    let error: string | null = null;
    if (!payment) error = 'UNKNOWN_REFERENCE';
    else {
      try {
        await this.verifyAndApply(payment.id, now);
      } catch (e) {
        error = e instanceof Error ? e.message.slice(0, 500) : 'erreur';
        this.logger.error(`Traitement de la notification ${event.id} en échec : ${error}`);
      }
    }
    // Erreur de traitement : la notification reste à traiter (le prestataire la renverra, le worker revérifie).
    await this.prisma.paymentProviderEvent.update({ where: { id: event.id }, data: { processedAt: error && error !== 'UNKNOWN_REFERENCE' ? null : now, processingError: error } });
    return { received: true, duplicate: !inserted };
  }

  // ------------------------------------------------------------------ vérification et application

  /** Vérifie un paiement auprès du prestataire puis applique le résultat. Sans réponse du prestataire : rien ne change. */
  async verifyAndApply(paymentId: string, now = new Date()): Promise<Payment['status']> {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === 'SUCCEEDED') return p.status;
    let result: VerifyResult;
    try {
      result = await this.provider.verify(p.merchantReference);
    } catch (e) {
      if (!(e instanceof ProviderUnavailableError)) throw e;
      this.logger.warn(`Vérification de ${p.merchantReference} impossible : ${e.message}`);
      await this.prisma.payment.update({ where: { id: paymentId }, data: { lastVerifiedAt: now } });
      return p.status;
    }
    return this.prisma.$transaction((tx) => this.apply(tx, paymentId, result, now));
  }

  private async apply(tx: Tx, paymentId: string, r: VerifyResult, now: Date): Promise<Payment['status']> {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const p = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    if (p.status === 'SUCCEEDED') return p.status; // déjà appliqué : aucun second effet
    await tx.payment.update({ where: { id: p.id }, data: { lastVerifiedAt: now } });

    if (r.status === 'PENDING') {
      if (p.status === 'INITIATED' && p.checkoutUrl) await tx.payment.update({ where: { id: p.id }, data: { status: 'PENDING' } });
      return 'PENDING';
    }
    if (r.status === 'FAILED' || r.status === 'CANCELLED') {
      if (p.status !== 'INITIATED' && p.status !== 'PENDING') return p.status;
      await tx.payment.update({ where: { id: p.id }, data: { status: r.status === 'FAILED' ? 'FAILED' : 'CANCELLED', failureCode: r.failureCode, failureMessage: r.failureMessage, method: r.method ?? p.method } });
      await this.notifications.notify(p.payerId, 'client.PAYMENT_FAILED', { amount: formatXof(p.amountXof) }, { missionId: p.missionId, paymentId: p.id }, tx);
      return r.status === 'FAILED' ? 'FAILED' : 'CANCELLED';
    }

    // Réussite annoncée par le prestataire : montant et devise contrôlés avant tout effet.
    if (r.amountXof !== p.amountXof || r.currency !== 'XOF') {
      await tx.payment.update({ where: { id: p.id }, data: { failureCode: 'AMOUNT_MISMATCH', failureMessage: `Montant confirmé ${r.amountXof ?? '?'} ${r.currency ?? ''} différent du montant attendu.` } });
      await this.audit.record({ actorId: null }, { action: 'payment.amount_mismatch', entityType: 'payment', entityId: p.id, after: { expected: p.amountXof.toString(), confirmed: r.amountXof?.toString() ?? null, currency: r.currency } }, tx);
      this.logger.error(`Paiement ${p.merchantReference} : montant confirmé différent de l’attendu, à examiner par l’équipe`);
      return p.status;
    }
    const duplicate = (await tx.payment.count({ where: { id: { not: p.id }, missionId: p.missionId, quoteId: p.quoteId, purpose: p.purpose, status: 'SUCCEEDED', isDuplicate: false } })) > 0;
    await tx.payment.update({
      where: { id: p.id },
      data: { status: 'SUCCEEDED', confirmedAt: now, providerTxnId: r.providerTxnId, method: r.method, isDuplicate: duplicate, failureCode: null, failureMessage: null, version: { increment: 1 } },
    });
    const mission = await tx.mission.findUniqueOrThrow({ where: { id: p.missionId } });
    const c = duplicate || mission.status === 'CANCELLED' ? { ruleId: null, rateBps: 0, baseXof: 0n, amountXof: 0n } : await this.billing.commissionFor(tx, p, now);
    await tx.commission.create({ data: { missionId: p.missionId, paymentId: p.id, ruleId: c.ruleId, baseXof: c.baseXof, rateBps: c.rateBps, amountXof: c.amountXof, createdAt: now } });
    await this.ledger.capture(tx, { paymentId: p.id, missionId: p.missionId, proId: mission.proId, amountXof: p.amountXof, commissionXof: c.amountXof, reference: p.merchantReference }, now);

    if (duplicate) {
      await this.refunds.refundInFull(tx, p.id, 'Paiement en double', now);
      return 'SUCCEEDED';
    }
    if (mission.status === 'CANCELLED') {
      await this.refunds.refundInFull(tx, p.id, 'Paiement reçu après l’annulation de la mission', now);
      return 'SUCCEEDED';
    }
    if (p.purpose !== 'SUPPLEMENT' && mission.status === 'PAYMENT_PENDING') {
      await this.missions.transition(p.missionId, 'PAYMENT_CONFIRMED', 'PAYMENT', null, { now, metadata: { paymentId: p.id } }, tx);
    }
    const amount = formatXof(p.amountXof);
    await this.notifications.notify(p.payerId, 'client.PAYMENT_CONFIRMED', { amount, reference: mission.reference }, { missionId: p.missionId, paymentId: p.id }, tx);
    await this.notifications.notify(mission.proId, 'pro.PAYMENT_CONFIRMED', { amount, reference: mission.reference }, { missionId: p.missionId }, tx);
    return 'SUCCEEDED';
  }

  // ------------------------------------------------------------------ tâches de fond

  async tick(now = new Date()): Promise<PaymentsTickReport> {
    const report: PaymentsTickReport = { verified: 0, succeeded: 0, expired: 0, reminders: 0, missionsCancelled: 0 };
    // 1. Revérification des paiements en attente (notification perdue, validation tardive sur le téléphone).
    const pending = await this.prisma.$queryRaw<{ id: string; expiresAt: Date | null; hasCheckout: boolean }[]>`
      SELECT id, expires_at AS "expiresAt", checkout_url IS NOT NULL AS "hasCheckout" FROM payments
      WHERE status IN ('INITIATED','PENDING') AND COALESCE(last_verified_at, initiated_at) <= ${new Date(now.getTime() - REVERIFY_AFTER_MS)}
      ORDER BY COALESCE(last_verified_at, initiated_at) LIMIT 100`;
    for (const p of pending) {
      let status: string = 'INITIATED';
      if (p.hasCheckout) {
        status = await this.verifyAndApply(p.id, now);
        report.verified++;
        if (status === 'SUCCEEDED') report.succeeded++;
      }
      const overdue = p.expiresAt && p.expiresAt.getTime() + EXPIRY_GRACE_MS <= now.getTime();
      if ((status === 'PENDING' || status === 'INITIATED') && (overdue || !p.hasCheckout)) {
        const n = await this.prisma.payment.updateMany({ where: { id: p.id, status: { in: ['INITIATED', 'PENDING'] } }, data: { status: 'EXPIRED', failureCode: 'EXPIRED', failureMessage: 'Paiement non finalisé dans le délai.' } });
        report.expired += n.count;
      }
    }

    // 2. Relance du client qui n'a pas encore payé.
    const reminderMin = await this.settings.number('payment.reminder_minutes', 15);
    const toRemind = await this.prisma.mission.findMany({
      where: { status: 'PAYMENT_PENDING', paymentReminderAt: null, paymentPendingSince: { lte: new Date(now.getTime() - reminderMin * 60_000) } },
      take: 200,
    });
    for (const m of toRemind) {
      const claimed = await this.prisma.mission.updateMany({ where: { id: m.id, status: 'PAYMENT_PENDING', paymentReminderAt: null }, data: { paymentReminderAt: now } });
      if (!claimed.count) continue;
      const due = await this.billing.due(this.prisma, m.id).catch(() => null);
      if (!due) continue;
      await this.notifications.notify(m.clientId, 'client.PAYMENT_REMINDER', { amount: formatXof(due.amountXof), reference: m.reference }, { missionId: m.id });
      report.reminders++;
    }

    // 3. Paiement jamais reçu avant le déplacement : la mission est annulée sans frais et le professionnel libéré.
    const timeoutMin = await this.settings.number('payment.timeout_minutes', 120);
    const late = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM missions m
      WHERE m.status = 'PAYMENT_PENDING' AND m.en_route_at IS NULL AND m.payment_pending_since <= ${new Date(now.getTime() - timeoutMin * 60_000)}
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.mission_id = m.id AND p.status IN ('INITIATED','PENDING'))
      LIMIT 100`;
    for (const { id } of late) {
      try {
        const r = await this.missions.transition(id, 'CANCELLED', 'SYSTEM', null, { now, reason: 'Paiement non reçu dans le délai' });
        if (r.changed) report.missionsCancelled++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
      }
    }
    return report;
  }
}
