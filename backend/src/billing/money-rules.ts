/**
 * Règles de calcul monétaire (francs CFA entiers, aucun nombre à virgule).
 * Fonctions pures : testées unitairement, utilisées par le paiement, la commission et les remboursements.
 */

export type LineKind = 'TRAVEL' | 'LABOR' | 'MATERIAL' | 'OTHER';

export interface CommissionRuleInput {
  rateBps: number;
  minXof: bigint;
  appliesToTravelFee: boolean;
}

export interface CommissionResult {
  baseXof: bigint;
  amountXof: bigint;
}

/** Arrondi au franc le plus proche (demi-franc vers le haut). */
export function roundDiv(n: bigint, d: bigint): bigint {
  return (n * 2n + d) / (2n * d);
}

/**
 * Assiette de la commission d'un paiement : main-d'œuvre et autres lignes ; les matériaux sont exclus
 * (décision D9) ; le déplacement seulement si la règle le prévoit. Sans détail de lignes (prix fixe,
 * frais de déplacement seuls), l'assiette est le montant payé, ou zéro pour des frais de déplacement exclus.
 */
export function commissionBase(amountXof: bigint, purpose: 'FULL' | 'TRAVEL_FEE' | 'WORK' | 'SUPPLEMENT', rule: CommissionRuleInput, lines?: { kind: LineKind; amountXof: bigint }[]): bigint {
  if (purpose === 'TRAVEL_FEE') return rule.appliesToTravelFee ? amountXof : 0n;
  if (!lines) return amountXof;
  let base = 0n;
  for (const l of lines) {
    if (l.kind === 'MATERIAL') continue;
    if (l.kind === 'TRAVEL' && !rule.appliesToTravelFee) continue;
    base += l.amountXof;
  }
  return base > amountXof ? amountXof : base;
}

/** Commission = taux × assiette, au moins le minimum de la règle, jamais plus que l'assiette. */
export function computeCommission(baseXof: bigint, rule: CommissionRuleInput): CommissionResult {
  if (baseXof <= 0n) return { baseXof: 0n, amountXof: 0n };
  let amount = roundDiv(baseXof * BigInt(rule.rateBps), 10_000n);
  if (amount < rule.minXof) amount = rule.minXof;
  if (amount > baseXof) amount = baseXof;
  return { baseXof, amountXof: amount };
}

/**
 * Part de la commission rendue lors d'un remboursement de `refundXof` sur un paiement de `paidXof` :
 * proportionnelle, arrondie vers le bas. Un remboursement total rend toute la commission.
 */
export function refundedCommission(commissionXof: bigint, refundXof: bigint, paidXof: bigint): bigint {
  if (refundXof >= paidXof) return commissionXof;
  return (commissionXof * refundXof) / paidXof;
}

export interface PaidItem {
  paymentId: string;
  purpose: 'FULL' | 'TRAVEL_FEE' | 'WORK' | 'SUPPLEMENT';
  amountXof: bigint;
  /** Déjà remboursé ou en cours de remboursement. */
  refundedXof: bigint;
}

/**
 * Remboursements dus à l'annulation d'une mission. Sans frais : tout est rendu. Frais de déplacement dus :
 * le paiement des frais de déplacement est conservé ; à défaut, `travelFeeXof` est retenu sur le paiement
 * global et le reste rendu.
 */
export function cancellationRefunds(paid: PaidItem[], terms: 'FREE' | 'TRAVEL_FEE_DUE', travelFeeXof: bigint): { paymentId: string; amountXof: bigint; retainedXof: bigint }[] {
  const out: { paymentId: string; amountXof: bigint; retainedXof: bigint }[] = [];
  let toRetain = terms === 'TRAVEL_FEE_DUE' ? travelFeeXof : 0n;
  const hasTravelPayment = paid.some((p) => p.purpose === 'TRAVEL_FEE');
  // Les frais de déplacement payés à part sont retenus en priorité.
  const ordered = [...paid].sort((a, b) => Number(b.purpose === 'TRAVEL_FEE') - Number(a.purpose === 'TRAVEL_FEE'));
  for (const p of ordered) {
    const refundable = p.amountXof - p.refundedXof;
    if (refundable <= 0n) continue;
    let retained = 0n;
    if (terms === 'TRAVEL_FEE_DUE') {
      if (p.purpose === 'TRAVEL_FEE') retained = refundable;
      else if (!hasTravelPayment && p.purpose === 'FULL') retained = toRetain < refundable ? toRetain : refundable;
      toRetain -= retained;
      if (toRetain < 0n) toRetain = 0n;
    }
    const amount = refundable - retained;
    out.push({ paymentId: p.paymentId, amountXof: amount, retainedXof: retained });
  }
  return out;
}
