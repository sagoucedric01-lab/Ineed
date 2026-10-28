import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  S3_BUCKET_PUBLIC: 'ineed-public',
  S3_BUCKET_PRIVATE: 'ineed-private',
};
const prod = { ...base, APP_ENV: 'production', NODE_ENV: 'production', OTP_PROVIDER: 'twilio_verify', PAYMENT_PROVIDER: 'cinetpay' };

describe('loadEnv', () => {
  it('applique les valeurs par défaut de développement', () => {
    const env = loadEnv(base);
    expect(env.APP_ENV).toBe('local');
    expect(env.PORT).toBe(3000);
    expect(env.OTP_PROVIDER).toBe('dev_console');
    expect(env.SWAGGER_ENABLED).toBe(true);
  });

  it('nomme chaque variable manquante ou invalide', () => {
    try {
      loadEnv({ ...base, DATABASE_URL: 'mysql://x', REDIS_URL: undefined });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const issues = (e as EnvValidationError).issues.join('\n');
      expect(issues).toContain('DATABASE_URL');
      expect(issues).toContain('REDIS_URL');
    }
  });

  it('accepte une configuration de production complète et masque Swagger par défaut', () => {
    const env = loadEnv(prod);
    expect(env.APP_ENV).toBe('production');
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  it.each([
    ['OTP_PROVIDER', 'dev_console'],
    ['PAYMENT_PROVIDER', 'sandbox'],
    ['NODE_ENV', 'development'],
    ['S3_BUCKET_PRIVATE', 'ineed-public'],
  ])('refuse %s=%s en production', (key, value) => {
    expect(() => loadEnv({ ...prod, [key]: value })).toThrow(new RegExp(key));
  });

  it('autorise les simulateurs hors production', () => {
    expect(() => loadEnv({ ...base, APP_ENV: 'staging', PAYMENT_PROVIDER: 'sandbox' })).not.toThrow();
  });
});
