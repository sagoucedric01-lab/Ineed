import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { DiscoveryService, MetadataScanner, ModulesContainer, Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_RULE, type AccessRule, IS_PUBLIC } from '../../src/auth/decorators.js';
import { adminLogin, bearer, createAdmin, loginWithPhone, startTestContext, type TestContext, type Tokens } from '../helpers/api.js';

type Persona = 'anonyme' | 'client' | 'pro' | 'support' | 'ops' | 'finance' | 'super';
const UUID = '00000000-0000-4000-8000-000000000001';

/** Résultat attendu : « ok » = l'accès est accordé (la réponse métier peut être 2xx, 404, 409, 422). */
type Expect = 'ok' | 401 | 403;

const MATRIX: { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; body?: object; expect: Record<Persona, Expect> }[] = [
  { method: 'get', path: '/v1/me', expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/me/sessions', expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'post', path: '/v1/files', body: { purpose: 'AVATAR', mimeType: 'image/jpeg', sizeBytes: 10 }, expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/pro/profile', expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'put', path: '/v1/pro/profile', body: {}, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: '/v1/pro/profile/submit', expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/admin/pros', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'get', path: `/v1/admin/pros/${UUID}`, expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'get', path: `/v1/admin/documents/${UUID}/url`, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'post', path: `/v1/admin/pros/${UUID}/approve`, body: {}, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'post', path: `/v1/admin/pros/${UUID}/suspend`, body: { note: 'x' }, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'post', path: '/v1/admin/auth/password', body: {}, expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/catalog/categories', expect: { anonyme: 'ok', client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/catalog/search?q=fuite', expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/pros/search', expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/pros/${UUID}`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/me/addresses', expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: '/v1/requests', body: {}, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/requests/${UUID}`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'put', path: '/v1/pro/location', body: {}, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/me/notifications', expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/admin/catalog/categories', expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'patch', path: `/v1/admin/catalog/categories/${UUID}`, body: {}, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'post', path: '/v1/admin/geo/zones', body: {}, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'get', path: '/v1/admin/dispatch-rules', expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 403, finance: 403, super: 'ok' } },
  { method: 'put', path: '/v1/admin/settings/request.max_photos', body: { value: 5 }, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 403, finance: 403, super: 'ok' } },
  { method: 'get', path: '/v1/pro/offers', expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/pro/offers/${UUID}/accept`, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/requests/${UUID}/confirm`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/missions/${UUID}`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/pro/missions/${UUID}/depart`, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/admin/missions', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'post', path: `/v1/admin/missions/${UUID}/cancel`, body: { reason: 'Test' }, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'get', path: '/v1/admin/requests', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 'ok', finance: 403, super: 'ok' } },
  { method: 'post', path: `/v1/missions/${UUID}/quotes/${UUID}/accept`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/pro/missions/${UUID}/quotes`, body: {}, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/missions/${UUID}/payments`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/payments/${UUID}`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/payments/${UUID}/receipt`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/pro/earnings', expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: '/v1/admin/payments', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 403, finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/admin/ledger/balances', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 403, finance: 'ok', super: 'ok' } },
  // Un rôle SUPPORT ne peut pas approuver un remboursement.
  { method: 'post', path: `/v1/admin/payments/${UUID}/refunds`, body: { amountXof: 100, reason: 'Test de droits' }, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 403, finance: 'ok', super: 'ok' } },
  { method: 'post', path: `/v1/admin/refunds/${UUID}/complete`, body: { providerRefundId: 'X-1' }, expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 403, finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/conversations', expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: `/v1/conversations/${UUID}/messages`, expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'put', path: '/v1/me/devices', body: {}, expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'post', path: '/v1/reports', body: {}, expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'post', path: `/v1/missions/${UUID}/review`, body: { rating: 5 }, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'get', path: `/v1/pros/${UUID}/reviews`, expect: { anonyme: 401, client: 'ok', pro: 403, support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: `/v1/pro/reviews/${UUID}/reply`, body: { reply: 'Merci' }, expect: { anonyme: 401, client: 403, pro: 'ok', support: 403, ops: 403, finance: 403, super: 403 } },
  { method: 'post', path: '/v1/complaints', body: {}, expect: { anonyme: 401, client: 'ok', pro: 'ok', support: 'ok', ops: 'ok', finance: 'ok', super: 'ok' } },
  { method: 'get', path: '/v1/admin/complaints', expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 403, finance: 403, super: 'ok' } },
  { method: 'post', path: `/v1/admin/complaints/${UUID}/status`, body: { status: 'IN_REVIEW' }, expect: { anonyme: 401, client: 403, pro: 403, support: 'ok', ops: 403, finance: 403, super: 'ok' } },
  { method: 'get', path: '/v1/admin/notification-templates', expect: { anonyme: 401, client: 403, pro: 403, support: 403, ops: 403, finance: 403, super: 'ok' } },
];

