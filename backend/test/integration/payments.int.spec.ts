import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PAYMENT_PROVIDER } from '../../src/billing/providers/payment-provider.js';
import { SANDBOX_SIGNATURE_HEADER, type SandboxPaymentProvider } from '../../src/billing/providers/sandbox.provider.js';
import { RefundsService } from '../../src/billing/refunds.service.js';
import { PrismaService } from '../../src/infra/prisma.service.js';
import { PaymentsService } from '../../src/payments/payments.service.js';
import { QuotesService } from '../../src/quotes/quotes.service.js';
import { runMoneyJobs } from '../../src/worker/money-loop.js';
import {
  adminLogin, bearer, createAdmin, createTestPro, DEFAULT_QUOTE_LINES, flushRedis, loginWithPhone, payWithSandbox, startTestContext, type TestContext, type Tokens,
} from '../helpers/api.js';

const PLACE = { location: { lat: 5.36, lng: -3.97 }, landmark: 'Derrière la pharmacie, portail vert' };
const later = (minutes: number) => new Date(Date.now() + minutes * 60_000);
let keySeq = 0;
const key = () => `cle-test-${Date.now()}-${keySeq++}`;

describe('Devis, paiements et remboursements', () => {
  let ctx: TestContext;
  const saved = { ...process.env };
  const proTokens = new Map<string, Tokens>();
  let phone = 100;
  /** Tâches de fond de l'argent, comme le worker les exécute (avec une horloge avancée si besoin). */
  const loop = () => ({
    run: (now?: Date) => runMoneyJobs({ payments: ctx.app.get(PaymentsService), quotes: ctx.app.get(QuotesService), refunds: ctx.app.get(RefundsService), prisma: ctx.app.get(PrismaService) }, now),
  });
  const sandbox = () => ctx.app.get<SandboxPaymentProvider>(PAYMENT_PROVIDER);

  async function newClient(): Promise<{ tokens: Tokens; userId: string }> {
    await flushRedis();
    return loginWithPhone(ctx, `07070${String(phone++).padStart(5, '0')}`);
  }

  async function newPro(categorySlug = 'plomberie') {
    const p = await createTestPro(ctx, { phone: `07060${String(phone++).padStart(5, '0')}`, businessName: `Pro paiement ${phone}`, categorySlugs: [categorySlug], online: true, live: { lat: 5.361, lng: -3.97 } });
    proTokens.set(p.userId, p.tokens);
    return p;
  }

  interface Assigned {
    missionId: string;
    client: Tokens;
    clientId: string;
    pro: Tokens;
    proId: string;
  }

  /** Demande urgente publiée, acceptée par un professionnel, confirmée par le client : mission créée. */
  async function assigned(categorySlug = 'plomberie', extra: Record<string, unknown> = {}): Promise<Assigned> {
    await newPro(categorySlug);
    const c = await newClient();
    const category = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: categorySlug } });
    const d = await ctx.http.post('/v1/requests').set(bearer(c.tokens))
      .send({ categoryId: category.id, mode: 'URGENT', description: 'Fuite sous l’évier de la cuisine, à réparer vite.', place: PLACE, ...extra }).expect(201);
    await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(c.tokens)).expect(200);
    const offer = await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId: d.body.id }, orderBy: { sentAt: 'asc' } });
    const pro = proTokens.get(offer.proId)!;
    await ctx.http.post(`/v1/pro/offers/${offer.id}/accept`).set(bearer(pro)).expect(200);
    const confirmed = await ctx.http.post(`/v1/requests/${d.body.id}/confirm`).set(bearer(c.tokens)).expect(200);
    return { missionId: confirmed.body.missionId, client: c.tokens, clientId: c.userId, pro, proId: offer.proId };
  }

  const mission = (id: string) => ctx.prisma.mission.findUniqueOrThrow({ where: { id } });
  const notified = (userId: string, type: string) => ctx.prisma.notification.count({ where: { userId, type } });
  const submitQuote = (a: Assigned, body: Record<string, unknown>, k = key()) => ctx.http.post(`/v1/pro/missions/${a.missionId}/quotes`).set(bearer(a.pro)).set('Idempotency-Key', k).send(body);
  const acceptQuote = (a: Assigned, quoteId: string, k = key()) => ctx.http.post(`/v1/missions/${a.missionId}/quotes/${quoteId}/accept`).set(bearer(a.client)).set('Idempotency-Key', k).send({});
  const pay = (a: Assigned, k = key()) => ctx.http.post(`/v1/missions/${a.missionId}/payments`).set(bearer(a.client)).set('Idempotency-Key', k).send({});
  const refOf = (checkoutUrl: string) => checkoutUrl.split('/').pop()!;
  const checkout = (ref: string, outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED') => ctx.http.post(`/v1/payments/sandbox/checkout/${ref}`).type('form').send({ outcome, method: 'MTN_MOMO' }).expect(200);

  async function ledgerTotal(): Promise<bigint> {
    const [r] = await ctx.prisma.$queryRaw<{ s: bigint }[]>`SELECT COALESCE(sum(amount_xof), 0)::bigint AS s FROM ledger_entries`;
    return r!.s;
  }
  async function accountFor(missionId: string, account: string): Promise<bigint> {
    const [r] = await ctx.prisma.$queryRaw<{ s: bigint }[]>`
      SELECT COALESCE(sum(e.amount_xof), 0)::bigint AS s FROM ledger_entries e JOIN ledger_transactions t ON t.id = e.transaction_id
      WHERE t.mission_id = ${missionId}::uuid AND e.account = ${account}`;
    return r!.s;
  }

  beforeAll(async () => {
    ctx = await startTestContext({ PAYMENT_PROVIDER: 'sandbox' });
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('T12 — création et modification d’un devis', () => {
    let a: Assigned;
    let v1: string;

    it('le professionnel envoie un devis détaillé ; la mission attend la réponse du client', async () => {
      a = await assigned();
      expect((await mission(a.missionId)).status).toBe('AWAITING_QUOTE');
      // Route financière : clé d'idempotence obligatoire.
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/quotes`).set(bearer(a.pro)).send({ lines: DEFAULT_QUOTE_LINES }).expect(400);
      const bad = await submitQuote(a, { lines: [{ kind: 'LABOR', label: 'Main-d’œuvre', unitPriceXof: 13001 }] }).expect(422);
      expect(bad.body.error.code).toBe('QUOTE_AMOUNT_NOT_PAYABLE');
      await submitQuote(a, { lines: [{ kind: 'LABOR', label: 'Gratuit', unitPriceXof: 0 }] }).expect(422);

      const res = await submitQuote(a, { lines: [...DEFAULT_QUOTE_LINES, { kind: 'MATERIAL', label: 'Siphon PVC', quantity: 2, unitPriceXof: 2500 }], conditions: 'Garantie 3 mois sur la pièce', estimatedDurationMin: 60 }).expect(201);
      v1 = res.body.id;
      expect(res.body).toMatchObject({ version: 1, kind: 'INITIAL', status: 'SUBMITTED', totalXof: 20000, open: true });
      expect(res.body.lines.map((l: { amountXof: number }) => l.amountXof)).toEqual([2000, 13000, 5000]);
      expect((await mission(a.missionId)).status).toBe('QUOTE_PENDING_APPROVAL');
      expect(await notified(a.clientId, 'client.QUOTE_RECEIVED')).toBe(1);
    });

    it('un devis envoyé est figé en base ; une modification crée une nouvelle version qui remplace l’ancienne', async () => {
      await expect(ctx.prisma.quoteLine.updateMany({ where: { quoteId: v1 }, data: { unitPriceXof: 1n } })).rejects.toThrow(/immutable/);
      const v2 = await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201);
      expect(v2.body).toMatchObject({ version: 2, totalXof: 15000, status: 'SUBMITTED' });
      const list = await ctx.http.get(`/v1/missions/${a.missionId}/quotes`).set(bearer(a.client)).expect(200);
      expect(list.body.map((q: { version: number; status: string }) => [q.version, q.status])).toEqual([[1, 'SUPERSEDED'], [2, 'SUBMITTED']]);
      const old = await acceptQuote(a, v1).expect(409);
      expect(old.body.error.code).toBe('QUOTE_SUPERSEDED');
      // Un autre professionnel ou un autre client n'y a pas accès.
      const other = await newClient();
      await ctx.http.get(`/v1/missions/${a.missionId}/quotes`).set(bearer(other.tokens)).expect(404);
    });

    it('la clé d’idempotence rejoue la réponse sans créer une seconde version ; réutilisée pour un autre contenu, elle est refusée', async () => {
      const k = key();
      const first = await submitQuote(a, { lines: DEFAULT_QUOTE_LINES, conditions: 'Version 3' }, k).expect(201);
      const again = await submitQuote(a, { lines: DEFAULT_QUOTE_LINES, conditions: 'Version 3' }, k).expect(201);
      expect(again.headers['idempotent-replayed']).toBe('true');
      expect(again.body.id).toBe(first.body.id);
      expect(await ctx.prisma.quote.count({ where: { missionId: a.missionId } })).toBe(3);
      const reused = await submitQuote(a, { lines: DEFAULT_QUOTE_LINES, conditions: 'Autre chose' }, k).expect(422);
      expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('T13 — acceptation ou refus du devis', () => {
    it('refus motivé : la mission attend un nouveau devis, le professionnel est prévenu ; puis acceptation de la nouvelle version', async () => {
      const a = await assigned();
      const v1 = (await submitQuote(a, { lines: [{ kind: 'LABOR', label: 'Main-d’œuvre', unitPriceXof: 30000 }] }).expect(201)).body.id;
      const rejected = await ctx.http.post(`/v1/missions/${a.missionId}/quotes/${v1}/reject`).set(bearer(a.client)).set('Idempotency-Key', key()).send({ reason: 'Trop cher pour moi' }).expect(200);
      expect(rejected.body).toMatchObject({ status: 'REJECTED', rejectionReason: 'Trop cher pour moi' });
      expect((await mission(a.missionId)).status).toBe('AWAITING_QUOTE');
      expect(await notified(a.proId, 'pro.QUOTE_REJECTED')).toBe(1);
      await acceptQuote(a, v1).expect(409);

      const v2 = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      const k = key();
      const accepted = await acceptQuote(a, v2, k).expect(200);
      expect(accepted.body.status).toBe('ACCEPTED');
      // Acceptation renvoyée (réponse perdue) : même réponse, aucun second effet.
      const replay = await acceptQuote(a, v2, k).expect(200);
      expect(replay.headers['idempotent-replayed']).toBe('true');
      await acceptQuote(a, v2).expect(200);
      const m = await mission(a.missionId);
      expect(m.status).toBe('PAYMENT_PENDING');
      const history = await ctx.prisma.missionStatusHistory.findMany({ where: { missionId: a.missionId }, orderBy: { id: 'asc' } });
      expect(history.map((h) => h.toStatus)).toEqual(['AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING']);
      expect(await notified(a.proId, 'pro.QUOTE_ACCEPTED')).toBe(1);
      const view = await ctx.http.get(`/v1/missions/${a.missionId}`).set(bearer(a.client)).expect(200);
      expect(view.body.money.due).toMatchObject({ purpose: 'FULL', amountXof: 15000, quoteId: v2 });
    });

    it('devis expiré sans réponse : la mission attend un nouveau devis, l’acceptation tardive est refusée', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES, validForHours: 1 }).expect(201)).body.id;
      const report = await loop().run(later(61));
      expect(report.quotesExpired).toBe(1);
      expect((await ctx.prisma.quote.findUniqueOrThrow({ where: { id: q } })).status).toBe('EXPIRED');
      expect((await mission(a.missionId)).status).toBe('AWAITING_QUOTE');
      expect(await notified(a.proId, 'pro.QUOTE_EXPIRED')).toBe(1);
      expect((await acceptQuote(a, q).expect(409)).body.error.code).toBe('QUOTE_EXPIRED');
    });
  });

  describe('T14 — paiement réussi', () => {
    let a: Assigned;
    let paymentId: string;
    let ref: string;

    it('le serveur calcule le montant et renvoie la page du prestataire ; rien n’est confirmé avant la vérification', async () => {
      a = await assigned();
      const q = (await submitQuote(a, { lines: [...DEFAULT_QUOTE_LINES, { kind: 'MATERIAL', label: 'Siphon', unitPriceXof: 5000 }] }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const k = key();
      const p = await pay(a, k).expect(201);
      paymentId = p.body.id;
      ref = refOf(p.body.checkoutUrl);
      expect(p.body).toMatchObject({ status: 'PENDING', amountXof: 20000, purpose: 'FULL', isSandbox: true, receiptAvailable: false });
      // Double appui : la même tentative, pas un second paiement.
      expect((await pay(a, k).expect(201)).body.id).toBe(paymentId);
      expect((await pay(a).expect(201)).body.id).toBe(paymentId);
      expect(await ctx.prisma.payment.count({ where: { missionId: a.missionId } })).toBe(1);
      const poll = await ctx.http.get(`/v1/payments/${paymentId}`).set(bearer(a.client)).expect(200);
      expect(poll.body.status).toBe('PENDING');
      expect((await mission(a.missionId)).status).toBe('PAYMENT_PENDING');
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro)).expect(409);
      await ctx.http.get(`/v1/payments/${paymentId}/receipt`).set(bearer(a.client)).expect(409);
    });

    it('une notification falsifiée ou un simple signal sans paiement réel ne confirme rien', async () => {
      const forged = await ctx.http.post('/v1/payments/notify/sandbox').set(SANDBOX_SIGNATURE_HEADER, 'ab'.repeat(32)).send({ merchantReference: ref, nonce: 'faux' });
      expect(forged.status).toBe(401);
      const unsigned = await ctx.http.post('/v1/payments/notify/sandbox').send({ merchantReference: ref, nonce: 'x', status: 'SUCCEEDED' });
      expect(unsigned.status).toBe(401);
      // Notification authentique mais paiement encore en attente chez le prestataire : la vérification l'emporte.
      const n = sandbox().signedNotification(ref, 'signal');
      await ctx.http.post('/v1/payments/notify/sandbox').set(n.headers).send(n.body).expect(200);
      expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe('PENDING');
      expect(await ctx.prisma.paymentProviderEvent.count({ where: { paymentId, signatureValid: false } })).toBe(2);
    });

    it('après le paiement vérifié : mission confirmée, commission, grand livre équilibré, reçu, revenus du professionnel', async () => {
      await checkout(ref, 'SUCCEEDED');
      const p = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { commission: true } });
      expect(p).toMatchObject({ status: 'SUCCEEDED', method: 'MTN_MOMO', isDuplicate: false });
      expect(p.confirmedAt).toBeTruthy();
      // 10 % de la main-d'œuvre (13 000) : matériaux et déplacement exclus.
      expect(p.commission).toMatchObject({ baseXof: 13000n, amountXof: 1300n, rateBps: 1000 });
      expect((await mission(a.missionId)).status).toBe('PAYMENT_CONFIRMED');
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(20000n);
      expect(await accountFor(a.missionId, 'PRO_PAYABLE')).toBe(-18700n);
      expect(await accountFor(a.missionId, 'INEED_REVENUE')).toBe(-1300n);
      expect(await ledgerTotal()).toBe(0n);
      expect(await notified(a.clientId, 'client.PAYMENT_CONFIRMED')).toBe(1);
      expect(await notified(a.proId, 'pro.PAYMENT_CONFIRMED')).toBe(1);

      const receipt = await ctx.http.get(`/v1/payments/${paymentId}/receipt`).set(bearer(a.client)).expect(200);
      expect(receipt.body).toMatchObject({ amountXof: 20000, isSandbox: true, method: 'MTN Mobile Money', purpose: 'Prestation' });
      expect(receipt.body.notice).toMatch(/SIMULATION/);
      expect(receipt.body.lines).toHaveLength(3);
      expect(receipt.body.payer.phone).toMatch(/••/);
      const other = await newClient();
      await ctx.http.get(`/v1/payments/${paymentId}/receipt`).set(bearer(other.tokens)).expect(404);

      const earnings = await ctx.http.get('/v1/pro/earnings').set(bearer(a.pro)).expect(200);
      expect(earnings.body).toMatchObject({ totalDueXof: 18700, heldXof: 18700, availableXof: 0 });
      const proView = await ctx.http.get(`/v1/pro/missions/${a.missionId}`).set(bearer(a.pro)).expect(200);
      expect(proView.body.money).toMatchObject({ paidXof: 20000, commissionXof: 1300, netXof: 18700, due: null });
      // Plus rien à payer.
      expect((await pay(a).expect(409)).body.error.code).toBe('NOTHING_DUE');
      // L'intervention peut commencer.
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro)).expect(200);
    });
  });

  describe('T15 — paiement échoué', () => {
    it('refus de l’opérateur : paiement échoué, mission toujours en attente, client prévenu ; nouvel essai réussi', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const first = await pay(a).expect(201);
      await checkout(refOf(first.body.checkoutUrl), 'FAILED');
      const failed = await ctx.http.get(`/v1/payments/${first.body.id}`).set(bearer(a.client)).expect(200);
      expect(failed.body).toMatchObject({ status: 'FAILED', failureMessage: 'Paiement refusé (simulation).', receiptAvailable: false });
      expect((await mission(a.missionId)).status).toBe('PAYMENT_PENDING');
      expect(await notified(a.clientId, 'client.PAYMENT_FAILED')).toBe(1);
      expect(await ctx.prisma.ledgerEntry.count({ where: { transaction: { missionId: a.missionId } } })).toBe(0);

      const second = await pay(a).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
      await checkout(refOf(second.body.checkoutUrl), 'CANCELLED');
      expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: second.body.id } })).status).toBe('CANCELLED');
      const third = await pay(a).expect(201);
      await checkout(refOf(third.body.checkoutUrl), 'SUCCEEDED');
      expect((await mission(a.missionId)).status).toBe('PAYMENT_CONFIRMED');
      expect(await ledgerTotal()).toBe(0n);
    });

    it('sans paiement : relance du client puis annulation sans frais, le professionnel est libéré', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      expect((await loop().run(later(16))).reminders).toBeGreaterThanOrEqual(1);
      expect(await notified(a.clientId, 'client.PAYMENT_REMINDER')).toBe(1);
      await loop().run(later(20));
      expect(await notified(a.clientId, 'client.PAYMENT_REMINDER')).toBe(1);
      // (les missions non payées des scénarios précédents sont annulées aussi : elles ont dépassé le délai)
      const r = await loop().run(later(121));
      expect(r.missionsCancelled).toBeGreaterThanOrEqual(1);
      const m = await mission(a.missionId);
      expect(m).toMatchObject({ status: 'CANCELLED', cancelReason: 'Paiement non reçu dans le délai' });
      expect(await notified(a.proId, 'pro.MISSION_CANCELLED')).toBe(1);
    });

    it('page de paiement abandonnée sans réponse : expirée après le délai, un nouveau paiement est possible', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const p = await pay(a).expect(201);
      await loop().run(later(36));
      expect((await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } })).status).toBe('EXPIRED');
      // Une tentative en cours empêche l'annulation automatique ; expirée, elle n'empêche plus rien.
      const again = await pay(a).expect(201);
      expect(again.body.id).not.toBe(p.body.id);
    });
  });

  describe('T16 — notification de paiement répétée', () => {
    it('la même notification envoyée 10 fois, en même temps : un seul effet', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const p = await pay(a).expect(201);
      const ref = refOf(p.body.checkoutUrl);
      await sandbox().decide(ref, 'SUCCEEDED', 'WAVE');
      const n = sandbox().signedNotification(ref, 'unique');
      const results = await Promise.all(Array.from({ length: 10 }, () => ctx.http.post('/v1/payments/notify/sandbox').set(n.headers).send(n.body)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      expect(await ctx.prisma.paymentProviderEvent.count({ where: { paymentId: p.body.id } })).toBe(1);
      expect(await ctx.prisma.ledgerTransaction.count({ where: { paymentId: p.body.id } })).toBe(2); // encaissement + commission
      expect(await ctx.prisma.commission.count({ where: { paymentId: p.body.id } })).toBe(1);
      expect(await ctx.prisma.missionStatusHistory.count({ where: { missionId: a.missionId, toStatus: 'PAYMENT_CONFIRMED' } })).toBe(1);
      expect(await notified(a.clientId, 'client.PAYMENT_CONFIRMED')).toBe(1);
      // Rejouée plus tard : reconnue comme déjà traitée.
      const late = await ctx.http.post('/v1/payments/notify/sandbox').set(n.headers).send(n.body).expect(200);
      expect(late.body.duplicate).toBe(true);
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(15000n);
      expect(await ledgerTotal()).toBe(0n);
    });

    it('notification perdue : le worker revérifie le paiement et le confirme', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const p = await pay(a).expect(201);
      await sandbox().decide(refOf(p.body.checkoutUrl), 'SUCCEEDED', 'ORANGE_MONEY');
      const r = await loop().run(later(1));
      expect(r.succeeded).toBeGreaterThanOrEqual(1);
      expect((await mission(a.missionId)).status).toBe('PAYMENT_CONFIRMED');
      expect(await ctx.prisma.paymentProviderEvent.count({ where: { paymentId: p.body.id } })).toBe(0);
    });

    it('montant confirmé différent de l’attendu : aucun effet, anomalie journalisée', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const p = await pay(a).expect(201);
      const ref = refOf(p.body.checkoutUrl);
      const redis = (sandbox() as unknown as { redis: { get(k: string): Promise<string>; set(k: string, v: string): Promise<unknown> } }).redis;
      const state = JSON.parse(await redis.get(`ineed:sandbox:payment:${ref}`)) as Record<string, unknown>;
      await redis.set(`ineed:sandbox:payment:${ref}`, JSON.stringify({ ...state, amountXof: '100' }));
      await checkout(ref, 'SUCCEEDED');
      const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.body.id } });
      expect(row).toMatchObject({ status: 'PENDING', failureCode: 'AMOUNT_MISMATCH' });
      expect((await mission(a.missionId)).status).toBe('PAYMENT_PENDING');
      expect(await ctx.prisma.auditLog.count({ where: { action: 'payment.amount_mismatch', entityId: p.body.id } })).toBe(1);
    });
  });

  describe('T17 — remboursement', () => {
    it('désistement du professionnel après paiement : remboursement intégral, commission rendue, grand livre à zéro', async () => {
      const a = await assigned();
      const paymentId = await payWithSandbox(ctx, a.missionId);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/cancel`).set(bearer(a.pro)).send({ reason: 'Imprévu familial' }).expect(200);
      const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { paymentId } });
      expect(refund).toMatchObject({ amountXof: 15000n, status: 'APPROVED', reason: 'Annulation sans frais' });
      expect(await notified(a.clientId, 'client.MISSION_CANCELLED')).toBe(1);
      const r = await loop().run();
      expect(r.refunds).toBeGreaterThanOrEqual(1);
      expect((await ctx.prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe('SUCCEEDED');
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(0n);
      expect(await accountFor(a.missionId, 'PRO_PAYABLE')).toBe(0n);
      expect(await accountFor(a.missionId, 'INEED_REVENUE')).toBe(0n);
      expect(await notified(a.clientId, 'client.REFUND_COMPLETED')).toBe(1);
      // Rejouer le tick ne rembourse pas deux fois.
      await loop().run();
      expect(await ctx.prisma.ledgerTransaction.count({ where: { paymentId, kind: 'REFUND' } })).toBe(1);
    });

    it('annulation par le client, professionnel en route : frais de déplacement retenus, reste remboursé', async () => {
      const a = await assigned();
      const paymentId = await payWithSandbox(ctx, a.missionId);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro)).expect(200);
      const view = await ctx.http.get(`/v1/missions/${a.missionId}`).set(bearer(a.client)).expect(200);
      expect(view.body.cancelTerms).toBe('TRAVEL_FEE_DUE');
      await ctx.http.post(`/v1/missions/${a.missionId}/cancel`).set(bearer(a.client)).send({ reason: 'Plus besoin' }).expect(200);
      const refund = await ctx.prisma.refund.findFirstOrThrow({ where: { paymentId } });
      expect(refund.amountXof).toBe(13000n);
      await loop().run();
      // Le professionnel garde les 2 000 F de déplacement ; la commission (main-d'œuvre seulement) est rendue.
      expect(await accountFor(a.missionId, 'PRO_PAYABLE')).toBe(-2000n);
      expect(await accountFor(a.missionId, 'INEED_REVENUE')).toBe(0n);
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(2000n);
      const notice = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: a.proId, type: 'pro.MISSION_CANCELLED' } });
      expect(notice).toBeTruthy();
      const clientNotice = await ctx.prisma.notification.findFirst({ where: { userId: a.clientId, type: 'client.REFUND_COMPLETED' } });
      expect(clientNotice?.body).toContain('13');
    });

    it('remboursement décidé par l’administration : plafonné, réservé au rôle habilité, journalisé et idempotent', async () => {
      const a = await assigned();
      const paymentId = await payWithSandbox(ctx, a.missionId);
      const finance = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_FINANCE', 'finance@ineed.test'));
      const support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support@ineed.test'));
      const body = { amountXof: 5000, reason: 'Geste commercial après litige' };
      await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(support)).set('Idempotency-Key', key()).send(body).expect(403);
      await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(a.client)).set('Idempotency-Key', key()).send(body).expect(403);
      const tooMuch = await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(finance)).set('Idempotency-Key', key()).send({ ...body, amountXof: 15001 }).expect(422);
      expect(tooMuch.body.error.code).toBe('REFUND_EXCEEDS_PAID');
      const k = key();
      const r1 = await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(finance)).set('Idempotency-Key', k).send(body).expect(201);
      const r2 = await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(finance)).set('Idempotency-Key', k).send(body).expect(201);
      expect(r2.body.id).toBe(r1.body.id);
      expect(await ctx.prisma.refund.count({ where: { paymentId } })).toBe(1);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'refund.approve', entityId: r1.body.id } })).toBe(1);
      // La base refuse elle-même un total remboursé supérieur au paiement.
      await expect(ctx.prisma.refund.create({ data: { paymentId, amountXof: 10001n, reason: 'test', status: 'APPROVED', idempotencyKey: 'direct-sql' } })).rejects.toThrow(/cap exceeded/);
      await loop().run();
      // Commission rendue au prorata : 1 300 × 5 000 / 15 000 = 433.
      expect(await accountFor(a.missionId, 'INEED_REVENUE')).toBe(-1300n + 433n);
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(10000n);
      const balances = await ctx.http.get('/v1/admin/ledger/balances').set(bearer(finance)).expect(200);
      expect(balances.body).toMatchObject({ total: 0, balanced: true });
    });

    it('remboursement exécuté hors API (prestataire sans remboursement automatique) : saisi par l’administration', async () => {
      const a = await assigned();
      const paymentId = await payWithSandbox(ctx, a.missionId);
      const finance = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_FINANCE', 'finance2@ineed.test'));
      const r = await ctx.http.post(`/v1/admin/payments/${paymentId}/refunds`).set(bearer(finance)).set('Idempotency-Key', key()).send({ amountXof: 1000, reason: 'Remboursement manuel' }).expect(201);
      // État laissé par un adaptateur « MANUAL » (CinetPay) : en cours, en attente de la référence.
      await ctx.prisma.refund.update({ where: { id: r.body.id }, data: { status: 'PROCESSING' } });
      const done = await ctx.http.post(`/v1/admin/refunds/${r.body.id}/complete`).set(bearer(finance)).send({ providerRefundId: 'CP-REMB-778' }).expect(200);
      expect(done.body).toMatchObject({ status: 'SUCCEEDED', providerRefundId: 'CP-REMB-778' });
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(14000n);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'refund.complete', entityId: r.body.id } })).toBe(1);
    });

    it('paiement reçu après l’annulation de la mission : enregistré puis remboursé automatiquement', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const p = await pay(a).expect(201);
      await ctx.http.post(`/v1/missions/${a.missionId}/cancel`).set(bearer(a.client)).send({}).expect(200);
      await checkout(refOf(p.body.checkoutUrl), 'SUCCEEDED');
      const row = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: p.body.id }, include: { refunds: true, commission: true } });
      expect(row.status).toBe('SUCCEEDED');
      expect(row.commission?.amountXof).toBe(0n);
      expect(row.refunds.map((r) => [r.amountXof, r.reason])).toEqual([[15000n, 'Paiement reçu après l’annulation de la mission']]);
      await loop().run();
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(0n);
    });

    it('second paiement réussi pour le même devis (après expiration de la première page) : marqué en double et remboursé', async () => {
      const a = await assigned();
      const q = (await submitQuote(a, { lines: DEFAULT_QUOTE_LINES }).expect(201)).body.id;
      await acceptQuote(a, q).expect(200);
      const first = await pay(a).expect(201);
      await loop().run(later(36));
      const second = await pay(a).expect(201);
      await checkout(refOf(second.body.checkoutUrl), 'SUCCEEDED');
      // Le client valide finalement aussi la première demande sur son téléphone.
      await checkout(refOf(first.body.checkoutUrl), 'SUCCEEDED');
      const firstRow = await ctx.prisma.payment.findUniqueOrThrow({ where: { id: first.body.id }, include: { refunds: true } });
      expect(firstRow).toMatchObject({ status: 'SUCCEEDED', isDuplicate: true });
      expect(firstRow.refunds[0]).toMatchObject({ amountXof: 15000n, reason: 'Paiement en double' });
      await loop().run();
      expect(await accountFor(a.missionId, 'CLIENT_FUNDS_IN')).toBe(15000n);
      expect(await ctx.prisma.missionStatusHistory.count({ where: { missionId: a.missionId, toStatus: 'PAYMENT_CONFIRMED' } })).toBe(1);
    });
  });

  describe('frais supplémentaires et diagnostic sur place', () => {
    it('supplément pendant les travaux : justifié, accepté, payé avant de pouvoir terminer', async () => {
      const a = await assigned();
      await payWithSandbox(ctx, a.missionId);
      for (const step of ['depart', 'arrive', 'start']) await ctx.http.post(`/v1/pro/missions/${a.missionId}/${step}`).set(bearer(a.pro)).expect(200);
      const noReason = await submitQuote(a, { lines: [{ kind: 'MATERIAL', label: 'Robinet neuf', unitPriceXof: 8000 }] }).expect(422);
      expect(noReason.body.error.code).toBe('JUSTIFICATION_REQUIRED');
      const s = await submitQuote(a, { lines: [{ kind: 'MATERIAL', label: 'Robinet neuf', unitPriceXof: 8000, justification: 'L’ancien robinet est fissuré' }] }).expect(201);
      expect(s.body).toMatchObject({ kind: 'SUPPLEMENT', version: 2 });
      expect(await notified(a.clientId, 'client.QUOTE_SUPPLEMENT_RECEIVED')).toBe(1);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/complete`).set(bearer(a.pro)).send({}).expect(409);
      await acceptQuote(a, s.body.id).expect(200);
      expect((await mission(a.missionId)).status).toBe('IN_PROGRESS');
      const blocked = await ctx.http.post(`/v1/pro/missions/${a.missionId}/complete`).set(bearer(a.pro)).send({}).expect(409);
      expect(blocked.body.error.message).toMatch(/payés/);
      const view = await ctx.http.get(`/v1/missions/${a.missionId}`).set(bearer(a.client)).expect(200);
      expect(view.body.money.due).toMatchObject({ purpose: 'SUPPLEMENT', amountXof: 8000 });
      const p = await pay(a).expect(201);
      await checkout(refOf(p.body.checkoutUrl), 'SUCCEEDED');
      // Supplément de matériel : pas de commission.
      expect((await ctx.prisma.commission.findUniqueOrThrow({ where: { paymentId: p.body.id } })).amountXof).toBe(0n);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/complete`).set(bearer(a.pro)).send({ report: 'Robinet remplacé' }).expect(200);
      await ctx.http.post(`/v1/missions/${a.missionId}/confirm-completion`).set(bearer(a.client)).expect(200);
      const earnings = await ctx.http.get('/v1/pro/earnings').set(bearer(a.pro)).expect(200);
      expect(earnings.body.missions.find((m: { missionId: string }) => m.missionId === a.missionId)).toMatchObject({ grossXof: 23000, commissionXof: 1300, netXof: 21700, available: true });
    });

    it('déplacement + diagnostic : frais de déplacement payés d’abord, puis devis des travaux sur place et paiement', async () => {
      const category = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: 'electricite' } });
      const service = await ctx.prisma.service.create({ data: { categoryId: category.id, slug: 'diagnostic-panne-test', name: 'Diagnostic de panne', pricingModel: 'TRAVEL_PLUS_DIAGNOSIS', defaultTravelFeeXof: 3000n } });
      const a = await assigned('electricite', { serviceId: service.id });
      expect((await mission(a.missionId)).status).toBe('PAYMENT_PENDING');
      const view = await ctx.http.get(`/v1/missions/${a.missionId}`).set(bearer(a.client)).expect(200);
      expect(view.body.money.due).toMatchObject({ purpose: 'TRAVEL_FEE', amountXof: 3000 });
      const travel = await payWithSandbox(ctx, a.missionId);
      expect((await ctx.prisma.commission.findUniqueOrThrow({ where: { paymentId: travel } })).amountXof).toBe(0n);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro)).expect(200);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/arrive`).set(bearer(a.pro)).expect(200);
      expect((await mission(a.missionId)).status).toBe('AWAITING_QUOTE');
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/start`).set(bearer(a.pro)).expect(409);
      const q = await submitQuote(a, { lines: [{ kind: 'LABOR', label: 'Remplacement du disjoncteur', unitPriceXof: 25000 }] }).expect(201);
      await acceptQuote(a, q.body.id).expect(200);
      expect((await mission(a.missionId)).status).toBe('PAYMENT_PENDING');
      const work = await pay(a).expect(201);
      expect(work.body).toMatchObject({ purpose: 'WORK', amountXof: 25000 });
      await checkout(refOf(work.body.checkoutUrl), 'SUCCEEDED');
      expect((await mission(a.missionId)).status).toBe('PAYMENT_CONFIRMED');
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/start`).set(bearer(a.pro)).expect(200);
      expect(await accountFor(a.missionId, 'INEED_REVENUE')).toBe(-2500n);
    });
  });

  describe('rapprochement', () => {
    it('somme du grand livre = 0, et fonds clients = paiements réussis − remboursements effectués', async () => {
      expect(await ledgerTotal()).toBe(0n);
      const [unbalanced] = await ctx.prisma.$queryRaw<{ n: bigint }[]>`
        SELECT count(*)::bigint AS n FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING sum(amount_xof) <> 0) x`;
      expect(unbalanced!.n).toBe(0n);
      const [funds] = await ctx.prisma.$queryRaw<{ ledger: bigint; paid: bigint; refunded: bigint }[]>`
        SELECT (SELECT COALESCE(sum(amount_xof), 0) FROM ledger_entries WHERE account = 'CLIENT_FUNDS_IN')::bigint AS ledger,
               (SELECT COALESCE(sum(amount_xof), 0) FROM payments WHERE status = 'SUCCEEDED')::bigint AS paid,
               (SELECT COALESCE(sum(amount_xof), 0) FROM refunds WHERE status = 'SUCCEEDED')::bigint AS refunded`;
      expect(funds!.ledger).toBe(funds!.paid - funds!.refunded);
      // Écritures en ajout seul.
      await expect(ctx.prisma.$executeRaw`UPDATE ledger_entries SET amount_xof = amount_xof + 1`).rejects.toThrow(/append-only/);
    });
  });
});
