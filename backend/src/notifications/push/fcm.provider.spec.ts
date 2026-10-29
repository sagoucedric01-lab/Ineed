import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FcmPushProvider, parseServiceAccount } from './fcm.provider.js';

/** Tests de contrat sur le format documenté de l'API FCM HTTP v1 (aucun projet Firebase réel). */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { project_id: 'ineed-test', client_email: 'push@ineed-test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
const msg = { title: 'Paiement confirmé', body: 'Mission IN-2026-000001', data: { missionId: 'm1' } };

function fake(responses: Record<string, { status: number; body: unknown }[]>, calls: { url: string; init: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const key = url.includes('oauth2') ? 'token' : 'send';
    const r = responses[key]!.length > 1 ? responses[key]!.shift()! : responses[key]![0]!;
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
}

describe('FCM HTTP v1 (contrat)', () => {
  it('assertion JWT RS256 signée par le compte de service, avec la portée firebase.messaging', () => {
    const p = new FcmPushProvider(sa, fetch, () => 1_800_000_000_000);
    const [h, c, s] = p.assertion().split('.');
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: 1_800_000_000, exp: 1_800_003_600 });
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(s!, 'base64url'))).toBe(true);
  });

  it('envoi : jeton d’accès mis en cache, message au format v1 (notification, data, priorité Android)', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const p = new FcmPushProvider(sa, fake({ token: [{ status: 200, body: { access_token: 'ya29.x', expires_in: 3600 } }], send: [{ status: 200, body: { name: 'projects/ineed-test/messages/1' } }] }, calls));
    expect(await p.send('tok-1', msg)).toEqual({ status: 'SENT' });
    expect(await p.send('tok-2', msg)).toEqual({ status: 'SENT' });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const send = calls.find((c) => c.url.includes('messages:send'))!;
    expect(send.url).toBe('https://fcm.googleapis.com/v1/projects/ineed-test/messages:send');
    expect((send.init.headers as Record<string, string>).authorization).toBe('Bearer ya29.x');
    expect(JSON.parse(send.init.body as string)).toMatchObject({ message: { token: 'tok-1', notification: { title: 'Paiement confirmé' }, data: { missionId: 'm1' }, android: { priority: 'HIGH' } } });
  });

  it('jeton d’appareil désinscrit ou invalide : désactivation, sans nouvel essai', async () => {
    const unregistered = new FcmPushProvider(sa, fake({ token: [{ status: 200, body: { access_token: 'a', expires_in: 3600 } }], send: [{ status: 404, body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } } }] }));
    expect(await unregistered.send('old', msg)).toEqual({ status: 'INVALID_TOKEN' });
    const invalid = new FcmPushProvider(sa, fake({ token: [{ status: 200, body: { access_token: 'a', expires_in: 3600 } }], send: [{ status: 400, body: { error: { status: 'INVALID_ARGUMENT' } } }] }));
    expect(await invalid.send('bad', msg)).toEqual({ status: 'INVALID_TOKEN' });
  });

  it('erreurs passagères (quota, panne, réseau) : nouvel essai demandé ; jeton d’accès expiré renouvelé une fois', async () => {
    const quota = new FcmPushProvider(sa, fake({ token: [{ status: 200, body: { access_token: 'a', expires_in: 3600 } }], send: [{ status: 429, body: { error: { status: 'RESOURCE_EXHAUSTED' } } }] }));
    expect(await quota.send('t', msg)).toMatchObject({ status: 'RETRY' });
    const down = new FcmPushProvider(sa, async () => Promise.reject(new TypeError('fetch failed')));
    expect(await down.send('t', msg)).toEqual({ status: 'RETRY', error: 'fetch failed' });
    const calls: { url: string; init: RequestInit }[] = [];
    const renewed = new FcmPushProvider(sa, fake({ token: [{ status: 200, body: { access_token: 'old', expires_in: 3600 } }, { status: 200, body: { access_token: 'new', expires_in: 3600 } }], send: [{ status: 401, body: {} }, { status: 200, body: {} }] }, calls));
    expect(await renewed.send('t', msg)).toEqual({ status: 'SENT' });
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(2);
  });

  it('compte de service incomplet : erreur explicite au démarrage', () => {
    expect(() => parseServiceAccount(Buffer.from('{"project_id":"x"}').toString('base64'))).toThrow(/private_key/);
    expect(() => parseServiceAccount('pas du json')).toThrow(/illisible/);
    expect(parseServiceAccount(Buffer.from(JSON.stringify(sa)).toString('base64')).project_id).toBe('ineed-test');
  });
});