describe('T24 — contrôle d’accès', () => {
  let ctx: TestContext;
  const tokens: Partial<Record<Persona, Tokens>> = {};
  const saved = { ...process.env };

  beforeAll(async () => {
    ctx = await startTestContext();
    tokens.client = (await loginWithPhone(ctx, '07 66 66 66 01', 'CLIENT')).tokens;
    tokens.pro = (await loginWithPhone(ctx, '07 66 66 66 02', 'PRO')).tokens;
    tokens.support = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPPORT', 'support@ineed.test'));
    tokens.ops = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_OPS', 'ops@ineed.test'));
    tokens.finance = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_FINANCE', 'finance@ineed.test'));
    tokens.super = await adminLogin(ctx, await createAdmin(ctx, 'ADMIN_SUPER', 'super@ineed.test'));
  });
  afterAll(async () => {
    await ctx?.close();
    process.env = { ...saved };
  });

  for (const row of MATRIX) {
    for (const persona of Object.keys(row.expect) as Persona[]) {
      const expected = row.expect[persona];
      it(`${row.method.toUpperCase()} ${row.path} — ${persona} : ${expected === 'ok' ? 'autorisé' : expected}`, async () => {
        let req = ctx.http[row.method](row.path);
        const t = tokens[persona];
        if (t) req = req.set(bearer(t));
        const res = await (row.body ? req.send(row.body) : req);
        if (expected === 'ok') expect([401, 403]).not.toContain(res.status);
        else expect(res.status).toBe(expected);
      });
    }
  }

  it('un client ne peut pas obtenir un accès professionnel en modifiant l’application annoncée', async () => {
    const req = await ctx.http.post('/v1/auth/otp/request').send({ phone: '07 66 66 66 03' }).expect(202);
    const code = ctx.otp.lastCodes.get('+2250766666603')!;
    const bad = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code, app: 'ADMIN' }).expect(422);
    expect(bad.body.error.code).toBe('VALIDATION_FAILED');
  });

  describe('garde-fou sur toutes les routes déclarées', () => {
    interface Route { method: string; path: string; isPublic: boolean; rule?: AccessRule }
    let routes: Route[];

    beforeAll(() => {
      // Services de découverte instanciés ici : l'application n'en a pas besoin à l'exécution.
      const discovery = new DiscoveryService(ctx.app.get(ModulesContainer));
      const scanner = new MetadataScanner();
      const reflector = new Reflector();
      routes = [];
      for (const wrapper of discovery.getControllers()) {
        const instance = wrapper.instance as object | undefined;
        if (!instance) continue;
        const cls = instance.constructor;
        const base = String(Reflect.getMetadata(PATH_METADATA, cls) ?? '');
        for (const name of scanner.getAllMethodNames(Object.getPrototypeOf(instance))) {
          const handler = (instance as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
          const sub = Reflect.getMetadata(PATH_METADATA, handler) as string | undefined;
          if (sub === undefined) continue;
          const method = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as number] ?? '?';
          routes.push({
            method,
            path: [base, sub].filter((p) => p && p !== '/').join('/').replace(/\/+/g, '/'),
            isPublic: !!reflector.getAllAndOverride<boolean>(IS_PUBLIC, [handler, cls]),
            rule: reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE, [handler, cls]),
          });
        }
      }
    });

    it('seules les routes prévues sont publiques', () => {
      const publicRoutes = routes.filter((r) => r.isPublic).map((r) => `${r.method} ${r.path}`).sort();
      expect(publicRoutes).toEqual([
        'GET health/live',
        'GET health/ready',
        'GET v1/catalog/categories',
        'GET v1/geo/zones',
        // Paiement : retour du prestataire, contrôle de l'adresse de notification, page simulée (404 hors simulateur).
        'GET v1/payment-return',
        'GET v1/payments/notify/:provider',
        'GET v1/payments/sandbox/checkout/:ref',
        'POST v1/admin/auth/login',
        'POST v1/admin/auth/totp',
        'POST v1/auth/otp/request',
        'POST v1/auth/otp/verify',
        'POST v1/auth/refresh',
        // Notifications du prestataire : authentifiées par leur signature, jamais par un jeton.
        'POST v1/payments/notify/:provider',
        'POST v1/payments/sandbox/checkout/:ref',
      ]);
    });

    it('toute route d’administration exige une session ADMIN et, hors connexion, une permission explicite', () => {
      const admin = routes.filter((r) => r.path.startsWith('v1/admin/') && !r.isPublic);
      expect(admin.length).toBeGreaterThan(5);
      for (const r of admin) {
        expect(r.rule?.app, `${r.method} ${r.path}`).toBe('ADMIN');
        if (r.path !== 'v1/admin/auth/password') expect(r.rule?.permissions?.length, `${r.method} ${r.path}`).toBeGreaterThan(0);
      }
    });

    it('toute route de l’espace professionnel exige une session de l’application Pro et le rôle PRO', () => {
      for (const r of routes.filter((x) => x.path.startsWith('v1/pro/'))) {
        expect(r.rule, `${r.method} ${r.path}`).toMatchObject({ app: 'PRO', roles: ['PRO'] });
      }
    });
  });
});
