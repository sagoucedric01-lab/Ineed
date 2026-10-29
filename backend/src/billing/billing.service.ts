import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import type { PaymentPurpose, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { commissionBase, computeCommission } from './money-rules.js';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

export interface DueItem {
  purpose: PaymentPurpose;
  quoteId: string | null;
  amountXof: bigint;
  label: string;
}

/** Ce qui est dû à chaque étape : calculé côté serveur, jamais fourni par l'application. */
@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  private async paidFor(db: Db, missionId: string, purpose: PaymentPurpose, quoteId: string | null): Promise<boolean> {
    return (await db.payment.count({ where: { missionId, purpose, quoteId, status: 'SUCCEEDED', isDuplicate: false } })) > 0;
  }

  /** Dernier devis accepté d'un type donné. */
  acceptedQuote(db: Db, missionId: string, kind: 'INITIAL' | 'SUPPLEMENT') {
    return db.quote.findFirst({ where: { missionId, kind, status: 'ACCEPTED' }, orderBy: { version: 'desc' }, include: { quoteLines: true } });
  }

  /** Frais de déplacement de la mission (proposés par le professionnel, sinon ceux du catalogue). */
  async travelFee(db: Db, missionId: string): Promise<bigint> {
    const m = await db.mission.findUniqueOrThrow({ where: { id: missionId }, include: { offer: true, request: { include: { service: true } } } });
    if (m.pricingModel === 'QUOTE') {
      const q = await this.acceptedQuote(db, missionId, 'INITIAL');
      return (q?.quoteLines ?? []).filter((l) => l.kind === 'TRAVEL').reduce((s, l) => s + (l.amountXof ?? 0n), 0n);
    }
    return m.offer?.proposedTravelFeeXof ?? m.request.service?.defaultTravelFeeXof ?? 0n;
  }

  /**
   * Montant à régler maintenant pour une mission, ou null si rien n'est dû.
   * - En attente de paiement : devis accepté (prestation sur devis ou travaux après diagnostic), prix fixe,
   *   ou frais de déplacement avant le diagnostic sur place ;
   * - pendant l'intervention : frais supplémentaires acceptés et non encore payés.
   */
  async due(db: Db, missionId: string): Promise<DueItem | null> {
    const m = await db.mission.findUniqueOrThrow({ where: { id: missionId }, include: { offer: true, request: { include: { service: true } } } });
    if (m.status === 'PAYMENT_PENDING') {
      if (m.pricingModel === 'TRAVEL_PLUS_DIAGNOSIS' && !m.arrivedAt) {
        if (await this.paidFor(db, missionId, 'TRAVEL_FEE', null)) return null;
        return { purpose: 'TRAVEL_FEE', quoteId: null, amountXof: await this.travelFee(db, missionId), label: 'Frais de déplacement' };
      }
      if (m.pricingModel === 'FIXED') {
        if (await this.paidFor(db, missionId, 'FULL', null)) return null;
        const price = m.offer?.proposedPriceXof ?? m.request.service?.fixedPriceXof;
        if (price === null || price === undefined) throw new AppError(409, 'PRICE_MISSING', 'Le prix de cette prestation n’est pas défini. Contactez l’assistance.');
        return { purpose: 'FULL', quoteId: null, amountXof: price, label: 'Prestation au prix fixe' };
      }
      const q = await this.acceptedQuote(db, missionId, 'INITIAL');
      if (!q) throw new AppError(409, 'QUOTE_REQUIRED', 'Aucun devis accepté pour cette mission.');
      const purpose: PaymentPurpose = m.pricingModel === 'TRAVEL_PLUS_DIAGNOSIS' ? 'WORK' : 'FULL';
      if (await this.paidFor(db, missionId, purpose, q.id)) return null;
      return { purpose, quoteId: q.id, amountXof: q.totalXof, label: `Devis n° ${q.version}` };
    }
    const supplements = await db.quote.findMany({ where: { missionId, kind: 'SUPPLEMENT', status: 'ACCEPTED' }, orderBy: { version: 'asc' } });
    for (const s of supplements) {
      if (!(await this.paidFor(db, missionId, 'SUPPLEMENT', s.id))) return { purpose: 'SUPPLEMENT', quoteId: s.id, amountXof: s.totalXof, label: `Frais supplémentaires (devis n° ${s.version})` };
    }
    return null;
  }

  /** Frais supplémentaires acceptés et non payés : bloquent la fin de l'intervention. */
  async hasUnpaidSupplement(db: Db, missionId: string): Promise<boolean> {
    const [r] = await db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM quotes q
      WHERE q.mission_id = ${missionId}::uuid AND q.kind = 'SUPPLEMENT' AND q.status = 'ACCEPTED'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.quote_id = q.id AND p.status = 'SUCCEEDED' AND NOT p.is_duplicate)`;
    return r!.n > 0n;
  }

  /** Règle de commission applicable : celle de la catégorie si elle existe, sinon la règle par défaut. */
  async commissionRule(db: Db, categoryId: string, at: Date) {
    const rules = await db.commissionRule.findMany({
      where: { OR: [{ categoryId }, { categoryId: null }], validFrom: { lte: at }, AND: [{ OR: [{ validTo: null }, { validTo: { gt: at } }] }] },
      orderBy: { validFrom: 'desc' },
    });
    return rules.find((r) => r.categoryId === categoryId) ?? rules.find((r) => r.categoryId === null) ?? null;
  }

  async commissionFor(db: Db, p: { missionId: string; quoteId: string | null; purpose: PaymentPurpose; amountXof: bigint }, at: Date) {
    const m = await db.mission.findUniqueOrThrow({ where: { id: p.missionId }, include: { request: true } });
    const rule = await this.commissionRule(db, m.request.categoryId, at);
    if (!rule) return { ruleId: null, rateBps: 0, baseXof: 0n, amountXof: 0n };
    const input = { rateBps: rule.rateBps, minXof: rule.minXof, appliesToTravelFee: rule.appliesToTravelFee };
    const lines = p.quoteId
      ? (await db.quoteLine.findMany({ where: { quoteId: p.quoteId } })).map((l) => ({ kind: l.kind, amountXof: l.amountXof ?? 0n }))
      : undefined;
    const c = computeCommission(commissionBase(p.amountXof, p.purpose, input, lines), input);
    return { ruleId: rule.id, rateBps: rule.rateBps, ...c };
  }
}
