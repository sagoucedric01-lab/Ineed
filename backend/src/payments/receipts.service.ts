import { Injectable } from '@nestjs/common';
import { LedgerService } from '../billing/ledger.service.js';
import { AppError } from '../common/http/api-error.js';
import { formatXof } from '../common/money/xof.js';
import { formatPhone } from '../common/phone/phone.js';
import { formatDateTime } from '../common/time/business-time.js';
import { PrismaService } from '../infra/prisma.service.js';

const PURPOSE_LABEL = { FULL: 'Prestation', TRAVEL_FEE: 'Frais de déplacement', WORK: 'Travaux', SUPPLEMENT: 'Frais supplémentaires' } as const;
const METHOD_LABEL: Record<string, string> = { ORANGE_MONEY: 'Orange Money', MTN_MOMO: 'MTN Mobile Money', MOOV_MONEY: 'Moov Money', WAVE: 'Wave', CARD: 'Carte bancaire', SANDBOX: 'Simulation' };

/** Masque un numéro : « +225 07 •• •• •• 12 ». */
export function maskPhone(e164: string | null): string | null {
  if (!e164) return null;
  const parts = formatPhone(e164).split(' ');
  if (parts.length < 4) return parts[0] ?? null;
  return [parts[0], parts[1], ...parts.slice(2, -1).map(() => '••'), parts.at(-1)].join(' ');
}

/** Reçus de paiement et revenus des professionnels (lecture seule). */
@Injectable()
export class ReceiptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Reçu d'un paiement réussi. Ce n'est pas une facture : les mentions fiscales obligatoires restent à
   * définir avec un conseil (docs/phase-1/05-prestataires-externes.md §5.3).
   */
  async receipt(clientId: string, paymentId: string) {
    const p = await this.prisma.payment.findFirst({
      where: { id: paymentId, payerId: clientId },
      include: { refunds: true, payer: true, quote: { include: { quoteLines: true } }, mission: { include: { pro: true, request: { include: { category: true, service: true } } } } },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Ce paiement n’existe pas.');
    if (p.status !== 'SUCCEEDED' || !p.confirmedAt) throw new AppError(409, 'RECEIPT_UNAVAILABLE', 'Le reçu sera disponible une fois le paiement confirmé.');
    const lines = p.quote
      ? [...p.quote.quoteLines].sort((a, b) => a.position - b.position).map((l) => ({ label: l.label, quantity: l.quantity, unitPriceXof: Number(l.unitPriceXof), amountXof: Number(l.amountXof ?? 0n) }))
      : [{ label: PURPOSE_LABEL[p.purpose], quantity: 1, unitPriceXof: Number(p.amountXof), amountXof: Number(p.amountXof) }];
    const refunded = p.refunds.filter((r) => r.status === 'SUCCEEDED');
    return {
      receiptNumber: `RC-${p.merchantReference}`,
      issuedAt: p.confirmedAt.toISOString(),
      issuedAtText: formatDateTime(p.confirmedAt),
      isSandbox: p.isSandbox,
      notice: p.isSandbox
        ? 'SIMULATION — aucun paiement réel n’a eu lieu. Ce document n’a aucune valeur.'
        : `Paiement reçu par Ineed via son prestataire de paiement agréé, pour le compte de ${p.mission.pro.businessName}. Ce reçu n’est pas une facture.`,
      payer: { firstName: p.payer.firstName, phone: maskPhone(p.payer.phoneE164) },
      pro: { businessName: p.mission.pro.businessName },
      mission: { reference: p.mission.reference, category: p.mission.request.category.name, service: p.mission.request.service?.name ?? null },
      purpose: PURPOSE_LABEL[p.purpose],
      quoteVersion: p.quote?.version ?? null,
      lines,
      amountXof: Number(p.amountXof),
      amountText: formatXof(p.amountXof),
      method: p.method ? (METHOD_LABEL[p.method] ?? p.method) : null,
      transactionReference: p.providerTxnId,
      merchantReference: p.merchantReference,
      refunds: refunded.map((r) => ({ amountXof: Number(r.amountXof), amountText: formatXof(r.amountXof), completedAt: r.completedAt?.toISOString() ?? null, reason: r.reason })),
    };
  }

  /**
   * Revenus du professionnel d'après le grand livre : montant dû par mission, « en attente » tant que la mission
   * n'est pas clôturée (fonds conservés chez le prestataire), « disponible » ensuite. Les reversements arrivent
   * avec l'administration (phase 9).
   */
  async earnings(proId: string) {
    const rows = await this.prisma.$queryRaw<{ missionId: string; reference: string; status: string; net: bigint; gross: bigint; commission: bigint; refunded: bigint }[]>`
      SELECT m.id AS "missionId", m.reference, m.status::text AS status,
             COALESCE(-sum(e.amount_xof) FILTER (WHERE e.account = 'PRO_PAYABLE'), 0)::bigint AS net,
             COALESCE(-sum(e.amount_xof) FILTER (WHERE e.account = 'PRO_PAYABLE' AND t.kind = 'PAYMENT_CAPTURED'), 0)::bigint AS gross,
             COALESCE(sum(e.amount_xof) FILTER (WHERE e.account = 'PRO_PAYABLE' AND t.kind = 'COMMISSION'), 0)::bigint AS commission,
             COALESCE(sum(e.amount_xof) FILTER (WHERE e.account = 'PRO_PAYABLE' AND t.kind = 'REFUND'), 0)::bigint AS refunded
      FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id JOIN missions m ON m.id = t.mission_id
      WHERE e.pro_id = ${proId}::uuid
      GROUP BY m.id ORDER BY max(t.created_at) DESC LIMIT 100`;
    const available = (s: string) => s === 'CLOSED' || s === 'CANCELLED';
    let held = 0n;
    let free = 0n;
    for (const r of rows) {
      if (available(r.status)) free += r.net;
      else held += r.net;
    }
    return {
      totalDueXof: Number(await this.ledger.proPayable(proId)),
      heldXof: Number(held),
      availableXof: Number(free),
      missions: rows.map((r) => ({ missionId: r.missionId, reference: r.reference, status: r.status, grossXof: Number(r.gross), commissionXof: Number(r.commission), refundedXof: Number(r.refunded), netXof: Number(r.net), available: available(r.status) })),
    };
  }
}
