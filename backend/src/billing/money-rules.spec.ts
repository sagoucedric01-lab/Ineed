import { describe, expect, it } from 'vitest';
import { cancellationRefunds, commissionBase, computeCommission, refundedCommission, roundDiv } from './money-rules.js';

const rule = { rateBps: 1000, minXof: 0n, appliesToTravelFee: false };

describe('règles monétaires', () => {
  it('arrondit au franc le plus proche', () => {
    expect(roundDiv(25n, 10n)).toBe(3n);
    expect(roundDiv(24n, 10n)).toBe(2n);
    expect(roundDiv(10n, 10n)).toBe(1n);
  });

  it('commission : 10 % de la main-d’œuvre, hors matériaux et hors déplacement', () => {
    const lines = [
      { kind: 'TRAVEL' as const, amountXof: 2000n },
      { kind: 'LABOR' as const, amountXof: 15000n },
      { kind: 'MATERIAL' as const, amountXof: 8000n },
      { kind: 'OTHER' as const, amountXof: 1005n },
    ];
    const base = commissionBase(26005n, 'FULL', rule, lines);
    expect(base).toBe(16005n);
    expect(computeCommission(base, rule)).toEqual({ baseXof: 16005n, amountXof: 1601n });
    expect(commissionBase(26005n, 'FULL', { ...rule, appliesToTravelFee: true }, lines)).toBe(18005n);
  });

  it('commission : minimum appliqué mais jamais au-delà de l’assiette ; assiette nulle = pas de commission', () => {
    expect(computeCommission(1000n, { ...rule, minXof: 500n }).amountXof).toBe(500n);
    expect(computeCommission(300n, { ...rule, minXof: 500n }).amountXof).toBe(300n);
    expect(computeCommission(0n, { ...rule, minXof: 500n }).amountXof).toBe(0n);
    expect(commissionBase(3000n, 'TRAVEL_FEE', rule)).toBe(0n);
    expect(commissionBase(3000n, 'TRAVEL_FEE', { ...rule, appliesToTravelFee: true })).toBe(3000n);
    expect(commissionBase(5000n, 'FULL', rule)).toBe(5000n);
  });

  it('remboursement : part de commission proportionnelle, totale pour un remboursement complet', () => {
    expect(refundedCommission(1500n, 20000n, 20000n)).toBe(1500n);
    expect(refundedCommission(1500n, 10000n, 20000n)).toBe(750n);
    expect(refundedCommission(1001n, 1n, 3n)).toBe(333n);
  });

  it('annulation sans frais : tout est rendu, déjà remboursé déduit', () => {
    expect(cancellationRefunds([{ paymentId: 'a', purpose: 'FULL', amountXof: 20000n, refundedXof: 0n }], 'FREE', 3000n)).toEqual([{ paymentId: 'a', amountXof: 20000n, retainedXof: 0n }]);
    expect(cancellationRefunds([{ paymentId: 'a', purpose: 'FULL', amountXof: 20000n, refundedXof: 5000n }], 'FREE', 0n)).toEqual([{ paymentId: 'a', amountXof: 15000n, retainedXof: 0n }]);
  });

  it('annulation avec frais de déplacement : retenus sur le paiement global, ou paiement des frais conservé', () => {
    expect(cancellationRefunds([{ paymentId: 'a', purpose: 'FULL', amountXof: 20000n, refundedXof: 0n }], 'TRAVEL_FEE_DUE', 3000n)).toEqual([{ paymentId: 'a', amountXof: 17000n, retainedXof: 3000n }]);
    expect(cancellationRefunds([{ paymentId: 'a', purpose: 'FULL', amountXof: 2000n, refundedXof: 0n }], 'TRAVEL_FEE_DUE', 3000n)).toEqual([{ paymentId: 'a', amountXof: 0n, retainedXof: 2000n }]);
    const split = cancellationRefunds(
      [
        { paymentId: 'w', purpose: 'WORK', amountXof: 30000n, refundedXof: 0n },
        { paymentId: 't', purpose: 'TRAVEL_FEE', amountXof: 2500n, refundedXof: 0n },
      ],
      'TRAVEL_FEE_DUE',
      2500n,
    );
    expect(split).toEqual([
      { paymentId: 't', amountXof: 0n, retainedXof: 2500n },
      { paymentId: 'w', amountXof: 30000n, retainedXof: 0n },
    ]);
  });
});
