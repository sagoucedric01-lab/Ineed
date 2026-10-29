import { describe, expect, it } from 'vitest';
import type { Env } from '../config/env.js';
import type { RedisService } from '../infra/redis.service.js';
import { paymentProviderFactory } from './billing.module.js';
import { CinetPayProvider } from './providers/cinetpay.provider.js';
import { SandboxPaymentProvider } from './providers/sandbox.provider.js';

const redis = { client: {} } as unknown as RedisService;
const env = (over: Partial<Env>) => ({ APP_ENV: 'local', PAYMENT_PROVIDER: 'sandbox', DATA_ENCRYPTION_KEY_B64: Buffer.alloc(32, 1).toString('base64'), CINETPAY_API_URL: 'https://x', ...over }) as Env;

describe('choix du prestataire de paiement', () => {
  it('le simulateur ne peut pas être construit en production, même si la validation de la configuration était contournée', () => {
    expect(() => paymentProviderFactory(env({ APP_ENV: 'production' }), redis)).toThrow(/interdit en production/);
  });

  it('simulateur hors production, marqué comme tel ; CinetPay sinon', () => {
    const s = paymentProviderFactory(env({ APP_ENV: 'staging' }), redis);
    expect(s).toBeInstanceOf(SandboxPaymentProvider);
    expect(s.isSandbox).toBe(true);
    const c = paymentProviderFactory(env({ APP_ENV: 'production', PAYMENT_PROVIDER: 'cinetpay', CINETPAY_API_KEY: 'k', CINETPAY_SITE_ID: '1', CINETPAY_SECRET_KEY: 's' }), redis);
    expect(c).toBeInstanceOf(CinetPayProvider);
    expect(c.isSandbox).toBe(false);
  });
});
