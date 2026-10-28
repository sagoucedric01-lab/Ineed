import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ageChallenges, bearer, flushRedis, loginWithPhone, startTestContext, uploadFile, type TestContext } from '../helpers/api.js';

describe('T25 — suppression de compte', () => {
  let ctx: TestContext;
  const saved = { ...process.env };

  beforeAll(async () => {
    ctx = await startTestContext();
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  it('exige un code SMS, anonymise le compte, efface la photo et déconnecte tous les appareils', async () => {
    const phone = '+2250777777701';
    const a = await loginWithPhone(ctx, phone);
    await ageChallenges(ctx, phone);
    const b = await loginWithPhone(ctx, phone);
    await ctx.http.patch('/v1/me').set(bearer(a.tokens)).send({ firstName: 'Yao', lastName: 'Kouadio' }).expect(200);
    const photo = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#0B2A5B' } }).jpeg().toBuffer();
    const avatar = await uploadFile(ctx, a.tokens, 'AVATAR', photo, 'image/jpeg');
    await ctx.http.put('/v1/me/avatar').set(bearer(a.tokens)).send({ fileId: avatar.fileId }).expect(200);

    await ageChallenges(ctx, phone);
    const challenge = await ctx.http.post('/v1/me/deletion/code').set(bearer(a.tokens)).expect(202);
    await ctx.http.post('/v1/me/deletion').set(bearer(a.tokens)).send({ challengeId: challenge.body.challengeId, code: '000000' }).expect(400);
    await ctx.http.get('/v1/me').set(bearer(a.tokens)).expect(200);

    const code = ctx.otp.lastCodes.get(phone)!;
    await ctx.http.post('/v1/me/deletion').set(bearer(a.tokens)).send({ challengeId: challenge.body.challengeId, code }).expect(204);

    await ctx.http.get('/v1/me').set(bearer(a.tokens)).expect(401);
    await ctx.http.get('/v1/me').set(bearer(b.tokens)).expect(401);
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: a.userId } });
    expect(user).toMatchObject({ phoneE164: null, firstName: null, lastName: null, email: null, avatarFileId: null, status: 'DELETED' });
    expect(user.anonymizedAt).not.toBeNull();
    expect((await ctx.prisma.file.findUniqueOrThrow({ where: { id: avatar.fileId } })).status).toBe('DELETED');
    expect(await ctx.prisma.auditLog.count({ where: { action: 'user.delete', entityId: a.userId } })).toBe(1);

    // Le même numéro peut créer un nouveau compte, sans lien avec l'ancien
    // (compteurs vidés : ce numéro a déjà reçu 3 codes en 10 minutes, la limite par numéro).
    await ageChallenges(ctx, phone);
    await flushRedis();
    const fresh = await loginWithPhone(ctx, phone);
    expect(fresh.isNewUser).toBe(true);
    expect(fresh.userId).not.toBe(a.userId);
  });

  it('un code de connexion ne peut pas servir à confirmer une suppression', async () => {
    const phone = '+2250777777702';
    const login = await loginWithPhone(ctx, phone);
    await ageChallenges(ctx, phone);
    const loginChallenge = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
    const code = ctx.otp.lastCodes.get(phone)!;
    await ctx.http.post('/v1/me/deletion').set(bearer(login.tokens)).send({ challengeId: loginChallenge.body.challengeId, code }).expect(400);
    expect((await ctx.prisma.user.findUniqueOrThrow({ where: { id: login.userId } })).status).toBe('ACTIVE');
  });

  it('refuse la suppression tant qu’une demande est en cours', async () => {
    const phone = '+2250777777703';
    const login = await loginWithPhone(ctx, phone);
    const category = await ctx.prisma.category.findUniqueOrThrow({ where: { slug: 'plomberie' } });
    const city = await ctx.prisma.city.findFirstOrThrow();
    await ctx.prisma.$executeRaw`
      INSERT INTO service_requests (client_id, city_id, category_id, pricing_model, mode, status, description, location, address_snapshot)
      VALUES (${login.userId}::uuid, ${city.id}::uuid, ${category.id}::uuid, 'QUOTE', 'URGENT', 'MATCHING',
              'Fuite sous l’évier de la cuisine', ST_SetSRID(ST_MakePoint(-4.0, 5.36), 4326)::geography, '{}'::jsonb)`;
    await ageChallenges(ctx, phone);
    const r = await ctx.http.post('/v1/me/deletion/code').set(bearer(login.tokens)).expect(409);
    expect(r.body.error.code).toBe('ACCOUNT_HAS_ACTIVE_ACTIVITY');
  });
});
