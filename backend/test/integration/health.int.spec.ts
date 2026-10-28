import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/bootstrap.js';
import { createTestDatabase, migrate, type TestDatabase } from '../helpers/db.js';
import { apiEnv } from '../helpers/env.js';

/** Démarre l'API avec une configuration donnée (process.env est restauré après chaque test). */
async function startApi(env: Record<string, string>): Promise<INestApplication> {
  Object.assign(process.env, env);
  const app = await createApp();
  app.useLogger(false);
  await app.init();
  return app;
}

describe('API : santé et format des erreurs', () => {
  let db: TestDatabase;
  let app: INestApplication | undefined;
  const saved = { ...process.env };

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.url);
  });
  afterEach(async () => {
    await app?.close();
    app = undefined;
    process.env = { ...saved };
  });
  afterAll(async () => {
    await db?.drop();
  });

  it('GET /health/live répond 200', async () => {
    app = await startApi(apiEnv(db.url));
    await request(app.getHttpServer()).get('/health/live').expect(200, { status: 'ok' });
  });

  it('GET /health/ready répond 200 quand base, Redis et stockage répondent', async () => {
    app = await startApi(apiEnv(db.url));
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toMatchObject({ status: 'ok' });
    expect(res.body.checks.database.detail).toMatch(/^PostGIS 3\./);
    expect(res.body.checks.redis.status).toBe('ok');
    expect(res.body.checks.storage.status).toBe('ok');
  });

  it('GET /health/ready répond 503 et nomme la dépendance en panne (Redis injoignable)', async () => {
    app = await startApi(apiEnv(db.url, { REDIS_URL: 'redis://127.0.0.1:6' }));
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.status).toBe('error');
    expect(res.body.checks.redis.status).toBe('error');
    expect(res.body.checks.database.status).toBe('ok');
    expect(res.body.worker.status).toBe('unknown');
  });

  it('GET /health/ready répond 503 si un bucket est introuvable', async () => {
    app = await startApi(apiEnv(db.url, { S3_BUCKET_PRIVATE: 'ineed-bucket-inexistant' }));
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.checks.storage.status).toBe('error');
  });

  it('GET /health/ready répond 503 si la base est injoignable, sans attendre indéfiniment', async () => {
    app = await startApi(apiEnv('postgresql://ineed:ineed@127.0.0.1:6/inexistante'));
    const started = Date.now();
    const res = await request(app.getHttpServer()).get('/health/ready').expect(503);
    expect(res.body.checks.database.status).toBe('error');
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it('les erreurs suivent le format { error: { code, message, requestId } } en français', async () => {
    app = await startApi(apiEnv(db.url));
    const res = await request(app.getHttpServer()).get('/route-inexistante').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toBe('Cet élément n’existe plus ou a été supprimé.');
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
  });

  it('reprend un identifiant de requête valide et remplace un identifiant invalide', async () => {
    app = await startApi(apiEnv(db.url));
    const ok = await request(app.getHttpServer()).get('/health/live').set('x-request-id', 'proxy-abc-12345678');
    expect(ok.headers['x-request-id']).toBe('proxy-abc-12345678');
    const bad = await request(app.getHttpServer()).get('/health/live').set('x-request-id', '<script>');
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sert la documentation OpenAPI hors production', async () => {
    app = await startApi(apiEnv(db.url));
    const res = await request(app.getHttpServer()).get('/docs/openapi.json').expect(200);
    expect(res.body.paths).toHaveProperty('/health/ready');
  });

  it('ne sert pas la documentation en production (sauf demande explicite)', async () => {
    app = await startApi(apiEnv(db.url, { APP_ENV: 'production', NODE_ENV: 'production', OTP_PROVIDER: 'twilio_verify', PAYMENT_PROVIDER: 'cinetpay' }));
    await request(app.getHttpServer()).get('/docs/openapi.json').expect(404);
  });

  it('ajoute les en-têtes de sécurité HTTP', async () => {
    app = await startApi(apiEnv(db.url));
    const res = await request(app.getHttpServer()).get('/health/live');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });
});
