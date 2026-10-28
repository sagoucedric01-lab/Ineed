import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ROTATION_GRACE_MS } from '../../src/auth/sessions.service.js';
import { ageChallenges, bearer, flushRedis, loginWithPhone, startTestContext, type TestContext } from '../helpers/api.js';

describe('Authentification par code SMS et sessions', () => {
  let ctx: TestContext;
  const saved = { ...process.env };

  beforeAll(async () => {
    ctx = await startTestContext();
  });
  beforeEach(async () => {
    await flushRedis();
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('T1 — inscription d’un client', () => {
    it('crée le compte à la première connexion, puis complète le profil', async () => {
      const login = await loginWithPhone(ctx, '07 11 11 11 01');
      expect(login.isNewUser).toBe(true);
      const me = await ctx.http.get('/v1/me').set(bearer(login.tokens)).expect(200);
      expect(me.body).toMatchObject({ phone: '+2250711111101', roles: ['CLIENT'], profileComplete: false, proStatus: null });

      const updated = await ctx.http.patch('/v1/me').set(bearer(login.tokens)).send({ firstName: 'Awa', lastName: 'Koné' }).expect(200);
      expect(updated.body).toMatchObject({ firstName: 'Awa', lastName: 'Koné', profileComplete: true });

      const audit = await ctx.prisma.auditLog.findFirst({ where: { action: 'auth.signup', entityId: login.userId } });
      expect(audit).not.toBeNull();
    });

    it('reconnaît le compte à la connexion suivante (même numéro, autre écriture)', async () => {
      await loginWithPhone(ctx, '07 11 11 11 02');
      await ageChallenges(ctx, '+2250711111102');
      const again = await loginWithPhone(ctx, '+225 0711111102');
      expect(again.isNewUser).toBe(false);
      expect(await ctx.prisma.user.count({ where: { phoneE164: '+2250711111102' } })).toBe(1);
    });

    it('refuse un nom contenant des caractères non autorisés', async () => {
      const login = await loginWithPhone(ctx, '07 11 11 11 03');
      const res = await ctx.http.patch('/v1/me').set(bearer(login.tokens)).send({ firstName: '<script>', lastName: 'X' }).expect(422);
      expect(res.body.error.details[0].field).toBe('firstName');
    });

    it('refuse un numéro invalide avec un message en français', async () => {
      const res = await ctx.http.post('/v1/auth/otp/request').send({ phone: '27 22 44 55 66' }).expect(422);
      expect(res.body.error.code).toBe('INVALID_PHONE');
      expect(res.body.error.message).toContain('10 chiffres');
    });
  });

  describe('sécurité des codes', () => {
    it('ne révèle pas si un numéro a déjà un compte (réponse identique)', async () => {
      await loginWithPhone(ctx, '07 22 22 22 01');
      const known = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 02' }).expect(202);
      const unknown = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 03' }).expect(202);
      expect(Object.keys(known.body).sort()).toEqual(Object.keys(unknown.body).sort());
      expect(known.body.devMode).toBe(true);
    });

    it('impose un délai de 60 s entre deux codes', async () => {
      await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 10' }).expect(202);
      const res = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 10' }).expect(429);
      expect(res.body.error.code).toBe('OTP_RESEND_TOO_SOON');
      expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(0);
    });

    it('limite à 3 codes par numéro sur 10 minutes', async () => {
      for (let i = 0; i < 3; i++) {
        await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 11' }).expect(202);
        await ageChallenges(ctx, '+2250722222211', 120);
      }
      const res = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 11' }).expect(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
    });

    it('limite à 10 demandes par adresse IP et par heure', async () => {
      for (let i = 0; i < 10; i++) await ctx.http.post('/v1/auth/otp/request').send({ phone: `07 33 33 33 ${String(i).padStart(2, '0')}` }).expect(202);
      await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 33 33 33 99' }).expect(429);
    });

    it('compte les essais erronés et bloque le code au 5ᵉ', async () => {
      const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 12' }).expect(202);
      for (let left = 4; left >= 1; left--) {
        const r = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: '000000', app: 'CLIENT' }).expect(400);
        expect(r.body.error.details.attemptsLeft).toBe(left);
      }
      await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: '000000', app: 'CLIENT' }).expect(429);
      const good = ctx.otp.lastCodes.get('+2250722222212')!;
      const blocked = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code: good, app: 'CLIENT' }).expect(429);
      expect(blocked.body.error.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    });

    it('un code ne sert qu’une fois, même envoyé deux fois en même temps', async () => {
      const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 13' }).expect(202);
      const code = ctx.otp.lastCodes.get('+2250722222213')!;
      const body = { challengeId: req.body.challengeId, code, app: 'CLIENT' };
      const results = await Promise.all([ctx.http.post('/v1/auth/otp/verify').send(body), ctx.http.post('/v1/auth/otp/verify').send(body)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
      expect(await ctx.prisma.user.count({ where: { phoneE164: '+2250722222213' } })).toBe(1);
    });

    it('refuse un code expiré', async () => {
      const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 14' }).expect(202);
      await ctx.prisma.otpChallenge.update({ where: { id: req.body.challengeId }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const code = ctx.otp.lastCodes.get('+2250722222214')!;
      const r = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code, app: 'CLIENT' }).expect(400);
      expect(r.body.error.code).toBe('OTP_EXPIRED');
    });

    it('ne stocke jamais le code en clair', async () => {
      const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 22 22 22 15' }).expect(202);
      const row = await ctx.prisma.otpChallenge.findUniqueOrThrow({ where: { id: req.body.challengeId } });
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toContain(ctx.otp.lastCodes.get('+2250722222215'));
    });
  });

  describe('sessions', () => {
    it('refuse les routes protégées sans jeton ou avec un jeton falsifié', async () => {
      await ctx.http.get('/v1/me').expect(401);
      const login = await loginWithPhone(ctx, '07 44 44 44 01');
      const [h, p] = login.tokens.accessToken.split('.');
      const forged = `${h}.${Buffer.from(JSON.stringify({ sub: login.userId, fid: 'x', app: 'ADMIN' })).toString('base64url')}.${p}`;
      await ctx.http.get('/v1/me').set({ authorization: `Bearer ${forged}` }).expect(401);
    });

    it('rotation : le nouveau jeton fonctionne, l’ancien est refusé', async () => {
      const login = await loginWithPhone(ctx, '07 44 44 44 02');
      const rotated = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken }).expect(200);
      await ctx.http.get('/v1/me').set(bearer(rotated.body)).expect(200);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken }).expect(401);
      // Dans le délai de grâce : la session de l'appareil reste valide.
      await ctx.http.get('/v1/me').set(bearer(rotated.body)).expect(200);
    });

    it('réutilisation d’un jeton déjà échangé après le délai de grâce : l’appareil est déconnecté', async () => {
      const login = await loginWithPhone(ctx, '07 44 44 44 03');
      const rotated = await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken }).expect(200);
      await ctx.prisma.session.updateMany({
        where: { revokedReason: 'ROTATED', userId: login.userId },
        data: { revokedAt: new Date(Date.now() - ROTATION_GRACE_MS - 1000) },
      });
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken }).expect(401);
      await ctx.http.get('/v1/me').set(bearer(rotated.body)).expect(401);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken }).expect(401);
      expect(await ctx.prisma.session.count({ where: { userId: login.userId, revokedReason: 'REUSE_DETECTED' } })).toBe(1);
    });

    it('déconnexion : le jeton d’accès est refusé immédiatement', async () => {
      const login = await loginWithPhone(ctx, '07 44 44 44 04');
      await ctx.http.post('/v1/auth/logout').set(bearer(login.tokens)).expect(204);
      await ctx.http.get('/v1/me').set(bearer(login.tokens)).expect(401);
      await ctx.http.post('/v1/auth/refresh').send({ refreshToken: login.tokens.refreshToken }).expect(401);
    });

    it('déconnecte un autre appareil depuis la liste des appareils', async () => {
      const phone = '07 44 44 44 05';
      const a = await loginWithPhone(ctx, phone);
      await ageChallenges(ctx, '+2250744444405');
      const b = await loginWithPhone(ctx, phone);
      const list = await ctx.http.get('/v1/me/sessions').set(bearer(a.tokens)).expect(200);
      expect(list.body).toHaveLength(2);
      const other = list.body.find((s: { current: boolean }) => !s.current);
      await ctx.http.delete(`/v1/me/sessions/${other.id}`).set(bearer(a.tokens)).expect(204);
      await ctx.http.get('/v1/me').set(bearer(b.tokens)).expect(401);
      await ctx.http.get('/v1/me').set(bearer(a.tokens)).expect(200);
    });

    it('ne permet pas de déconnecter l’appareil d’un autre utilisateur', async () => {
      const a = await loginWithPhone(ctx, '07 44 44 44 06');
      const b = await loginWithPhone(ctx, '07 44 44 44 07');
      const bSessions = await ctx.http.get('/v1/me/sessions').set(bearer(b.tokens)).expect(200);
      await ctx.http.delete(`/v1/me/sessions/${bSessions.body[0].id}`).set(bearer(a.tokens)).expect(404);
      await ctx.http.get('/v1/me').set(bearer(b.tokens)).expect(200);
    });

    it('un compte suspendu est refusé immédiatement, même avec un jeton valide', async () => {
      const login = await loginWithPhone(ctx, '07 44 44 44 08');
      await ctx.prisma.user.update({ where: { id: login.userId }, data: { status: 'SUSPENDED' } });
      const r = await ctx.http.get('/v1/me').set(bearer(login.tokens)).expect(403);
      expect(r.body.error.code).toBe('ACCOUNT_SUSPENDED');
      await ageChallenges(ctx, '+2250744444408');
      const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 44 44 44 08' }).expect(202);
      const code = ctx.otp.lastCodes.get('+2250744444408')!;
      await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code, app: 'CLIENT' }).expect(403);
    });

    it('un jeton émis pour l’application client ne donne pas accès à l’espace professionnel', async () => {
      const login = await loginWithPhone(ctx, '07 44 44 44 09');
      await ctx.http.get('/v1/pro/profile').set(bearer(login.tokens)).expect(403);
    });
  });
});
