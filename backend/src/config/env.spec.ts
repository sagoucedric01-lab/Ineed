import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv } from './env.js';

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  REDIS_URL: 'redis://localhost:6379',
  S3_ACCESS_KEY_ID: 'k',
  S3_SECRET_ACCESS_KEY: 's',
  S3_BUCKET_PUBLIC: 'ineed-public',
  S3_BUCKET_PRIVATE: 'ineed-private',
  JWT_PRIVATE_KEY_B64: 'x'.repeat(120),
  DATA_ENCRYPTION_KEY_B64: Buffer.alloc(32, 1).toString('base64'),
  OTP_PEPPER: 'p'.repeat(40),
};
const prod = {
  ...base, APP_ENV: 'production', NODE_ENV: 'production', PAYMENT_PROVIDER: 'cinetpay',
  OTP_PROVIDER: 'twilio_verify', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_VERIFY_SERVICE_SID: 'VA1',
  PUSH_PROVIDER: 'fcm', FCM_SERVICE_ACCOUNT_B64: 'e30=',
  CINETPAY_API_KEY: 'k', CINETPAY_SITE_ID: '1', CINETPAY_SECRET_KEY: 's', PUBLIC_API_URL: 'https://api.ineed.test', PAYMENT_RETURN_URL: 'https://ineed.test/retour',
};

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

  it('exige les identifiants Twilio quand twilio_verify est choisi, quel que soit l’environnement', () => {
    expect(() => loadEnv({ ...base, OTP_PROVIDER: 'twilio_verify' })).toThrow(/TWILIO_ACCOUNT_SID/);
  });

  it('refuse une clé de chiffrement qui ne fait pas 32 octets', () => {
    expect(() => loadEnv({ ...base, DATA_ENCRYPTION_KEY_B64: Buffer.alloc(16).toString('base64') })).toThrow(/DATA_ENCRYPTION_KEY_B64/);
  });

  it('autorise les simulateurs hors production', () => {
    expect(() => loadEnv({ ...base, APP_ENV: 'staging', PAYMENT_PROVIDER: 'sandbox' })).not.toThrow();
  });

  it('CinetPay exige ses clés et les adresses de notification et de retour', () => {
    const missing: Record<string, string> = { ...prod };
    delete missing.CINETPAY_SECRET_KEY;
    delete missing.PUBLIC_API_URL;
    try {
      loadEnv(missing);
      expect.unreachable();
    } catch (e) {
      const text = (e as EnvValidationError).issues.join('\n');
      expect(text).toContain('CINETPAY_SECRET_KEY');
      expect(text).toContain('PUBLIC_API_URL');
    }
  });

  it('refuse une adresse publique non chiffrée en production et l’adaptateur Wave non livré', () => {
    expect(() => loadEnv({ ...prod, PUBLIC_API_URL: 'http://api.ineed.test' })).toThrow(/https/);
    expect(() => loadEnv({ ...base, PAYMENT_PROVIDER: 'wave' })).toThrow(/Wave/);
  });

  it('notifications push : le mode développement est refusé en production, FCM exige son compte de service', () => {
    expect(() => loadEnv({ ...prod, PUSH_PROVIDER: 'dev_log' })).toThrow(/dev_log/);
    const noKey: Record<string, string> = { ...prod };
    delete noKey.FCM_SERVICE_ACCOUNT_B64;
    expect(() => loadEnv(noKey)).toThrow(/FCM_SERVICE_ACCOUNT_B64/);
  });
});
