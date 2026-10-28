import { generateKeyPairSync, randomBytes } from 'node:crypto';

/**
 * Configuration des tests d'intégration. Les services doivent tourner (voir infra/docker-compose.yml ou la CI).
 * Chaque fichier de test crée sa propre base PostgreSQL éphémère à partir de TEST_DATABASE_ADMIN_URL.
 */
export const testServices = {
  adminUrl: process.env.TEST_DATABASE_ADMIN_URL ?? 'postgresql://ineed:ineed@localhost:5432/postgres',
  redisUrl: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
  s3: {
    S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? 'http://localhost:8333',
    S3_REGION: 'eu-west-1',
    S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? 'ineed-dev-access',
    S3_SECRET_ACCESS_KEY: process.env.TEST_S3_SECRET_ACCESS_KEY ?? 'ineed-dev-secret-change-me',
    S3_FORCE_PATH_STYLE: 'true',
    S3_BUCKET_PUBLIC: process.env.TEST_S3_BUCKET_PUBLIC ?? 'ineed-public',
    S3_BUCKET_PRIVATE: process.env.TEST_S3_BUCKET_PRIVATE ?? 'ineed-private',
  },
};

/** Secrets générés une fois par fichier de test (jamais réutilisés ailleurs). */
const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
export const testSecrets = {
  JWT_PRIVATE_KEY_B64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  DATA_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
  OTP_PEPPER: randomBytes(32).toString('base64url'),
};

/** Variables complètes pour démarrer l'API sur une base donnée. */
export function apiEnv(databaseUrl: string, overrides: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'warn',
    DATABASE_URL: databaseUrl,
    REDIS_URL: testServices.redisUrl,
    ...testServices.s3,
    ...testSecrets,
    ...overrides,
  };
}

/** Surcharges minimales d'une configuration de production valide (fournisseurs réels fictifs). */
export const productionOverrides = {
  APP_ENV: 'production',
  NODE_ENV: 'production',
  OTP_PROVIDER: 'twilio_verify',
  TWILIO_ACCOUNT_SID: 'ACtest',
  TWILIO_AUTH_TOKEN: 'test',
  TWILIO_VERIFY_SERVICE_SID: 'VAtest',
  PAYMENT_PROVIDER: 'cinetpay',
};
