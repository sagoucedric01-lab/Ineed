import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DispatchService } from '../../src/dispatch/dispatch.service.js';
import { bearer, createTestPro, flushRedis, loginWithPhone, restartApi, payWithSandbox, startTestContext, type TestContext, type Tokens } from '../helpers/api.js';

/** Client à Cocody. */
const PLACE = { location: { lat: 5.36, lng: -3.97 }, landmark: 'Derrière la pharmacie, portail vert' };
const NEAR = (i: number) => ({ lat: 5.36 + i * 0.001, lng: -3.97 });

function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

describe('Mise en relation et missions', () => {
  let ctx: TestContext;
  const saved = { ...process.env };
  const pros: Record<string, { id: string; tokens: Tokens }> = {};
  let phone = 100;
  const dispatch = () => ctx.app.get(DispatchService);

  async function newClient(): Promise<Tokens> {
    await flushRedis();
    return (await loginWithPhone(ctx, `07090${String(phone++).padStart(5, '0')}`)).tokens;
  }

  async function pro(key: string, categorySlugs: string[], i: number, extra: Parameters<typeof createTestPro>[1] extends infer O ? Partial<O> : never = {}) {
    pros[key] = { ...(await createTestPro(ctx, { phone: `07080${String(phone++).padStart(5, '0')}`, businessName: `Pro ${key}`, categorySlugs, online: true, live: NEAR(i), ...extra })), id: '' };
    pros[key].id = (await ctx.prisma.proProfile.findFirstOrThrow({ where: { businessName: `Pro ${key}` } })).userId;
  }

  async function publish(client: Tokens, categorySlug: string, extra: Record<string, unknown> = {}): Promise<string> {
    const category = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: categorySlug } });
    const d = await ctx.http.post('/v1/requests').set(bearer(client))
      .send({ categoryId: category.id, mode: 'URGENT', description: 'Besoin d’une intervention rapide à la maison.', place: PLACE, ...extra }).expect(201);
    await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(client)).expect(200);
    return d.body.id as string;
  }

  const offers = (requestId: string) => ctx.prisma.requestOffer.findMany({ where: { requestId }, orderBy: { sentAt: 'asc' } });
  const request = (id: string) => ctx.prisma.serviceRequest.findUniqueOrThrow({ where: { id } });
  const offerOf = async (requestId: string, key: string) => (await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId, proId: pros[key]!.id } })).id;
  const notified = (userId: string, type: string) => ctx.prisma.notification.count({ where: { userId, type } });

  beforeAll(async () => {
    ctx = await startTestContext();
    for (let i = 1; i <= 6; i++) await pro(`P${i}`, ['plomberie'], i);
    await pro('E1', ['electricite'], 1);
    await pro('E2', ['electricite'], 2);
    for (let i = 1; i <= 3; i++) await pro(`S${i}`, ['climatisation'], i, { online: false, live: undefined, base: NEAR(i), weekdays: [1, 2, 3, 4, 5, 6, 7] });
    await pro('L1', ['serrurerie'], 1);
    await pro('L2', ['serrurerie'], 2);
    await pro('M1', ['menuiserie'], 1);
    await pro('M2', ['menuiserie'], 2);
    await pro('R1', ['peinture'], 1);
    await pro('K1', ['maconnerie'], 1);
    await pro('K2', ['maconnerie'], 2);
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('urgence : premier qui accepte', () => {
    let client: Tokens;
    let requestId: string;

    it('T7 — envoi des alertes : une vague vers les 5 meilleurs professionnels disponibles, sans l’adresse précise', async () => {
      client = await newClient();
      requestId = await publish(client, 'plomberie');
      const r = await request(requestId);
      expect(r.status).toBe('MATCHING');
      expect(r.currentWave).toBe(1);
      const sent = await offers(requestId);
      expect(sent).toHaveLength(5);
      expect(sent.every((o) => o.status === 'SENT' && o.expiresAt > new Date())).toBe(true);
      // Les plus proches d'abord : P6 (le plus loin) attend la vague suivante.
      expect(sent.map((o) => o.proId)).not.toContain(pros.P6!.id);
      for (const o of sent) expect(await notified(o.proId, 'pro.NEW_REQUEST_URGENT')).toBe(1);

      const view = await ctx.http.get(`/v1/pro/offers/${sent[0]!.id}`).set(bearer(pros.P1!.tokens)).expect(200);
      expect(view.body).toMatchObject({ status: 'SEEN', zoneName: 'Cocody', mode: 'URGENT' });
      expect(view.body.distanceM % 100).toBe(0);
      expect(JSON.stringify(view.body)).not.toMatch(/pharmacie|portail|"lat"|"lng"/);
      // Un professionnel ne voit pas l'offre d'un autre.
      await ctx.http.get(`/v1/pro/offers/${sent[1]!.id}`).set(bearer(pros.P6!.tokens)).expect(404);
    });

    it('T8 — 5 acceptations simultanées : une seule réservation', async () => {
      const sent = await offers(requestId);
      const owner = Object.fromEntries(Object.values(pros).map((p) => [p.id, p.tokens]));
      const results = await Promise.all(sent.map((o) => ctx.http.post(`/v1/pro/offers/${o.id}/accept`).set(bearer(owner[o.proId]!))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      const losers = results.filter((r) => r.status === 409);
      expect(losers).toHaveLength(4);
      expect(losers.every((r) => r.body.error.code === 'OFFER_TAKEN')).toBe(true);
      const r = await request(requestId);
      const winner = sent[results.findIndex((x) => x.status === 200)]!.proId;
      expect(r).toMatchObject({ status: 'AWAITING_CLIENT_CONFIRMATION', reservedProId: winner });
      expect(r.reservationExpiresAt!.getTime()).toBeGreaterThan(Date.now());
      expect(await notified(r.clientId, 'client.REQUEST_RESERVED')).toBe(1);
      // Acceptation renvoyée par le gagnant (réponse perdue) : même résultat, pas d'erreur.
      await ctx.http.post(`/v1/pro/offers/${sent.find((o) => o.proId === winner)!.id}/accept`).set(bearer(owner[winner]!)).expect(200);
      const history = await ctx.prisma.requestStatusHistory.findMany({ where: { requestId }, orderBy: { id: 'asc' } });
      expect(history.map((h) => h.toStatus)).toEqual(['DRAFT', 'PUBLISHED', 'MATCHING', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION']);
    });

    it('T9 — attribution à un seul professionnel : confirmation du client, mission unique, autres offres retirées', async () => {
      const proposals = await ctx.http.get(`/v1/requests/${requestId}/offers`).set(bearer(client)).expect(200);
      expect(proposals.body.offers).toHaveLength(1);
      expect(proposals.body.offers[0]).toMatchObject({ reserved: true, pro: { verified: true } });

      const confirmed = await ctx.http.post(`/v1/requests/${requestId}/confirm`).set(bearer(client)).expect(200);
      expect(confirmed.body.status).toBe('ASSIGNED');
      expect(confirmed.body.missionId).toBeTruthy();
      // Confirmation renvoyée : la même mission.
      const again = await ctx.http.post(`/v1/requests/${requestId}/confirm`).set(bearer(client)).expect(200);
      expect(again.body.missionId).toBe(confirmed.body.missionId);
      expect(await ctx.prisma.mission.count({ where: { requestId } })).toBe(1);

      const all = await offers(requestId);
      expect(all.filter((o) => o.status === 'SELECTED')).toHaveLength(1);
      expect(all.filter((o) => o.status === 'WITHDRAWN')).toHaveLength(4);
      const mission = await ctx.prisma.mission.findUniqueOrThrow({ where: { id: confirmed.body.missionId } });
      expect(mission).toMatchObject({ status: 'AWAITING_QUOTE', pricingModel: 'QUOTE' });
      expect(mission.reference).toMatch(/^IN-\d{4}-\d{6}$/);

      // Garantie en base : une seconde mission active pour la même demande est impossible.
      await expect(
        ctx.prisma.$executeRaw`INSERT INTO missions (reference, request_id, client_id, pro_id, pricing_model, status)
          VALUES ('IN-TEST-1', ${requestId}::uuid, ${mission.clientId}::uuid, ${pros.P6!.id}::uuid, 'QUOTE', 'CONFIRMED')`,
      ).rejects.toThrow();

      // Le professionnel retenu voit maintenant l'adresse précise et le prénom du client.
      const winner = Object.values(pros).find((p) => p.id === mission.proId)!;
      const mv = await ctx.http.get(`/v1/pro/missions/${mission.id}`).set(bearer(winner.tokens)).expect(200);
      expect(mv.body.place).toMatchObject({ landmark: PLACE.landmark, location: PLACE.location });
      expect(await notified(mission.proId, 'pro.REQUEST_CONFIRMED_BY_CLIENT')).toBe(1);
      // Un autre professionnel n'y a pas accès.
      await ctx.http.get(`/v1/pro/missions/${mission.id}`).set(bearer(pros.P6!.tokens)).expect(404);
    });
  });

  describe('vagues, expirations, refus', () => {
    it('T10 — expiration des propositions : vague suivante, puis aucun professionnel', async () => {
      const client = await newClient();
      // Les pros de plomberie déjà sollicités ailleurs restent admissibles ici : 6 candidats.
      const requestId = await publish(client, 'electricite');
      expect((await offers(requestId)).map((o) => o.proId).sort()).toEqual([pros.E1!.id, pros.E2!.id].sort());
      // Échéance des offres (60 s) : expirées ; plus personne à solliciter : aucun professionnel.
      const report = await dispatch().tick(later(61));
      expect(report.offersExpired).toBe(2);
      expect((await offers(requestId)).every((o) => o.status === 'EXPIRED')).toBe(true);
      await dispatch().tick(later(122));
      const r = await request(requestId);
      expect(r.status).toBe('NO_PROVIDER_FOUND');
      expect(r.currentRadiusM).toBe(15_000);
      expect(await notified(r.clientId, 'client.REQUEST_NO_PROVIDER')).toBe(1);
      // Trop tard pour accepter.
      const late = await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'E1')}/accept`).set(bearer(pros.E1!.tokens)).expect(409);
      expect(late.body.error.code).toBe('OFFER_EXPIRED');
      // Relance en demande programmée : nouveau créneau, nouvelle recherche.
      const retried = await ctx.http.post(`/v1/requests/${requestId}/retry`).set(bearer(client)).send({ window: { start: tomorrowAt(9), end: tomorrowAt(12) } }).expect(200);
      expect(retried.body.mode).toBe('SCHEDULED');
      expect(retried.body.window).toEqual({ start: tomorrowAt(9), end: tomorrowAt(12) });
    });

    it('T11 — refus d’une mission par les professionnels : nouvelle vague sans attendre', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'serrurerie');
      for (const key of ['L1', 'L2']) {
        const r = await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, key)}/decline`).set(bearer(pros[key]!.tokens)).send({ reason: 'Je suis occupé' }).expect(200);
        expect(r.body.status).toBe('DECLINED');
      }
      expect((await offers(requestId)).map((o) => o.declineReason)).toEqual(['Je suis occupé', 'Je suis occupé']);
      // Tous ont répondu : la vague suivante part au tick immédiat (sans attendre 60 s).
      expect((await request(requestId)).nextWaveAt!.getTime()).toBeLessThanOrEqual(Date.now());
      await dispatch().tick(new Date());
      expect((await request(requestId)).status).toBe('NO_PROVIDER_FOUND');
    });

    it('réservation non confirmée à temps : professionnel libéré, recherche reprise', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'menuiserie');
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'M1')}/accept`).set(bearer(pros.M1!.tokens)).expect(200);
      // Délai de confirmation (120 s) dépassé ; l'offre de M2 (60 s) a expiré entre-temps : plus personne.
      await dispatch().tick(later(121));
      const r = await request(requestId);
      expect(r).toMatchObject({ status: 'NO_PROVIDER_FOUND', reservedProId: null });
      const history = (await ctx.prisma.requestStatusHistory.findMany({ where: { requestId }, orderBy: { id: 'asc' } })).map((h) => h.toStatus);
      expect(history.slice(-3)).toEqual(['AWAITING_CLIENT_CONFIRMATION', 'MATCHING', 'NO_PROVIDER_FOUND']);
      expect(await notified(pros.M1!.id, 'pro.RESERVATION_EXPIRED')).toBe(1);
      expect((await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId, proId: pros.M1!.id } })).status).toBe('EXPIRED');
      expect((await ctx.http.post(`/v1/requests/${requestId}/confirm`).set(bearer(client)).expect(409)).body.error.code).toBe('NOTHING_TO_CONFIRM');
    });

    it('le client ne retient pas le professionnel réservé : la recherche continue, un autre peut accepter', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'menuiserie');
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'M1')}/accept`).set(bearer(pros.M1!.tokens)).expect(200);
      await ctx.http.post(`/v1/requests/${requestId}/decline-reservation`).set(bearer(client)).expect(200);
      expect(await request(requestId)).toMatchObject({ status: 'MATCHING', reservedProId: null });
      expect((await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId, proId: pros.M1!.id } })).status).toBe('NOT_SELECTED');
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'M2')}/accept`).set(bearer(pros.M2!.tokens)).expect(200);
      expect((await request(requestId)).reservedProId).toBe(pros.M2!.id);
    });

    it('annulation de la demande pendant la réservation : le professionnel est prévenu', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'peinture');
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'R1')}/accept`).set(bearer(pros.R1!.tokens)).expect(200);
      const r = await ctx.http.post(`/v1/requests/${requestId}/cancel`).set(bearer(client)).send({ reason: 'Plus besoin' }).expect(200);
      expect(r.body.status).toBe('CANCELLED');
      expect(await notified(pros.R1!.id, 'pro.RESERVATION_EXPIRED')).toBe(1);
      expect((await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId } })).status).toBe('WITHDRAWN');
    });
  });

  describe('programmé : propositions et choix du client', () => {
    it('les professionnels proposent un horaire, le client compare, choisit et confirme', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'climatisation', { mode: 'SCHEDULED', window: { start: tomorrowAt(9), end: tomorrowAt(12) } });
      expect((await offers(requestId))).toHaveLength(3);
      expect(await notified(pros.S1!.id, 'pro.NEW_REQUEST_SCHEDULED')).toBe(1);

      const outside = await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'S1')}/propose`).set(bearer(pros.S1!.tokens)).send({ proposedStartAt: tomorrowAt(15) }).expect(422);
      expect(outside.body.error.code).toBe('PROPOSAL_OUTSIDE_WINDOW');
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'S1')}/propose`).set(bearer(pros.S1!.tokens))
        .send({ proposedStartAt: tomorrowAt(10), proposedPriceXof: 25000, message: 'Entretien complet du split' }).expect(200);
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'S2')}/propose`).set(bearer(pros.S2!.tokens))
        .send({ proposedStartAt: tomorrowAt(9), proposedPriceXof: 20000 }).expect(200);
      expect((await request(requestId)).status).toBe('OFFERS_RECEIVED');
      expect(await notified((await request(requestId)).clientId, 'client.OFFER_RECEIVED')).toBe(2);
      // L'acceptation directe n'existe pas en mode programmé.
      expect((await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'S3')}/accept`).set(bearer(pros.S3!.tokens)).expect(409)).body.error.code).toBe('PROPOSAL_REQUIRED');

      const list = await ctx.http.get(`/v1/requests/${requestId}/offers`).set(bearer(client)).expect(200);
      expect(list.body.offers.map((o: { proposedPriceXof: number }) => o.proposedPriceXof)).toEqual([20000, 25000]);
      const chosen = list.body.offers.find((o: { pro: { id: string } }) => o.pro.id === pros.S1!.id);
      await ctx.http.post(`/v1/requests/${requestId}/offers/${chosen.id}/choose`).set(bearer(client)).expect(200);
      const done = await ctx.http.post(`/v1/requests/${requestId}/confirm`).set(bearer(client)).expect(200);
      const mission = await ctx.prisma.mission.findUniqueOrThrow({ where: { id: done.body.missionId } });
      expect(mission.proId).toBe(pros.S1!.id);
      expect(mission.scheduledStartAt!.toISOString()).toBe(tomorrowAt(10));
      expect(await notified(pros.S2!.id, 'pro.REQUEST_ASSIGNED_TO_OTHER')).toBe(1);
      expect((await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId, proId: pros.S2!.id } })).status).toBe('NOT_SELECTED');
    });
  });

  describe('déroulement de la mission', () => {
    let client: Tokens;
    let missionId: string;
    let proTokens: Tokens;
    let proId: string;

    async function assigned(categorySlug = 'plomberie'): Promise<{ client: Tokens; missionId: string; pro: { id: string; tokens: Tokens } }> {
      const c = await newClient();
      const requestId = await publish(c, categorySlug);
      const first = (await offers(requestId))[0]!;
      const p = Object.values(pros).find((x) => x.id === first.proId)!;
      await ctx.http.post(`/v1/pro/offers/${first.id}/accept`).set(bearer(p.tokens)).expect(200);
      const confirmed = await ctx.http.post(`/v1/requests/${requestId}/confirm`).set(bearer(c)).expect(200);
      return { client: c, missionId: confirmed.body.missionId, pro: p };
    }

    it('aucune action de trajet avant le paiement confirmé (phase 7)', async () => {
      const a = await assigned();
      client = a.client;
      missionId = a.missionId;
      proTokens = a.pro.tokens;
      proId = a.pro.id;
      const r = await ctx.http.post(`/v1/pro/missions/${missionId}/depart`).set(bearer(proTokens)).expect(409);
      expect(r.body.error.code).toBe('MISSION_TRANSITION_REFUSED');
      // Le client ne peut pas déclarer l'arrivée à la place du professionnel (route réservée à Ineed Pro).
      await ctx.http.post(`/v1/pro/missions/${missionId}/arrive`).set(bearer(client)).expect(403);
    });

    it('T20 — suivi du professionnel : départ, positions du trajet, distance et délai, arrivée', async () => {
      await payWithSandbox(ctx, missionId);
      await ctx.http.post(`/v1/pro/missions/${missionId}/depart`).set(bearer(proTokens)).expect(200);
      expect(await notified((await ctx.prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).clientId, 'client.PRO_EN_ROUTE')).toBe(1);

      const t0 = Date.now();
      const points = [
        { lat: 5.38, lng: -3.97, accuracyM: 12, recordedAt: new Date(t0 - 50_000).toISOString() },
        { lat: 5.37, lng: -3.97, accuracyM: 10, recordedAt: new Date(t0 - 20_000).toISOString() },
        // 200 km en 10 s : vitesse impossible, position conservée mais marquée suspecte.
        { lat: 7.2, lng: -3.97, accuracyM: 10, recordedAt: new Date(t0 - 10_000).toISOString() },
      ];
      const sent = await ctx.http.post(`/v1/pro/missions/${missionId}/locations`).set(bearer(proTokens)).send({ points }).expect(200);
      expect(sent.body).toEqual({ accepted: 3, ignored: 0 });
      expect(await ctx.prisma.locationPing.count({ where: { missionId, isSuspicious: true } })).toBe(1);

      const view = await ctx.http.get(`/v1/missions/${missionId}`).set(bearer(client)).expect(200);
      expect(view.body.status).toBe('EN_ROUTE');
      expect(view.body.tracking.position).toEqual({ lat: 5.37, lng: -3.97 });
      expect(view.body.tracking.distanceM).toBeGreaterThan(1000);
      expect(view.body.tracking.distanceM).toBeLessThan(1300);
      expect(view.body.tracking.etaMinutes).toBeGreaterThan(0);
      expect(view.body.cancelTerms).toBe('TRAVEL_FEE_DUE');

      await ctx.http.post(`/v1/pro/missions/${missionId}/arrive`).set(bearer(proTokens)).expect(200);
      const arrived = await ctx.http.get(`/v1/missions/${missionId}`).set(bearer(client)).expect(200);
      expect(arrived.body).toMatchObject({ status: 'ARRIVED', tracking: null });
      // Plus de positions acceptées une fois arrivé.
      const after = await ctx.http.post(`/v1/pro/missions/${missionId}/locations`).set(bearer(proTokens)).send({ points: [{ lat: 5.36, lng: -3.97, recordedAt: new Date().toISOString() }] }).expect(200);
      expect(after.body).toEqual({ accepted: 0, ignored: 1 });
    });

    it('T19 — annulation impossible une fois les travaux commencés ; T21 — fin de prestation et clôture par le client', async () => {
      await ctx.http.post(`/v1/pro/missions/${missionId}/start`).set(bearer(proTokens)).expect(200);
      const refused = await ctx.http.post(`/v1/missions/${missionId}/cancel`).set(bearer(client)).send({}).expect(409);
      expect(refused.body.error.message).toContain('ne peut plus être annulée');

      const done = await ctx.http.post(`/v1/pro/missions/${missionId}/complete`).set(bearer(proTokens)).send({ report: 'Joint du siphon remplacé, fuite réparée.' }).expect(200);
      expect(done.body.status).toBe('WORK_COMPLETED');
      expect(done.body.report).toBe('Joint du siphon remplacé, fuite réparée.');
      const autoClose = new Date(done.body.autoCloseAt).getTime();
      expect(autoClose - Date.now()).toBeGreaterThan(47 * 3_600_000);

      const closed = await ctx.http.post(`/v1/missions/${missionId}/confirm-completion`).set(bearer(client)).expect(200);
      expect(closed.body.status).toBe('CLOSED');
      expect((await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: proId } })).missionsCompleted).toBe(1);
      expect(await notified(proId, 'pro.MISSION_VALIDATED')).toBe(1);
      const timeline = closed.body.timeline.map((e: { status: string }) => e.status);
      expect(timeline).toEqual([
        'DRAFT', 'PUBLISHED', 'MATCHING', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION', 'ASSIGNED',
        'AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED',
        'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'WORK_COMPLETED', 'CLOSED',
      ]);
    });

    it('clôture automatique sans réponse du client', async () => {
      const a = await assigned();
      await payWithSandbox(ctx, a.missionId);
      for (const step of ['depart', 'arrive', 'start', 'complete']) await ctx.http.post(`/v1/pro/missions/${a.missionId}/${step}`).set(bearer(a.pro.tokens)).send({}).expect(200);
      expect((await dispatch().tick(later(3600))).missionsClosed).toBe(0);
      expect((await dispatch().tick(later(49 * 3600))).missionsClosed).toBe(1);
      expect((await ctx.prisma.mission.findUniqueOrThrow({ where: { id: a.missionId } })).status).toBe('CLOSED');
    });

    it('T18 — annulation avant intervention par le client : sans frais, demande annulée, professionnel prévenu', async () => {
      const a = await assigned();
      const r = await ctx.http.post(`/v1/missions/${a.missionId}/cancel`).set(bearer(a.client)).send({ reason: 'Problème réglé' }).expect(200);
      expect(r.body).toMatchObject({ status: 'CANCELLED', cancelledBy: 'CLIENT', cancelReason: 'Problème réglé', cancelTerms: null });
      const h = await ctx.prisma.missionStatusHistory.findFirstOrThrow({ where: { missionId: a.missionId, toStatus: 'CANCELLED' } });
      expect(h.metadata).toEqual({ terms: 'FREE' });
      const m = await ctx.prisma.mission.findUniqueOrThrow({ where: { id: a.missionId } });
      expect((await request(m.requestId)).status).toBe('CANCELLED');
      expect(await notified(a.pro.id, 'pro.MISSION_CANCELLED')).toBeGreaterThan(0);
    });

    it('T19 — annulation après confirmation, professionnel en route : frais de déplacement dus', async () => {
      const a = await assigned();
      await payWithSandbox(ctx, a.missionId);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro.tokens)).expect(200);
      await ctx.http.post(`/v1/missions/${a.missionId}/cancel`).set(bearer(a.client)).send({}).expect(200);
      const h = await ctx.prisma.missionStatusHistory.findFirstOrThrow({ where: { missionId: a.missionId, toStatus: 'CANCELLED' } });
      expect(h.metadata).toEqual({ terms: 'TRAVEL_FEE_DUE' });
    });

    it('désistement du professionnel : compté dans sa fiabilité, la demande repart en recherche sans lui', async () => {
      const a = await assigned('maconnerie');
      const before = (await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: a.pro.id } })).cancellationsByPro;
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/cancel`).set(bearer(a.pro.tokens)).send({ reason: 'Imprévu familial' }).expect(200);
      expect((await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: a.pro.id } })).cancellationsByPro).toBe(before + 1);
      const m = await ctx.prisma.mission.findUniqueOrThrow({ where: { id: a.missionId } });
      expect((await request(m.requestId)).status).toBe('MATCHING');
      await dispatch().tick(new Date());
      const again = await ctx.prisma.requestOffer.findMany({ where: { requestId: m.requestId, wave: { gt: 1 } } });
      expect(again.length).toBeGreaterThan(0);
      expect(again.map((o) => o.proId)).not.toContain(a.pro.id);
      // Une nouvelle mission peut être créée pour la même demande : l'ancienne est annulée.
      const p = Object.values(pros).find((x) => x.id === again[0]!.proId)!;
      await ctx.http.post(`/v1/pro/offers/${again[0]!.id}/accept`).set(bearer(p.tokens)).expect(200);
      await ctx.http.post(`/v1/requests/${m.requestId}/confirm`).set(bearer(a.client)).expect(200);
      expect(await ctx.prisma.mission.count({ where: { requestId: m.requestId } })).toBe(2);
    });

    it('T26 — perte de connexion : actions et positions renvoyées sans doublon', async () => {
      const a = await assigned();
      await payWithSandbox(ctx, a.missionId);
      const depart = () => ctx.http.post(`/v1/pro/missions/${a.missionId}/depart`).set(bearer(a.pro.tokens));
      await depart().expect(200);
      await depart().expect(200);
      expect(await ctx.prisma.missionStatusHistory.count({ where: { missionId: a.missionId, toStatus: 'EN_ROUTE' } })).toBe(1);
      const points = [1, 2, 3].map((i) => ({ lat: 5.36 + i * 0.001, lng: -3.97, recordedAt: new Date(Date.now() - 40_000 + i * 1000).toISOString() }));
      expect((await ctx.http.post(`/v1/pro/missions/${a.missionId}/locations`).set(bearer(a.pro.tokens)).send({ points }).expect(200)).body.accepted).toBe(3);
      // Même lot renvoyé après la coupure, plus un nouveau point.
      const replay = [...points, { lat: 5.365, lng: -3.97, recordedAt: new Date(Date.now() - 30_000).toISOString() }];
      expect((await ctx.http.post(`/v1/pro/missions/${a.missionId}/locations`).set(bearer(a.pro.tokens)).send({ points: replay }).expect(200)).body).toEqual({ accepted: 1, ignored: 3 });
      // Un professionnel en route n'est plus proposé pour une nouvelle urgence.
      const c = await newClient();
      const other = await publish(c, 'plomberie');
      expect((await offers(other)).map((o) => o.proId)).not.toContain(a.pro.id);
    });
  });

  describe('T27 — reprise après interruption du serveur', () => {
    it('après un redémarrage, les échéances et les vagues reprennent depuis l’état en base', async () => {
      const client = await newClient();
      const requestId = await publish(client, 'electricite');
      // E1 et E2 étaient déjà sollicités pour une autre demande ; ici, nouvelle demande : nouvelles offres.
      expect((await offers(requestId)).filter((o) => o.status === 'SENT')).toHaveLength(2);
      await ctx.http.post(`/v1/pro/offers/${await offerOf(requestId, 'E1')}/accept`).set(bearer(pros.E1!.tokens)).expect(200);

      // Arrêt brutal puis redémarrage : rien n'est gardé en mémoire.
      await restartApi(ctx);
      await dispatch().tick(later(121));
      const r = await request(requestId);
      expect(r).toMatchObject({ status: 'NO_PROVIDER_FOUND', reservedProId: null });
      const statuses = new Map((await offers(requestId)).map((o) => [o.proId, o.status]));
      expect(statuses.get(pros.E1!.id)).toBe('EXPIRED'); // réservation non confirmée
      expect(statuses.get(pros.E2!.id)).toBe('EXPIRED'); // offre sans réponse
      const history = async () => (await ctx.prisma.requestStatusHistory.findMany({ where: { requestId }, orderBy: { id: 'asc' } })).map((h) => h.toStatus);
      expect(await history()).toEqual(['DRAFT', 'PUBLISHED', 'MATCHING', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION', 'MATCHING', 'NO_PROVIDER_FOUND']);
      // Rejouer le même tick ne refait rien (traitement idempotent).
      await dispatch().tick(later(121));
      expect(await history()).toHaveLength(7);
    });
  });
});
