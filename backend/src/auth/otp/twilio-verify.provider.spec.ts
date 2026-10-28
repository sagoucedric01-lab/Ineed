import { describe, expect, it } from 'vitest';
import type { AppError } from '../../common/http/api-error.js';
import { TwilioVerifyOtpProvider } from './twilio-verify.provider.js';

interface Call { url: string; init: RequestInit }

function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift()!;
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const config = { accountSid: 'AC123', authToken: 'secret', serviceSid: 'VA456' };

describe('TwilioVerifyOtpProvider (contrat de l’API Twilio Verify v2)', () => {
  it('envoie la vérification par SMS en français avec authentification Basic', async () => {
    const f = fakeFetch([{ status: 201, body: { sid: 'VE789', status: 'pending' } }]);
    const p = new TwilioVerifyOtpProvider(config, f.impl);
    expect(await p.start('+2250712345678')).toEqual({ providerRef: 'VE789' });
    expect(f.calls[0]!.url).toBe('https://verify.twilio.com/v2/Services/VA456/Verifications');
    const body = f.calls[0]!.init.body as URLSearchParams;
    expect(Object.fromEntries(body)).toEqual({ To: '+2250712345678', Channel: 'sms', Locale: 'fr' });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('AC123:secret').toString('base64')}`);
  });

  it('valide le code seulement si Twilio répond « approved »', async () => {
    const f = fakeFetch([{ status: 200, body: { status: 'approved' } }, { status: 200, body: { status: 'pending' } }, { status: 404, body: { code: 20404 } }]);
    const p = new TwilioVerifyOtpProvider(config, f.impl);
    expect(await p.check('+2250712345678', '123456')).toBe(true);
    expect(await p.check('+2250712345678', '000000')).toBe(false);
    expect(await p.check('+2250712345678', '123456')).toBe(false); // vérification expirée ou déjà utilisée
    expect(f.calls[0]!.url).toBe('https://verify.twilio.com/v2/Services/VA456/VerificationCheck');
  });

  it('transforme une panne du fournisseur en erreur 503 explicite', async () => {
    const f = fakeFetch([{ status: 500, body: {} }]);
    const p = new TwilioVerifyOtpProvider(config, f.impl);
    await expect(p.start('+2250712345678')).rejects.toMatchObject({ status: 503, code: 'SMS_PROVIDER_UNAVAILABLE' } satisfies Partial<AppError>);
  });
});
