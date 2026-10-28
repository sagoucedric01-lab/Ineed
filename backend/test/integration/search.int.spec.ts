import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, bearer, createAdmin, createTestPro, flushRedis, loginWithPhone, startTestContext, type TestContext, type Tokens } from '../helpers/api.js';

/** Client à Cocody (centre approximatif de la commune). */
const CLIENT = { lat: 5.36, lng: -3.97 };
const ids: Record<string, string> = {};

function tomorrowAt(hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  d.setUTCHours(hour, 0, 0, 0); // Abidjan est à UTC+0 toute l'année.
  return d.toISOString();
}

describe('Recherche de professionnels par métier et proximité', () => {
  let ctx: TestContext;
  let client: Tokens;
  let ops: Tokens;
  let superAdmin: Tokens;
  let proA: Tokens;
  let plomberie: string;
  let climatisation: string;
  const saved = { ...process.env };

  const search = (q: Record<string, string | number>) =>
    ctx.http.get('/v1/pros/search').set(bearer(client)).query({ categoryId: plomberie, mode: 'URGENT', ...CLIENT, ...q });
  const names = (body: { items: { id: string }[] }) => body.items.map((i) => Object.keys(ids).find((k) => ids[k] === i.id));

  beforeAll(async () => {
    ctx = await startTestContext();
    const cats = await ctx.prisma.category.findMany();
    plomberie = cats.find((c) => c.slug === 'plomberie')!.id;
    climatisation = cats.find((c) => c.slug === 'climatisation')!.id;

    const a = await createTestPro(ctx, { phone: '0701000001', businessName: 'A — tout près, position du moment', categorySlugs: ['plomberie'], online: true, live: { lat: 5.365, lng: -3.975 } });
    proA = a.tokens;
    ids.A = a.userId;
    ids.B = (await createTestPro(ctx, { phone: '0701000002', businessName: 'B — point de départ à 3 km', categorySlugs: ['plomberie'], online: true, base: { lat: 5.34, lng: -3.95 } })).userId;
    ids.C = (await createTestPro(ctx, { phone: '0701000003', businessName: 'C — Yopougon, 12 km', categorySlugs: ['plomberie'], online: true, base: { lat: 5.34, lng: -4.08 } })).userId;
    ids.D = (await createTestPro(ctx, { phone: '0701000004', businessName: 'D — hors ligne, horaires tous les jours', categorySlugs: ['plomberie'], base: { lat: 5.361, lng: -3.969 }, weekdays: [1, 2, 3, 4, 5, 6, 7] })).userId;
    ids.E = (await createTestPro(ctx, { phone: '0701000005', businessName: 'E — électricien', categorySlugs: ['electricite'], online: true, base: CLIENT })).userId;
    ids.F = (await createTestPro(ctx, { phone: '0701000006', businessName: 'F — dossier non validé', categorySlugs: ['plomberie'], online: true, base: CLIENT, status: 'SUBMITTED' })).userId;
    ids.G = (await createTestPro(ctx, { phone: '0701000007', businessName: 'G — en pause', categorySlugs: ['plomberie'], online: true, base: CLIENT, pausedUntil: new Date(Date.now() + 3_600_000) })).userId;
    ids.H = (await createTestPro(ctx, { phone: '0701000008', businessName: 'H — sans position, dessert Cocody', categorySlugs: ['plomberie'], online: true, zoneNames: ['Cocody'] })).userId;
    ids.I = (await createTestPro(ctx, { phone: '0701000009', businessName: 'I — position trop ancienne', categorySlugs: ['plomberie'], online: true, live: { lat: 5.3605, lng: -3.9705 }, liveMinutesAgo: 90 })).userId;
    ids.J = (await createTestPro(ctx, { phone: '0701000010', businessName: 'J — refuse les urgences', categorySlugs: ['plomberie'], online: true, base: CLIENT, urgent: false })).userId;
    ids.K = (await createTestPro(ctx, { phone: '0701000011', businessName: 'K — rayon personnel de 1 km', categorySlugs: ['plomberie'], online: true, base: { lat: 5.34, lng: -3.95 }, radiusM: 1000 })).userId;

    await flushRedis();
    client = (await loginWithPhone(ctx, '0702000001', 'CLIENT')).tokens;
    ops = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_OPS', 'ops@ineed.test'));
    superAdmin = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPER', 'super@ineed.test'));
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('T4 — recherche par catégorie et proximité', () => {
    it('urgence : seuls les professionnels validés, disponibles, du bon métier et dans le rayon initial (3 km)', async () => {
      const r = await search({}).expect(200);
      expect(r.body.radiusM).toBe(3000);
      expect(r.body.zoneName).toBe('Cocody');
      expect(names(r.body)).toEqual(['A', 'H']);
      expect(r.body.suggestions).toEqual([]);
    });

    it('carte d’un professionnel : distance, délai estimé, précision de la position, badge vérifié, aucune donnée privée', async () => {
      const r = await search({}).expect(200);
      const a = r.body.items[0];
      expect(a).toMatchObject({ businessName: 'A — tout près, position du moment', verified: true, locationPrecision: 'LIVE', isOnline: true, ratingAvg: null });
      expect(a.distanceM).toBeGreaterThan(700);
      expect(a.distanceM).toBeLessThan(900);
      expect(a.etaMinutes).toBe(15);
      expect(Object.keys(a).sort()).toEqual(
        ['avatarUrl', 'businessName', 'distanceM', 'etaMinutes', 'id', 'indicativePriceXof', 'isOnline', 'locationPrecision', 'missionsCompleted', 'ratingAvg', 'ratingCount', 'verified'].sort(),
      );
      expect(r.body.items[1]).toMatchObject({ locationPrecision: 'ZONE', distanceM: null, etaMinutes: null });
    });

    it('élargir le rayon fait apparaître les professionnels plus éloignés, sans dépasser le rayon maximal', async () => {
      expect(names((await search({ radiusM: 6000 }).expect(200)).body)).toEqual(['A', 'B', 'H']);
      const wide = await search({ radiusM: 50_000 }).expect(200);
      expect(wide.body.radiusM).toBe(15_000);
      // Sans position connue, H est classé comme s'il était au bord du rayon : C (12 km) passe devant.
      expect(names(wide.body)).toEqual(['A', 'B', 'C', 'H']);
    });

    it('le rayon personnel d’un professionnel est respecté', async () => {
      expect(names((await search({ radiusM: 6000 }).expect(200)).body)).not.toContain('K');
    });

    it('programmé : disponibilité selon les horaires, même hors ligne ; une absence déclarée l’exclut', async () => {
      const window = { mode: 'SCHEDULED', start: tomorrowAt(9), end: tomorrowAt(11) };
      const r = await search(window).expect(200);
      expect(r.body.radiusM).toBe(5000);
      expect(names(r.body)).toEqual(['D']);
      expect(r.body.items[0].etaMinutes).toBeNull();

      await ctx.prisma.$executeRaw`INSERT INTO pro_time_off (pro_id, period) VALUES (${ids.D}::uuid, tstzrange(${tomorrowAt(8)}::timestamptz, ${tomorrowAt(12)}::timestamptz))`;
      const off = await search(window).expect(200);
      expect(off.body.items).toEqual([]);
      expect(off.body.suggestions).toContain('CHANGE_SLOT');
      await ctx.prisma.$executeRaw`DELETE FROM pro_time_off WHERE pro_id = ${ids.D}::uuid`;
    });

    it('programmé : un créneau est obligatoire et doit être valide', async () => {
      expect((await search({ mode: 'SCHEDULED' }).expect(422)).body.error.code).toBe('WINDOW_REQUIRED');
      expect((await search({ mode: 'SCHEDULED', start: tomorrowAt(11), end: tomorrowAt(9) }).expect(422)).body.error.code).toBe('WINDOW_INVALID');
    });

    it('un point hors de la zone desservie est refusé', async () => {
      const r = await search({ lat: 7.69, lng: -5.03 }).expect(422);
      expect(r.body.error.code).toBe('OUTSIDE_SERVICE_AREA');
    });

    it('profil public : validé uniquement, sans téléphone ni position', async () => {
      const a = await ctx.http.get(`/v1/pros/${ids.A}`).set(bearer(client)).expect(200);
      expect(a.body).toMatchObject({ id: ids.A, verified: true, reviews: [] });
      expect(JSON.stringify(a.body)).not.toMatch(/phone|\+225|lat|lng|location/i);
      await ctx.http.get(`/v1/pros/${ids.F}`).set(bearer(client)).expect(404);
    });

    it('la recherche est réservée à l’application client', async () => {
      await ctx.http.get('/v1/pros/search').set(bearer(proA)).query({ categoryId: plomberie, mode: 'URGENT', ...CLIENT }).expect(403);
    });
  });

  describe('T6 — absence de professionnels disponibles', () => {
    it('urgence : aucun résultat, pistes proposées (élargir le rayon, programmer)', async () => {
      const r = await search({ categoryId: climatisation }).expect(200);
      expect(r.body.items).toEqual([]);
      expect(r.body.suggestions).toEqual(['WIDEN_RADIUS', 'SCHEDULE']);
      expect(r.body.nextRadiusM).toBe(6000);
    });

    it('au rayon maximal, seule la demande programmée reste proposée', async () => {
      const r = await search({ categoryId: climatisation, radiusM: 15_000 }).expect(200);
      expect(r.body.suggestions).toEqual(['SCHEDULE']);
      expect(r.body.nextRadiusM).toBeNull();
    });
  });

  describe('recherche par mots du client', () => {
    it('trouve le métier et la prestation à partir d’un mot courant, et le garde dans les recherches récentes', async () => {
      const r = await ctx.http.get('/v1/catalog/search').set(bearer(client)).query({ q: 'fuite' }).expect(200);
      expect(r.body.categories[0].name).toBe('Plomberie');
      expect(r.body.services.map((s: { name: string }) => s.name)).toContain('Fuite d’eau');
      const clim = await ctx.http.get('/v1/catalog/search').set(bearer(client)).query({ q: 'Clim' }).expect(200);
      expect(clim.body.categories[0].name).toBe('Climatisation');
      await ctx.http.get('/v1/catalog/search').set(bearer(client)).query({ q: 'fuite' }).expect(200);
      const recent = await ctx.http.get('/v1/catalog/recent-searches').set(bearer(client)).expect(200);
      expect(recent.body.map((x: { query: string }) => x.query)).toEqual(['fuite', 'Clim']);
    });
  });

  describe('administration : catalogue, règles et zones sans redéploiement', () => {
    it('désactiver un métier le retire immédiatement de l’accueil et de la recherche', async () => {
      await ctx.http.patch(`/v1/admin/catalog/categories/${plomberie}`).set(bearer(ops)).send({ isActive: false }).expect(200);
      const cats = await ctx.http.get('/v1/catalog/categories').expect(200);
      expect(cats.body.map((c: { id: string }) => c.id)).not.toContain(plomberie);
      expect((await search({}).expect(422)).body.error.code).toBe('CATEGORY_UNAVAILABLE');
      await ctx.http.patch(`/v1/admin/catalog/categories/${plomberie}`).set(bearer(ops)).send({ isActive: true }).expect(200);
      expect((await ctx.http.get('/v1/catalog/categories').expect(200)).body.map((c: { id: string }) => c.id)).toContain(plomberie);
      expect(await ctx.prisma.auditLog.count({ where: { action: 'catalog.category.update', entityId: plomberie } })).toBe(2);
    });

    it('ajout d’une prestation : prix fixe obligatoire pour une prestation à prix fixe, identifiant unique', async () => {
      const bad = await ctx.http.post('/v1/admin/catalog/services').set(bearer(ops))
        .send({ categoryId: plomberie, slug: 'plomberie-robinet', name: 'Remplacement de robinet', pricingModel: 'FIXED' }).expect(422);
      expect(bad.body.error.code).toBe('PRICING_INVALID');
      await ctx.http.post('/v1/admin/catalog/services').set(bearer(ops))
        .send({ categoryId: plomberie, slug: 'plomberie-robinet', name: 'Remplacement de robinet', pricingModel: 'FIXED', fixedPriceXof: 15000 }).expect(201);
      const dup = await ctx.http.post('/v1/admin/catalog/services').set(bearer(ops))
        .send({ categoryId: plomberie, slug: 'plomberie-robinet', name: 'Doublon', pricingModel: 'QUOTE' }).expect(409);
      expect(dup.body.error.code).toBe('SLUG_TAKEN');
      const cats = await ctx.http.get('/v1/catalog/categories').expect(200);
      const service = cats.body.find((c: { id: string }) => c.id === plomberie).services.find((s: { slug: string }) => s.slug === 'plomberie-robinet');
      expect(service).toMatchObject({ pricingModel: 'FIXED', fixedPriceXof: 15000 });
    });

    it('le rayon initial se règle depuis l’administration et s’applique immédiatement', async () => {
      const rules = await ctx.http.get('/v1/admin/dispatch-rules').set(bearer(superAdmin)).expect(200);
      const urgent = rules.body.find((r: { mode: string; categoryId: string | null }) => r.mode === 'URGENT' && r.categoryId === null);
      await ctx.http.patch(`/v1/admin/dispatch-rules/${urgent.id}`).set(bearer(superAdmin)).send({ initialRadiusM: 6000 }).expect(200);
      expect(names((await search({}).expect(200)).body)).toEqual(['A', 'B', 'H']);
      const invalid = await ctx.http.patch(`/v1/admin/dispatch-rules/${urgent.id}`).set(bearer(superAdmin)).send({ initialRadiusM: 20_000 }).expect(422);
      expect(invalid.body.error.code).toBe('RULE_INVALID');
      await ctx.http.patch(`/v1/admin/dispatch-rules/${urgent.id}`).set(bearer(superAdmin)).send({ initialRadiusM: 3000 }).expect(200);
      // Les règles relèvent de la permission « paramètres » : l'équipe Opérations ne peut pas les modifier.
      await ctx.http.patch(`/v1/admin/dispatch-rules/${urgent.id}`).set(bearer(ops)).send({ initialRadiusM: 4000 }).expect(403);
    });

    it('un contour de quartier rend la localisation précise ; un contour invalide est refusé', async () => {
      const zones = await ctx.http.get('/v1/geo/zones').expect(200);
      const cocody = zones.body.find((z: { name: string }) => z.name === 'Cocody');
      expect(cocody.centroid).toEqual({ lat: 5.36, lng: -3.97 });
      const city = await ctx.prisma.city.findFirstOrThrow({ where: { isActive: true } });
      const created = await ctx.http.post('/v1/admin/geo/zones').set(bearer(ops))
        .send({ cityId: city.id, parentId: cocody.id, kind: 'QUARTIER', name: 'Riviera Test' }).expect(201);
      const square = { type: 'Polygon', coordinates: [[[-3.955, 5.365], [-3.945, 5.365], [-3.945, 5.375], [-3.955, 5.375], [-3.955, 5.365]]] };
      await ctx.http.patch(`/v1/admin/geo/zones/${created.body.id}`).set(bearer(ops)).send({ boundary: square }).expect(200);
      const inside = await ctx.http.get('/v1/geo/locate').set(bearer(client)).query({ lat: 5.37, lng: -3.95 }).expect(200);
      expect(inside.body).toMatchObject({ inServiceArea: true, cityName: 'Abidjan', zoneName: 'Riviera Test', zoneApproximate: false });
      const bowtie = { type: 'Polygon', coordinates: [[[-3.95, 5.36], [-3.94, 5.37], [-3.94, 5.36], [-3.95, 5.37], [-3.95, 5.36]]] };
      expect((await ctx.http.patch(`/v1/admin/geo/zones/${created.body.id}`).set(bearer(ops)).send({ boundary: bowtie }).expect(422)).body.error.code).toBe('BOUNDARY_INVALID');
      const away = await ctx.http.get('/v1/geo/locate').set(bearer(client)).query({ lat: 7.69, lng: -5.03 }).expect(200);
      expect(away.body).toEqual({ inServiceArea: false });
    });
  });

  describe('position du professionnel', () => {
    it('acceptée seulement quand il est disponible, effacée quand il passe hors ligne', async () => {
      await ctx.http.put('/v1/pro/location').set(bearer(proA)).send({ lat: 5.366, lng: -3.976 }).expect(200);
      await ctx.http.patch('/v1/pro/availability').set(bearer(proA)).send({ isOnline: false }).expect(200);
      const [row] = await ctx.prisma.$queryRaw<{ cleared: boolean }[]>`
        SELECT last_location IS NULL AND last_location_at IS NULL AS cleared FROM pro_profiles WHERE user_id = ${ids.A}::uuid`;
      expect(row!.cleared).toBe(true);
      expect((await ctx.http.put('/v1/pro/location').set(bearer(proA)).send({ lat: 5.366, lng: -3.976 }).expect(409)).body.error.code).toBe('NOT_AVAILABLE');
      await ctx.http.patch('/v1/pro/availability').set(bearer(proA)).send({ isOnline: true }).expect(200);
      await ctx.http.put('/v1/pro/location').set(bearer(proA)).send({ lat: 7.69, lng: -5.03 }).expect(422);
    });

    it('point de départ et rayon modifiables après validation, sans nouvelle vérification', async () => {
      const r = await ctx.http.put('/v1/pro/service-area').set(bearer(proA)).send({ baseLocation: { lat: 5.362, lng: -3.972 }, serviceRadiusM: 8000 }).expect(200);
      expect(r.body).toMatchObject({ verificationStatus: 'APPROVED', serviceRadiusM: 8000, baseLocation: { lat: 5.362, lng: -3.972 } });
    });
  });
});
