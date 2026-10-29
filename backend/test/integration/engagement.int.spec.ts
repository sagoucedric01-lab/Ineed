import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MissionsService } from '../../src/missions/missions.service.js';
import { NotificationDeliveryService } from '../../src/notifications/delivery.service.js';
import type { DevLogPushProvider } from '../../src/notifications/push/dev-log.provider.js';
import { PUSH_PROVIDER, type PushOutcome } from '../../src/notifications/push/push-provider.js';
import { REALTIME_PATH } from '../../src/realtime/realtime.service.js';
import { adminLogin, bearer, createAdmin, createTestPro, flushRedis, loginWithPhone, payWithSandbox, startTestContext, uploadFile, type TestContext, type Tokens } from '../helpers/api.js';

const PLACE = { location: { lat: 5.36, lng: -3.97 }, landmark: 'Derrière la pharmacie, portail vert' };
const photo = () => sharp({ create: { width: 320, height: 240, channels: 3, background: '#8899aa' } }).jpeg().toBuffer();
let seq = 0;
const msgId = () => `msg-${Date.now()}-${seq++}`;

describe('Notifications, messagerie, avis, réclamations', () => {
  let ctx: TestContext;
  const saved = { ...process.env };
  const proTokens = new Map<string, Tokens>();
  let phone = 100;
  const delivery = () => ctx.app.get(NotificationDeliveryService);
  const push = () => ctx.app.get<DevLogPushProvider>(PUSH_PROVIDER);

  async function newClient(firstName = 'Awa', lastName = 'Koné') {
    await flushRedis();
    const c = await loginWithPhone(ctx, `07050${String(phone++).padStart(5, '0')}`);
    await ctx.http.patch('/v1/me').set(bearer(c.tokens)).send({ firstName, lastName }).expect(200);
    return c;
  }

  interface Assigned {
    missionId: string;
    requestId: string;
    client: Tokens;
    clientId: string;
    pro: Tokens;
    proId: string;
  }

  /** Demande urgente publiée ; un professionnel accepte. Mission créée si `confirm`. */
  async function engage(confirm = true): Promise<Assigned> {
    const p = await createTestPro(ctx, { phone: `07040${String(phone++).padStart(5, '0')}`, businessName: `Koffi Services ${phone}`, categorySlugs: ['plomberie'], online: true, live: { lat: 5.361, lng: -3.97 } });
    proTokens.set(p.userId, p.tokens);
    const c = await newClient();
    const category = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: 'plomberie' } });
    const d = await ctx.http.post('/v1/requests').set(bearer(c.tokens)).send({ categoryId: category.id, mode: 'URGENT', description: 'Fuite sous l’évier de la cuisine, à réparer vite.', place: PLACE }).expect(201);
    await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(c.tokens)).expect(200);
    const offer = await ctx.prisma.requestOffer.findFirstOrThrow({ where: { requestId: d.body.id }, orderBy: { sentAt: 'asc' } });
    const pro = proTokens.get(offer.proId)!;
    await ctx.http.post(`/v1/pro/offers/${offer.id}/accept`).set(bearer(pro)).expect(200);
    let missionId = '';
    if (confirm) missionId = (await ctx.http.post(`/v1/requests/${d.body.id}/confirm`).set(bearer(c.tokens)).expect(200)).body.missionId;
    return { missionId, requestId: d.body.id, client: c.tokens, clientId: c.userId, pro, proId: offer.proId };
  }

  /** Mission payée, réalisée puis clôturée par le client. */
  async function closedMission(): Promise<Assigned> {
    const a = await engage();
    await payWithSandbox(ctx, a.missionId);
    for (const step of ['depart', 'arrive', 'start']) await ctx.http.post(`/v1/pro/missions/${a.missionId}/${step}`).set(bearer(a.pro)).expect(200);
    await ctx.http.post(`/v1/pro/missions/${a.missionId}/complete`).set(bearer(a.pro)).send({ report: 'Joint remplacé' }).expect(200);
    await ctx.http.post(`/v1/missions/${a.missionId}/confirm-completion`).set(bearer(a.client)).expect(200);
    return a;
  }

  async function upload(tokens: Tokens, purpose: 'MESSAGE_PHOTO' | 'COMPLAINT_ATTACHMENT'): Promise<string> {
    return (await uploadFile(ctx, tokens, purpose, await photo(), 'image/jpeg')).fileId;
  }

  const notified = (userId: string, type: string, about?: Record<string, string>) =>
    ctx.prisma.notification.count({ where: { userId, type, ...(about ? { AND: Object.entries(about).map(([k, v]) => ({ data: { path: [k], equals: v } })) } : {}) } });

  beforeAll(async () => {
    ctx = await startTestContext({ PUSH_PROVIDER: 'dev_log' });
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('messagerie', () => {
    let a: Assigned;
    let convId: string;

    it('ouverte dès que le professionnel a accepté la demande ; refusée à un professionnel non concerné', async () => {
      a = await engage(false);
      const outsider = await createTestPro(ctx, { phone: `07040${String(phone++).padStart(5, '0')}`, businessName: 'Autre pro', categorySlugs: ['electricite'], online: true });
      const denied = await ctx.http.post('/v1/conversations').set(bearer(outsider.tokens)).send({ requestId: a.requestId }).expect(403);
      expect(denied.body.error.code).toBe('CONVERSATION_NOT_ALLOWED');
      const byClient = await ctx.http.post('/v1/conversations').set(bearer(a.client)).send({ requestId: a.requestId, proId: a.proId }).expect(200);
      const byPro = await ctx.http.post('/v1/conversations').set(bearer(a.pro)).send({ requestId: a.requestId }).expect(200);
      expect(byPro.body.id).toBe(byClient.body.id);
      convId = byClient.body.id;
      expect(byClient.body).toMatchObject({ canWrite: true, unread: 0, otherParty: { name: expect.stringContaining('Koffi Services') } });
      expect(byPro.body.otherParty).toEqual({ name: 'Awa' });
      // Aucune coordonnée personnelle dans la conversation.
      expect(JSON.stringify(byPro.body)).not.toMatch(/\+225|0705|Koné/);
      await ctx.http.get(`/v1/conversations/${convId}`).set(bearer(outsider.tokens)).expect(404);
    });

    it('message renvoyé après une coupure : enregistré une seule fois ; non lus, lecture, notification unique', async () => {
      const id = msgId();
      const first = await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).send({ clientMsgId: id, body: 'Bonjour, vous arrivez vers quelle heure ?' }).expect(201);
      const again = await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).send({ clientMsgId: id, body: 'Bonjour, vous arrivez vers quelle heure ?' }).expect(201);
      expect(again.body).toMatchObject({ duplicate: true, message: { id: first.body.message.id } });
      expect(await ctx.prisma.message.count({ where: { conversationId: convId } })).toBe(1);
      await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).send({ clientMsgId: msgId(), body: 'C’est au portail vert.' }).expect(201);
      // Une seule notification tant que le professionnel n'a pas lu.
      expect(await notified(a.proId, 'pro.NEW_MESSAGE', { conversationId: convId })).toBe(1);
      expect((await ctx.http.get('/v1/conversations/unread').set(bearer(a.pro)).expect(200)).body.unread).toBe(2);
      const list = await ctx.http.get(`/v1/conversations/${convId}/messages`).set(bearer(a.pro)).expect(200);
      expect(list.body.items.map((m: { body: string }) => m.body)).toEqual(['Bonjour, vous arrivez vers quelle heure ?', 'C’est au portail vert.']);
      expect(list.body.items[0].fromMe).toBe(false);
      await ctx.http.post(`/v1/conversations/${convId}/read`).set(bearer(a.pro)).expect(204);
      expect((await ctx.http.get('/v1/conversations/unread').set(bearer(a.pro)).expect(200)).body.unread).toBe(0);
      expect(await ctx.prisma.notification.count({ where: { userId: a.proId, type: 'pro.NEW_MESSAGE', readAt: null } })).toBe(0);
      const mine = await ctx.http.get(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).expect(200);
      expect(mine.body.items.every((m: { read: boolean }) => m.read)).toBe(true);
      // Même identifiant réutilisé dans une autre conversation : refusé.
      expect(await ctx.prisma.message.count()).toBeGreaterThan(0);
    });

    it('coordonnées partagées : message envoyé avec un avertissement à l’expéditeur', async () => {
      const r = await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.pro)).send({ clientMsgId: msgId(), body: 'Appelez-moi au 07 08 09 10 11' }).expect(201);
      expect(r.body.warning).toBe('CONTACT_SHARING');
      const ok = await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.pro)).send({ clientMsgId: msgId(), body: 'J’arrive dans 15 min' }).expect(201);
      expect(ok.body.warning).toBeNull();
    });

    it('photo : visible des deux participants par un lien temporaire, photo d’un autre refusée', async () => {
      const fileId = await upload(a.client, 'MESSAGE_PHOTO');
      await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).send({ clientMsgId: msgId(), fileId }).expect(201);
      const seen = await ctx.http.get(`/v1/conversations/${convId}/messages`).set(bearer(a.pro)).expect(200);
      const photo = seen.body.items.at(-1);
      expect(photo.photoUrl).toMatch(/X-Amz-Expires=600/);
      expect((await fetch(photo.photoUrl)).ok).toBe(true);
      // Le professionnel ne peut pas réutiliser la photo du client.
      await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.pro)).send({ clientMsgId: msgId(), fileId }).expect(404);
    });

    it('temps réel : le message arrive par WebSocket ; un jeton invalide est refusé', async () => {
      const url = (await ctx.app.getUrl()).replace('http', 'ws') + REALTIME_PATH;
      const bad = new WebSocket(url);
      await new Promise((r) => bad.once('open', r));
      bad.send(JSON.stringify({ type: 'auth', token: 'jeton.invalide.x' }));
      const code = await new Promise<number>((r) => bad.once('close', (c) => r(c)));
      expect(code).toBe(4401);

      const ws = new WebSocket(url);
      const events: Record<string, unknown>[] = [];
      ws.on('message', (d: Buffer) => events.push(JSON.parse(d.toString('utf8')) as Record<string, unknown>));
      await new Promise((r) => ws.once('open', r));
      ws.send(JSON.stringify({ type: 'auth', token: a.pro.accessToken }));
      await expect.poll(() => events.some((e) => e.type === 'ready'), { timeout: 5000 }).toBe(true);
      await ctx.http.post(`/v1/conversations/${convId}/messages`).set(bearer(a.client)).send({ clientMsgId: msgId(), body: 'Message en direct' }).expect(201);
      await expect.poll(() => events.find((e) => e.type === 'message'), { timeout: 5000 }).toMatchObject({ conversationId: convId, message: { body: 'Message en direct', fromMe: false } });
      await ctx.http.post(`/v1/conversations/${convId}/read`).set(bearer(a.client)).expect(204);
      ws.close();
    });

    it('signalement d’un message : enregistré une fois ; on ne signale pas son propre message', async () => {
      const m = await ctx.prisma.message.findFirstOrThrow({ where: { conversationId: convId, senderId: a.proId } });
      const r1 = await ctx.http.post('/v1/reports').set(bearer(a.client)).send({ targetType: 'MESSAGE', targetId: m.id, reason: 'OFF_PLATFORM_PAYMENT', details: 'Demande de paiement en dehors de l’application' }).expect(201);
      const r2 = await ctx.http.post('/v1/reports').set(bearer(a.client)).send({ targetType: 'MESSAGE', targetId: m.id, reason: 'OFF_PLATFORM_PAYMENT' }).expect(201);
      expect(r2.body.id).toBe(r1.body.id);
      expect(await ctx.prisma.abuseReport.count({ where: { targetId: m.id } })).toBe(1);
      await ctx.http.post('/v1/reports').set(bearer(a.pro)).send({ targetType: 'MESSAGE', targetId: m.id, reason: 'SPAM' }).expect(422);
      const outsider = await newClient('Yao', 'Kouassi');
      await ctx.http.post('/v1/reports').set(bearer(outsider.tokens)).send({ targetType: 'MESSAGE', targetId: m.id, reason: 'SPAM' }).expect(404);
    });

    it('conversation en lecture seule une fois la mission close depuis le délai prévu', async () => {
      const b = await closedMission();
      const conv = await ctx.http.post('/v1/conversations').set(bearer(b.client)).send({ requestId: b.requestId, proId: b.proId }).expect(200);
      expect(conv.body).toMatchObject({ canWrite: true, missionReference: expect.stringMatching(/^IN-/) });
      await ctx.prisma.mission.update({ where: { id: b.missionId }, data: { closedAt: new Date(Date.now() - 8 * 86_400_000) } });
      const r = await ctx.http.post(`/v1/conversations/${conv.body.id}/messages`).set(bearer(b.client)).send({ clientMsgId: msgId(), body: 'Encore une question' }).expect(409);
      expect(r.body.error.code).toBe('CONVERSATION_READ_ONLY');
      await ctx.http.get(`/v1/conversations/${conv.body.id}/messages`).set(bearer(b.client)).expect(200);
    });
  });

  describe('notifications push', () => {
    it('envoyées depuis la file à l’application concernée seulement ; sans appareil, la notification reste dans l’application', async () => {
      const a = await engage();
      const token = `fcm-token-client-${'x'.repeat(30)}`;
      await ctx.http.put('/v1/me/devices').set(bearer(a.client)).send({ pushToken: token, platform: 'ANDROID', appVersion: '0.4.0' }).expect(204);
      await delivery().deliverDue(new Date(Date.now() + 1000));
      const sent = push().sent.filter((s) => s.token === token);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.every((s) => !s.message.data.type!.startsWith('pro.'))).toBe(true);
      const n = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: a.clientId, type: 'client.REQUEST_RESERVED' } });
      expect(n).toMatchObject({ status: 'SENT', pushResult: 'SENT', attempts: 1 });
      // Professionnel sans appareil enregistré : rien d'envoyé, notification visible dans Ineed Pro.
      const forPro = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: a.proId, type: 'pro.REQUEST_CONFIRMED_BY_CLIENT' } });
      expect(forPro).toMatchObject({ status: 'SENT', pushResult: 'NO_DEVICE' });
      // Reprise du worker : rien n'est renvoyé deux fois.
      const before = push().sent.length;
      await delivery().deliverDue(new Date(Date.now() + 2000));
      expect(push().sent.length).toBe(before);
    });

    it('erreur passagère : nouvel essai avec délai croissant, abandon après 5 essais ; jeton périmé désactivé', async () => {
      const c = await newClient();
      const token = `fcm-token-flaky-${'y'.repeat(30)}`;
      await ctx.http.put('/v1/me/devices').set(bearer(c.tokens)).send({ pushToken: token, platform: 'IOS' }).expect(204);
      const provider = push();
      const original = provider.send.bind(provider);
      let outcome: PushOutcome = { status: 'RETRY', error: 'FCM HTTP 503' };
      provider.send = (t, m) => (t === token ? Promise.resolve(outcome) : original(t, m));
      try {
        await ctx.prisma.notification.create({ data: { userId: c.userId, type: 'client.PAYMENT_CONFIRMED', title: 'Paiement confirmé', body: 'Test', data: {} } });
        let at = Date.now() + 1000;
        for (let i = 1; i <= 4; i++) {
          expect((await delivery().deliverDue(new Date(at))).retried).toBe(1);
          const n = await ctx.prisma.notification.findFirstOrThrow({ where: { userId: c.userId } });
          expect(n).toMatchObject({ status: 'QUEUED', attempts: i, lastError: 'FCM HTTP 503' });
          expect(n.nextAttemptAt.getTime() - at).toBe(30_000 * 2 ** (i - 1));
          at = n.nextAttemptAt.getTime();
        }
        expect((await delivery().deliverDue(new Date(at))).failed).toBe(1);
        expect((await ctx.prisma.notification.findFirstOrThrow({ where: { userId: c.userId } })).status).toBe('FAILED');

        outcome = { status: 'INVALID_TOKEN' };
        await ctx.prisma.notification.create({ data: { userId: c.userId, type: 'client.PAYMENT_FAILED', title: 'Paiement non abouti', body: 'Test', data: {} } });
        await delivery().deliverDue(new Date(Date.now() + 1000));
        expect((await ctx.prisma.device.findUniqueOrThrow({ where: { pushToken: token } })).disabledAt).not.toBeNull();
      } finally {
        provider.send = original;
      }
    });

    it('déconnexion de l’appareil : plus d’envoi ; jeton repris par un autre compte', async () => {
      const c1 = await newClient();
      const c2 = await newClient();
      const token = `fcm-token-shared-${'z'.repeat(30)}`;
      await ctx.http.put('/v1/me/devices').set(bearer(c1.tokens)).send({ pushToken: token, platform: 'ANDROID' }).expect(204);
      await ctx.http.put('/v1/me/devices').set(bearer(c2.tokens)).send({ pushToken: token, platform: 'ANDROID' }).expect(204);
      expect((await ctx.prisma.device.findUniqueOrThrow({ where: { pushToken: token } })).userId).toBe(c2.userId);
      await ctx.http.delete(`/v1/me/devices/${token}`).set(bearer(c2.tokens)).expect(204);
      expect((await ctx.prisma.device.findUniqueOrThrow({ where: { pushToken: token } })).disabledAt).not.toBeNull();
    });

    it('gabarits administrables : texte modifié, variable inconnue refusée, modification journalisée', async () => {
      const admin = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPER', 'super@ineed.test'));
      const list = await ctx.http.get('/v1/admin/notification-templates').set(bearer(admin)).expect(200);
      expect(list.body.find((t: { type: string }) => t.type === 'client.PRO_ARRIVED').variables).toEqual(['proName']);
      const bad = await ctx.http.put('/v1/admin/notification-templates/client.PRO_ARRIVED').set(bearer(admin)).send({ body: '{{proName}} est là, code {{secret}}' }).expect(422);
      expect(bad.body.error.code).toBe('TEMPLATE_UNKNOWN_VARIABLE');
      await ctx.http.put('/v1/admin/notification-templates/client.PRO_ARRIVED').set(bearer(admin)).send({ body: '{{proName}} est devant chez vous.' }).expect(200);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'notification_template.update', entityId: 'client.PRO_ARRIVED' } })).toBe(1);
      const support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support@ineed.test'));
      await ctx.http.put('/v1/admin/notification-templates/client.PRO_ARRIVED').set(bearer(support)).send({ body: 'x' }).expect(403);
    });
  });

  describe('T22 — évaluation', () => {
    it('refusée avant la clôture (application et base), acceptée une seule fois après ; note du professionnel mise à jour', async () => {
      const a = await engage();
      await payWithSandbox(ctx, a.missionId);
      const early = await ctx.http.post(`/v1/missions/${a.missionId}/review`).set(bearer(a.client)).send({ rating: 5 }).expect(409);
      expect(early.body.error.code).toBe('REVIEW_NOT_ALLOWED');
      await expect(ctx.prisma.review.create({ data: { missionId: a.missionId, clientId: a.clientId, proId: a.proId, rating: 5 } })).rejects.toThrow(/review not allowed/);

      const b = await closedMission();
      expect(await notified(b.clientId, 'client.REVIEW_REQUEST')).toBe(1);
      expect((await ctx.http.get(`/v1/missions/${b.missionId}/review`).set(bearer(b.client)).expect(200)).body).toEqual({ canReview: true, review: null });
      await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(b.client)).send({ rating: 6 }).expect(422);
      const other = await newClient('Yao', 'Kouassi');
      await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(other.tokens)).send({ rating: 1 }).expect(404);
      await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(b.pro)).send({ rating: 5 }).expect(403);
      const r = await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(b.client)).send({ rating: 4, comment: 'Travail propre et rapide.' }).expect(201);
      expect(r.body).toMatchObject({ rating: 4, status: 'PUBLISHED' });
      expect((await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(b.client)).send({ rating: 1 }).expect(409)).body.error.code).toBe('REVIEW_EXISTS');
      const pro = await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: b.proId } });
      const [stats] = await ctx.prisma.$queryRaw<{ avg: number; n: bigint }[]>`SELECT round(avg(rating)::numeric, 2)::float AS avg, count(*)::bigint AS n FROM reviews WHERE pro_id = ${b.proId}::uuid AND status = 'PUBLISHED'`;
      expect([Number(pro.ratingAvg), pro.ratingCount]).toEqual([stats!.avg, Number(stats!.n)]);
      expect(await ctx.prisma.notification.count({ where: { userId: b.proId, type: 'pro.NEW_REVIEW', data: { path: ['reviewId'], equals: r.body.id } } })).toBe(1);

      // Réponse du professionnel, une fois ; avis public avec le prénom et l'initiale seulement.
      await ctx.http.post(`/v1/pro/reviews/${r.body.id}/reply`).set(bearer(b.pro)).send({ reply: 'Merci pour votre confiance !' }).expect(201);
      await ctx.http.post(`/v1/pro/reviews/${r.body.id}/reply`).set(bearer(b.pro)).send({ reply: 'Encore merci' }).expect(409);
      const profile = await ctx.http.get(`/v1/pros/${b.proId}`).set(bearer(other.tokens)).expect(200);
      expect(profile.body.reviews[0]).toMatchObject({ rating: 4, comment: 'Travail propre et rapide.', author: 'Awa K.', proReply: 'Merci pour votre confiance !' });
      expect(JSON.stringify(profile.body.reviews)).not.toMatch(/Koné|\+225/);
    });

    it('commentaire avec des coordonnées : en attente de modération, non publié ni compté ; délai dépassé refusé', async () => {
      const b = await closedMission();
      const before = await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: b.proId } });
      const r = await ctx.http.post(`/v1/missions/${b.missionId}/review`).set(bearer(b.client)).send({ rating: 1, comment: 'Appelez-le plutôt au 07 08 09 10 11' }).expect(201);
      expect(r.body.status).toBe('PENDING_MODERATION');
      const after = await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: b.proId } });
      expect([after.ratingCount, Number(after.ratingAvg)]).toEqual([before.ratingCount, Number(before.ratingAvg)]);
      const published = (await ctx.http.get(`/v1/pros/${b.proId}/reviews`).set(bearer(b.client)).expect(200)).body as { id: string }[];
      expect(published.map((x) => x.id)).not.toContain(r.body.id);

      const late = await closedMission();
      await ctx.prisma.mission.update({ where: { id: late.missionId }, data: { closedAt: new Date(Date.now() - 31 * 86_400_000) } });
      expect((await ctx.http.post(`/v1/missions/${late.missionId}/review`).set(bearer(late.client)).send({ rating: 5 }).expect(409)).body.error.code).toBe('REVIEW_WINDOW_CLOSED');
    });
  });

  describe('T23 — réclamation', () => {
    it('sur une mission terminée : litige ouvert, clôture automatique suspendue, reversement gelé, échange avec le support puis décision', async () => {
      const a = await engage();
      await payWithSandbox(ctx, a.missionId);
      for (const step of ['depart', 'arrive', 'start']) await ctx.http.post(`/v1/pro/missions/${a.missionId}/${step}`).set(bearer(a.pro)).expect(200);
      await ctx.http.post(`/v1/pro/missions/${a.missionId}/complete`).set(bearer(a.pro)).send({}).expect(200);

      const attachment = await upload(a.client, 'COMPLAINT_ATTACHMENT');
      await ctx.http.post('/v1/complaints').set(bearer(a.client)).send({ missionId: a.missionId, category: 'QUALITY', description: 'court' }).expect(422);
      const c = await ctx.http.post('/v1/complaints').set(bearer(a.client)).send({ missionId: a.missionId, category: 'QUALITY', description: 'La fuite a repris le soir même.', fileIds: [attachment] }).expect(201);
      expect(c.body).toMatchObject({ reference: expect.stringMatching(/^REC-\d{4}-\d{6}$/), status: 'OPEN', mission: { status: 'DISPUTED' } });
      expect(c.body.messages[0].fileUrl).toBeTruthy();
      expect((await ctx.prisma.mission.findUniqueOrThrow({ where: { id: a.missionId } })).status).toBe('DISPUTED');
      // Pas de clôture automatique pendant le litige.
      await ctx.app.get(MissionsService).autoClose(new Date(Date.now() + 49 * 3_600_000));
      expect((await ctx.prisma.mission.findUniqueOrThrow({ where: { id: a.missionId } })).status).toBe('DISPUTED');
      expect(await notified(a.proId, 'pro.MISSION_DISPUTED', { missionId: a.missionId })).toBe(1);
      expect(await notified(a.proId, 'pro.COMPLAINT_OPENED', { complaintId: c.body.id })).toBe(1);
      const dup = await ctx.http.post('/v1/complaints').set(bearer(a.client)).send({ missionId: a.missionId, category: 'QUALITY', description: 'Toujours le même problème.' }).expect(409);
      expect(dup.body.error.code).toBe('COMPLAINT_ALREADY_OPEN');
      // Reversement gelé tant que la réclamation est en cours.
      const earnings = await ctx.http.get('/v1/pro/earnings').set(bearer(a.pro)).expect(200);
      expect(earnings.body.missions.find((m: { missionId: string }) => m.missionId === a.missionId)).toMatchObject({ available: false, disputed: true });

      // Accès : un autre client ne voit rien ; la modération ne traite pas les réclamations.
      const other = await newClient('Yao', 'Kouassi');
      await ctx.http.get(`/v1/complaints/${c.body.id}`).set(bearer(other.tokens)).expect(404);
      const moderation = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_MODERATION', 'moderation@ineed.test'));
      await ctx.http.get('/v1/admin/complaints').set(bearer(moderation)).expect(403);

      const support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support2@ineed.test'));
      const queue = await ctx.http.get('/v1/admin/complaints').set(bearer(support)).expect(200);
      expect(queue.body.map((x: { id: string }) => x.id)).toContain(c.body.id);
      await ctx.http.post(`/v1/admin/complaints/${c.body.id}/messages`).set(bearer(support)).send({ body: 'Client fiable, vérifier avec le pro', internal: true }).expect(201);
      await ctx.http.post(`/v1/admin/complaints/${c.body.id}/messages`).set(bearer(support)).send({ body: 'Pouvez-vous envoyer une photo de la fuite ?' }).expect(201);
      expect(await notified(a.clientId, 'client.COMPLAINT_UPDATED')).toBe(1);
      const seen = await ctx.http.get(`/v1/complaints/${c.body.id}`).set(bearer(a.client)).expect(200);
      expect(seen.body.status).toBe('WAITING_USER');
      expect(seen.body.messages.map((m: { body: string }) => m.body)).toEqual(['', 'Pouvez-vous envoyer une photo de la fuite ?']);
      expect(JSON.stringify(seen.body)).not.toContain('Client fiable');
      await ctx.http.post(`/v1/complaints/${c.body.id}/messages`).set(bearer(a.client)).send({ body: 'Voici, l’eau coule encore sous l’évier.' }).expect(201);
      expect((await ctx.http.get(`/v1/admin/complaints/${c.body.id}`).set(bearer(support)).expect(200)).body.status).toBe('IN_REVIEW');

      // Décision : remboursement partiel accordé par la Finance, lié à la réclamation.
      const payment = await ctx.prisma.payment.findFirstOrThrow({ where: { missionId: a.missionId, status: 'SUCCEEDED' } });
      const finance = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_FINANCE', 'finance@ineed.test'));
      const refund = await ctx.http.post(`/v1/admin/payments/${payment.id}/refunds`).set(bearer(finance)).set('Idempotency-Key', `rec-${c.body.id}`).send({ amountXof: 5000, reason: `Réclamation ${c.body.reference}` }).expect(201);
      await ctx.http.post(`/v1/admin/complaints/${c.body.id}/status`).set(bearer(support)).send({ status: 'RESOLVED' }).expect(422);
      const done = await ctx.http.post(`/v1/admin/complaints/${c.body.id}/status`).set(bearer(support)).send({ status: 'RESOLVED', resolution: 'Remboursement partiel de 5 000 F CFA accordé.', refundId: refund.body.id }).expect(201);
      expect(done.body).toMatchObject({ status: 'RESOLVED', refundId: refund.body.id });
      // Note interne, réponse, décision.
      expect(await ctx.prisma.auditLog.count({ where: { entityType: 'complaint', entityId: c.body.id } })).toBe(3);
      await ctx.http.post(`/v1/complaints/${c.body.id}/messages`).set(bearer(a.client)).send({ body: 'Merci' }).expect(409);
      expect(await notified(a.clientId, 'client.COMPLAINT_UPDATED')).toBe(2);
    });

    it('réclamation du professionnel, ou sans mission (assistance) : notifiée dans la bonne application', async () => {
      const a = await engage();
      const pc = await ctx.http.post('/v1/complaints').set(bearer(a.pro)).send({ missionId: a.missionId, category: 'PAYMENT', description: 'Le client ne répond plus depuis hier.' }).expect(201);
      const support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support3@ineed.test'));
      await ctx.http.post(`/v1/admin/complaints/${pc.body.id}/messages`).set(bearer(support)).send({ body: 'Nous contactons le client.' }).expect(201);
      expect(await notified(a.proId, 'pro.COMPLAINT_UPDATED', { complaintId: pc.body.id })).toBe(1);
      const general = await ctx.http.post('/v1/complaints').set(bearer(a.client)).send({ category: 'OTHER', description: 'Comment modifier mon numéro de téléphone ?' }).expect(201);
      expect(general.body.mission).toBeNull();
      expect((await ctx.http.get('/v1/complaints').set(bearer(a.client)).expect(200)).body).toHaveLength(1);
    });
  });
});
