import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

type Tx = Prisma.TransactionClient;

/**
 * Comptes du grand livre (partie double ; montant > 0 = débit, < 0 = crédit) :
 * - CLIENT_FUNDS_IN : fonds des clients détenus chez le prestataire de paiement agréé ;
 * - PRO_PAYABLE (par professionnel) : ce qu'Ineed doit au professionnel ;
 * - INEED_REVENUE : commissions d'Ineed.
 * Chaque transaction est équilibrée (contrôle en base, différé à la validation) et les écritures sont en ajout seul.
 */
export type LedgerAccount = 'CLIENT_FUNDS_IN' | 'PRO_PAYABLE' | 'INEED_REVENUE';

interface Entry {
  account: LedgerAccount;
  amountXof: bigint;
  proId?: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  private async post(
    tx: Tx,
    kind: 'PAYMENT_CAPTURED' | 'COMMISSION' | 'REFUND',
    refs: { paymentId?: string; refundId?: string; missionId: string; createdBy?: string | null },
    description: string,
    entries: Entry[],
    now: Date,
  ) {
    const lines = entries.filter((e) => e.amountXof !== 0n);
    if (!lines.length) return;
    const sum = lines.reduce((s, e) => s + e.amountXof, 0n);
    if (sum !== 0n) throw new Error(`Écriture déséquilibrée (${kind}) : ${sum}`);
    await tx.ledgerTransaction.create({
      data: {
        kind, paymentId: refs.paymentId ?? null, refundId: refs.refundId ?? null, missionId: refs.missionId, createdBy: refs.createdBy ?? null, description, createdAt: now,
        ledgerEntries: { create: lines.map((e) => ({ account: e.account, proId: e.account === 'PRO_PAYABLE' ? e.proId! : null, amountXof: e.amountXof })) },
      },
    });
  }

  /** Paiement encaissé : fonds reçus, dus au professionnel ; puis commission d'Ineed prélevée sur ce dû. */
  async capture(tx: Tx, p: { paymentId: string; missionId: string; proId: string; amountXof: bigint; commissionXof: bigint; reference: string }, now: Date) {
    await this.post(tx, 'PAYMENT_CAPTURED', p, `Paiement ${p.reference}`, [
      { account: 'CLIENT_FUNDS_IN', amountXof: p.amountXof },
      { account: 'PRO_PAYABLE', proId: p.proId, amountXof: -p.amountXof },
    ], now);
    await this.post(tx, 'COMMISSION', p, `Commission ${p.reference}`, [
      { account: 'PRO_PAYABLE', proId: p.proId, amountXof: p.commissionXof },
      { account: 'INEED_REVENUE', amountXof: -p.commissionXof },
    ], now);
  }

  /** Remboursement effectué : les fonds sortent ; le dû au professionnel et la commission sont réduits d'autant. */
  async refund(tx: Tx, r: { refundId: string; paymentId: string; missionId: string; proId: string; amountXof: bigint; commissionShareXof: bigint; createdBy: string | null; reference: string }, now: Date) {
    await this.post(tx, 'REFUND', r, `Remboursement ${r.reference}`, [
      { account: 'CLIENT_FUNDS_IN', amountXof: -r.amountXof },
      { account: 'PRO_PAYABLE', proId: r.proId, amountXof: r.amountXof - r.commissionShareXof },
      { account: 'INEED_REVENUE', amountXof: r.commissionShareXof },
    ], now);
  }

  /** Soldes par compte (positif = débiteur). La somme de tous les comptes vaut toujours zéro. */
  async balances(db: Tx | PrismaService = this.prisma) {
    const rows = await db.$queryRaw<{ account: string; total: bigint }[]>`
      SELECT account, COALESCE(sum(amount_xof), 0)::bigint AS total FROM ledger_entries GROUP BY account ORDER BY account`;
    const [all] = await db.$queryRaw<{ total: bigint; n: bigint }[]>`SELECT COALESCE(sum(amount_xof), 0)::bigint AS total, count(*)::bigint AS n FROM ledger_entries`;
    return { accounts: Object.fromEntries(rows.map((r) => [r.account, r.total])), total: all!.total, entries: all!.n };
  }

  /** Montant dû par Ineed au professionnel (solde créditeur de son compte). */
  async proPayable(proId: string, missionId?: string, db: Tx | PrismaService = this.prisma): Promise<bigint> {
    const [r] = missionId
      ? await db.$queryRaw<{ total: bigint }[]>`
          SELECT COALESCE(-sum(e.amount_xof), 0)::bigint AS total FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
          WHERE e.account = 'PRO_PAYABLE' AND e.pro_id = ${proId}::uuid AND t.mission_id = ${missionId}::uuid`
      : await db.$queryRaw<{ total: bigint }[]>`
          SELECT COALESCE(-sum(amount_xof), 0)::bigint AS total FROM ledger_entries WHERE account = 'PRO_PAYABLE' AND pro_id = ${proId}::uuid`;
    return r!.total;
  }
}
