import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, createAdmin, flushRedis, loginWithPhone, startTestContext, uploadFile, type TestContext, type Tokens } from '../helpers/api.js';
import { BACKEND_DIR } from '../helpers/db.js';

const VOICE_2S = readFileSync(resolve(BACKEND_DIR, 'test/fixtures/voice-2s.m4a'));

/** En-tête M4A annonçant une durée donnée (le contenu audio n'est pas décodé par le serveur). */
function fakeM4a(seconds: number): Buffer {
  const box = (type: string, body: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const mvhd = Buffer.alloc(24);
  mvhd.writeUInt32BE(1000, 12);
  mvhd.writeUInt32BE(seconds * 1000, 16);
  return Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0M4A isom')), box('moov', box('mvhd', mvhd)), box('mdat', Buffer.alloc(64))]);
}

function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

const PLACE = { location: { lat: 5.36, lng: -3.97 }, landmark: 'Derrière la pharmacie, portail vert', instructions: 'Appeler en arrivant' };

describe('Adresses et demandes', () => {
  let ctx: TestContext;
  let client: Tokens;
  let other: Tokens;
  let pro: Tokens;
  let plomberie: { id: string; services: { id: string; name: string }[] };
  const saved = { ...process.env };

  const photo = () => sharp({ create: { width: 320, height: 240, channels: 3, background: '#8899aa' } }).jpeg().toBuffer();
  const draft = (extra: Record<string, unknown> = {}) => ({
    categoryId: plomberie.id,
    serviceId: plomberie.services[0]!.id,
    mode: 'URGENT',
    description: 'L’eau fuit sous l’évier de la cuisine depuis ce matin.',
    place: PLACE,
    ...extra,
  });

  beforeAll(async () => {
    ctx = await startTestContext();
    client = (await loginWithPhone(ctx, '0703000001')).tokens;
    other = (await loginWithPhone(ctx, '0703000002')).tokens;
    pro = (await loginWithPhone(ctx, '0703000003', 'PRO')).tokens;
    const cats = await ctx.http.get('/v1/catalog/categories').expect(200);
    plomberie = cats.body.find((c: { slug: string }) => c.slug === 'plomberie');
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('adresses', () => {
    it('commune déduite du point, repère obligatoire, point hors zone refusé', async () => {
      const a = await ctx.http.post('/v1/me/addresses').set(bearer(client)).send({ ...PLACE, label: 'Maison' }).expect(201);
      expect(a.body).toMatchObject({ label: 'Maison', cityName: 'Abidjan', zoneName: 'Cocody', landmark: PLACE.landmark, location: PLACE.location });
      const noLandmark = await ctx.http.post('/v1/me/addresses').set(bearer(client)).send({ location: PLACE.location }).expect(422);
      expect(noLandmark.body.error.code).toBe('ADDRESS_INCOMPLETE');
      const far = await ctx.http.post('/v1/me/addresses').set(bearer(client)).send({ location: { lat: 7.69, lng: -5.03 }, landmark: 'Bouaké' }).expect(422);
      expect(far.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    });

    it('la commune choisie par le client prévaut ; elle doit appartenir à la ville', async () => {
      const zones = await ctx.http.get('/v1/geo/zones').expect(200);
      const marcory = zones.body.find((z: { name: string }) => z.name === 'Marcory');
      const a = await ctx.http.post('/v1/me/addresses').set(bearer(client)).send({ ...PLACE, zoneId: marcory.id }).expect(201);
      expect(a.body.zoneName).toBe('Marcory');
      const bad = await ctx.http.post('/v1/me/addresses').set(bearer(client)).send({ ...PLACE, zoneId: '00000000-0000-4000-8000-000000000001' }).expect(422);
      expect(bad.body.error.code).toBe('ZONE_INVALID');
    });

    it('chaque client ne voit et ne supprime que ses adresses', async () => {
      const mine = await ctx.http.get('/v1/me/addresses').set(bearer(client)).expect(200);
      expect(mine.body).toHaveLength(2);
      expect((await ctx.http.get('/v1/me/addresses').set(bearer(other)).expect(200)).body).toEqual([]);
      await ctx.http.delete(`/v1/me/addresses/${mine.body[0].id}`).set(bearer(other)).expect(404);
      await ctx.http.delete(`/v1/me/addresses/${mine.body[0].id}`).set(bearer(client)).expect(204);
      expect((await ctx.http.get('/v1/me/addresses').set(bearer(client)).expect(200)).body).toHaveLength(1);
      await ctx.http.get('/v1/me/addresses').set(bearer(pro)).expect(403);
    });
  });

  describe('médias d’une demande', () => {
    it('photo ré-encodée et rangée dans le stockage privé', async () => {
      const up = await uploadFile(ctx, client, 'REQUEST_PHOTO', await photo(), 'image/jpeg');
      const file = await ctx.prisma.file.findUniqueOrThrow({ where: { id: up.fileId } });
      expect(file).toMatchObject({ status: 'READY', visibility: 'PRIVATE', mimeType: 'image/jpeg' });
    });

    it('note vocale réelle de 2 secondes acceptée', async () => {
      const up = await uploadFile(ctx, client, 'REQUEST_VOICE', VOICE_2S, 'audio/mp4');
      expect((await ctx.prisma.file.findUniqueOrThrow({ where: { id: up.fileId } })).status).toBe('READY');
    });

    it('fichiers non autorisés refusés : note trop longue, contenu déguisé, format non accepté', async () => {
      const long = await uploadFile(ctx, client, 'REQUEST_VOICE', fakeM4a(300), 'audio/mp4', 422);
      expect(long.complete.body.error.message).toContain('120 secondes');
      const disguised = await uploadFile(ctx, client, 'REQUEST_VOICE', await photo(), 'audio/mp4', 422);
      expect(disguised.complete.body.error.code).toBe('FILE_REJECTED');
      const ogg = await ctx.http.post('/v1/files').set(bearer(client)).send({ purpose: 'REQUEST_VOICE', mimeType: 'audio/ogg', sizeBytes: 1000 }).expect(422);
      expect(ogg.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
      const pdfAsPhoto = await ctx.http.post('/v1/files').set(bearer(client)).send({ purpose: 'REQUEST_PHOTO', mimeType: 'application/pdf', sizeBytes: 1000 }).expect(422);
      expect(pdfAsPhoto.body.error.code).toBe('FILE_TYPE_NOT_ALLOWED');
    });
  });

  describe('T5 — création d’une demande', () => {
    let requestId: string;

    it('brouillon complet : prestation, description, photos, note vocale, lieu avec repère', async () => {
      const p1 = await uploadFile(ctx, client, 'REQUEST_PHOTO', await photo(), 'image/jpeg');
      const p2 = await uploadFile(ctx, client, 'REQUEST_PHOTO', await photo(), 'image/jpeg');
      const voice = await uploadFile(ctx, client, 'REQUEST_VOICE', VOICE_2S, 'audio/mp4');
      const r = await ctx.http.post('/v1/requests').set(bearer(client))
        .send(draft({ photoFileIds: [p1.fileId, p2.fileId], voiceFileId: voice.fileId, budgetXof: 15000 })).expect(201);
      requestId = r.body.id;
      expect(r.body).toMatchObject({
        status: 'DRAFT',
        mode: 'URGENT',
        pricingModel: 'QUOTE',
        budgetXof: 15000,
        window: null,
        category: { id: plomberie.id, name: 'Plomberie' },
        service: { id: plomberie.services[0]!.id },
        place: { zoneName: 'Cocody', cityName: 'Abidjan', landmark: PLACE.landmark, instructions: PLACE.instructions, location: PLACE.location },
      });
      expect(r.body.media.map((m: { kind: string }) => m.kind)).toEqual(['PHOTO', 'PHOTO', 'VOICE']);
      expect(r.body.media[0].url).toMatch(/^http/);
      expect(r.body.history).toEqual([expect.objectContaining({ from: null, to: 'DRAFT' })]);
    });

    it('relecture puis modification du brouillon (une photo retirée est effacée)', async () => {
      const before = await ctx.http.get(`/v1/requests/${requestId}`).set(bearer(client)).expect(200);
      const keep = before.body.media.filter((m: { kind: string }) => m.kind === 'PHOTO')[0].fileId;
      const removed = before.body.media.filter((m: { kind: string }) => m.kind === 'PHOTO')[1].fileId;
      const r = await ctx.http.put(`/v1/requests/${requestId}`).set(bearer(client))
        .send(draft({ description: 'Fuite sous l’évier, l’eau coule en continu.', photoFileIds: [keep] })).expect(200);
      expect(r.body.media).toHaveLength(1);
      expect(r.body.description).toBe('Fuite sous l’évier, l’eau coule en continu.');
      expect((await ctx.prisma.file.findUniqueOrThrow({ where: { id: removed } })).status).toBe('DELETED');
    });

    it('publication : statut publié, date et historique ; plus de modification possible', async () => {
      const r = await ctx.http.post(`/v1/requests/${requestId}/publish`).set(bearer(client)).expect(200);
      expect(r.body.status).toBe('PUBLISHED');
      expect(r.body.publishedAt).not.toBeNull();
      expect(r.body.history.map((h: { to: string }) => h.to)).toEqual(['DRAFT', 'PUBLISHED']);
      expect((await ctx.http.post(`/v1/requests/${requestId}/publish`).set(bearer(client)).expect(409)).body.error.code).toBe('REQUEST_NOT_DRAFT');
      expect((await ctx.http.put(`/v1/requests/${requestId}`).set(bearer(client)).send(draft()).expect(409)).body.error.code).toBe('REQUEST_NOT_DRAFT');
      const list = await ctx.http.get('/v1/requests').set(bearer(client)).expect(200);
      expect(list.body[0]).toMatchObject({ id: requestId, status: 'PUBLISHED', zoneName: 'Cocody' });
    });

    it('une demande n’est visible que par son auteur, et pas depuis l’application Pro', async () => {
      await ctx.http.get(`/v1/requests/${requestId}`).set(bearer(other)).expect(404);
      await ctx.http.post(`/v1/requests/${requestId}/cancel`).set(bearer(other)).send({}).expect(404);
      await ctx.http.get(`/v1/requests/${requestId}`).set(bearer(pro)).expect(403);
    });

    it('un fichier ne peut pas être joint par un autre utilisateur, ni à deux demandes', async () => {
      const mine = await uploadFile(ctx, client, 'REQUEST_PHOTO', await photo(), 'image/jpeg');
      await ctx.http.post('/v1/requests').set(bearer(other)).send(draft({ photoFileIds: [mine.fileId] })).expect(404);
      const attached = (await ctx.http.get(`/v1/requests/${requestId}`).set(bearer(client)).expect(200)).body.media[0].fileId;
      const reuse = await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ photoFileIds: [attached] })).expect(409);
      expect(reuse.body.error.code).toBe('FILE_ALREADY_USED');
    });

    it('annulation tant qu’aucun professionnel n’est réservé', async () => {
      const r = await ctx.http.post(`/v1/requests/${requestId}/cancel`).set(bearer(client)).send({ reason: 'Réparé par un voisin' }).expect(200);
      expect(r.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Réparé par un voisin' });
      const history = await ctx.http.get('/v1/requests').set(bearer(client)).query({ scope: 'history' }).expect(200);
      expect(history.body.map((x: { id: string }) => x.id)).toContain(requestId);
    });

    it('demande programmée : créneau obligatoire pour publier, refusé pour une urgence', async () => {
      const urgentWithWindow = await ctx.http.post('/v1/requests').set(bearer(client))
        .send(draft({ window: { start: tomorrowAt(9), end: tomorrowAt(11) } })).expect(422);
      expect(urgentWithWindow.body.error.code).toBe('WINDOW_NOT_ALLOWED');
      const d = await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ mode: 'SCHEDULED' })).expect(201);
      expect((await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(client)).expect(422)).body.error.code).toBe('WINDOW_REQUIRED');
      const ok = await ctx.http.put(`/v1/requests/${d.body.id}`).set(bearer(client))
        .send(draft({ mode: 'SCHEDULED', window: { start: tomorrowAt(9), end: tomorrowAt(11) } })).expect(200);
      expect(ok.body.window).toEqual({ start: tomorrowAt(9), end: tomorrowAt(11) });
      expect((await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(client)).expect(200)).body.status).toBe('PUBLISHED');
    });

    it('adresse enregistrée : copie figée dans la demande', async () => {
      const addr = (await ctx.http.get('/v1/me/addresses').set(bearer(client)).expect(200)).body[0];
      const r = await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ place: undefined, addressId: addr.id })).expect(201);
      expect(r.body.place).toMatchObject({ addressId: addr.id, landmark: addr.landmark, zoneName: addr.zoneName });
      await ctx.http.delete(`/v1/me/addresses/${addr.id}`).set(bearer(client)).expect(204);
      const after = await ctx.http.get(`/v1/requests/${r.body.id}`).set(bearer(client)).expect(200);
      expect(after.body.place.landmark).toBe(addr.landmark);
    });

    it('refus : lieu hors zone, description trop courte, sans lieu', async () => {
      expect((await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ place: { ...PLACE, location: { lat: 7.69, lng: -5.03 } } })).expect(422)).body.error.code).toBe('OUTSIDE_SERVICE_AREA');
      expect((await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ description: 'Fuite' })).expect(422)).body.error.code).toBe('VALIDATION_FAILED');
      expect((await ctx.http.post('/v1/requests').set(bearer(client)).send(draft({ place: undefined })).expect(422)).body.error.code).toBe('PLACE_REQUIRED');
    });

    it('un métier désactivé entre-temps empêche la publication du brouillon', async () => {
      const d = await ctx.http.post('/v1/requests').set(bearer(client)).send(draft()).expect(201);
      await ctx.prisma.category.update({ where: { id: plomberie.id }, data: { isActive: false } });
      expect((await ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(client)).expect(422)).body.error.code).toBe('CATEGORY_UNAVAILABLE');
      await ctx.prisma.category.update({ where: { id: plomberie.id }, data: { isActive: true } });
    });

    it('limite de demandes en cours par client, y compris en publications simultanées', async () => {
      await flushRedis();
      const busy = (await loginWithPhone(ctx, '0703000009')).tokens;
      const drafts = await Promise.all([1, 2, 3, 4, 5].map(() => ctx.http.post('/v1/requests').set(bearer(busy)).send(draft()).expect(201)));
      const results = await Promise.all(drafts.map((d) => ctx.http.post(`/v1/requests/${d.body.id}/publish`).set(bearer(busy))));
      expect(results.filter((r) => r.status === 200)).toHaveLength(3);
      expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'TOO_MANY_ACTIVE_REQUESTS')).toBe(true);
    });

    it('administration : liste et détail en lecture seule, sans les photos du domicile', async () => {
      const support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support@ineed.test'));
      const list = await ctx.http.get('/v1/admin/requests').set(bearer(support)).query({ status: 'PUBLISHED' }).expect(200);
      expect(list.body.total).toBeGreaterThan(0);
      const detail = await ctx.http.get(`/v1/admin/requests/${list.body.items[0].id}`).set(bearer(support)).expect(200);
      expect(detail.body.media.every((m: { url?: string }) => m.url === undefined)).toBe(true);
      const finance = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_FINANCE', 'finance@ineed.test'));
      await ctx.http.get('/v1/admin/requests').set(bearer(finance)).expect(403);
    });
  });
});
