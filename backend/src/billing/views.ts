import type { Prisma } from '../generated/prisma/client.js';

const num = (v: bigint | null | undefined) => (v === null || v === undefined ? null : Number(v));
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export type QuoteWithLines = Prisma.QuoteGetPayload<{ include: { quoteLines: true } }>;

export function quoteView(q: QuoteWithLines, now = new Date()) {
  return {
    id: q.id,
    version: q.version,
    kind: q.kind,
    status: q.status,
    totalXof: Number(q.totalXof),
    validUntil: q.validUntil.toISOString(),
    /** Encore modifiable par le client (accepter ou refuser) : soumis et non expiré. */
    open: q.status === 'SUBMITTED' && q.validUntil > now,
    conditions: q.conditions,
    estimatedDurationMin: q.estimatedDurationMin,
    submittedAt: iso(q.submittedAt),
    decidedAt: iso(q.decidedAt),
    rejectionReason: q.rejectionReason,
    lines: [...q.quoteLines]
      .sort((a, b) => a.position - b.position)
      .map((l) => ({ kind: l.kind, label: l.label, quantity: l.quantity, unitPriceXof: Number(l.unitPriceXof), amountXof: num(l.amountXof), justification: l.justification })),
  };
}

export type PaymentWithRefunds = Prisma.PaymentGetPayload<{ include: { refunds: true } }>;

export function paymentView(p: PaymentWithRefunds) {
  return {
    id: p.id,
    purpose: p.purpose,
    quoteId: p.quoteId,
    amountXof: Number(p.amountXof),
    status: p.status,
    method: p.method,
    provider: p.provider,
    /** Paiement simulé (développement) : aucun argent réel. */
    isSandbox: p.isSandbox,
    checkoutUrl: p.status === 'INITIATED' || p.status === 'PENDING' ? p.checkoutUrl : null,
    initiatedAt: p.initiatedAt.toISOString(),
    expiresAt: iso(p.expiresAt),
    confirmedAt: iso(p.confirmedAt),
    failureMessage: p.failureMessage,
    receiptAvailable: p.status === 'SUCCEEDED',
    refunds: p.refunds.map((r) => ({ id: r.id, amountXof: Number(r.amountXof), status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString(), completedAt: iso(r.completedAt) })),
  };
}
