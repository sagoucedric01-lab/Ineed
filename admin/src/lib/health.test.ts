import { describe, expect, it } from 'vitest';
import { fetchPlatformStatus, type ReadinessReport } from './health';

const report: ReadinessReport = {
  status: 'error',
  checks: {
    database: { status: 'ok', latencyMs: 4, detail: 'PostGIS 3.5.2' },
    redis: { status: 'error', latencyMs: 2001, detail: 'délai dépassé (2000 ms)' },
    storage: { status: 'ok', latencyMs: 12 },
  },
  worker: { status: 'unknown' },
};

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('fetchPlatformStatus', () => {
  it('interroge /health/ready à partir de l’URL de l’API', async () => {
    let called = '';
    const spy: typeof fetch = async (input) => {
      called = String(input);
      return new Response(JSON.stringify({ ...report, status: 'ok' }), { status: 200 });
    };
    await fetchPlatformStatus('http://api.interne:3000', spy);
    expect(called).toBe('http://api.interne:3000/health/ready');
  });

  it('traite un 503 comme un rapport (dépendance en panne)', async () => {
    const r = await fetchPlatformStatus('http://api', respond(503, report));
    expect(r).toEqual({ kind: 'report', report });
  });

  it('signale une réponse inattendue', async () => {
    const r = await fetchPlatformStatus('http://api', respond(502, '<html>Bad gateway</html>'));
    expect(r).toEqual({ kind: 'unreachable', reason: 'Réponse inattendue de l’API (HTTP 502).' });
  });

  it('signale une API injoignable', async () => {
    const r = await fetchPlatformStatus('http://api', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    expect(r.kind).toBe('unreachable');
  });

  it('abandonne après le délai', async () => {
    const slow: typeof fetch = (_input, init) =>
      new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal?.reason)));
    const r = await fetchPlatformStatus('http://api', slow, 50);
    expect(r).toEqual({ kind: 'unreachable', reason: 'L’API n’a pas répondu en 0,05 s.' });
  });
});
