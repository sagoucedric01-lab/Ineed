import { z } from 'zod';

/**
 * Variables d'environnement de l'API et du worker.
 * Toute la configuration passe par ce schéma : une valeur absente ou invalide empêche le démarrage,
 * avec un message qui indique la variable fautive.
 */
const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .transform((v) => v.split(',').map((s) => s.trim()).filter(Boolean));

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Environnement métier : détermine les garde-fous (production = aucun simulateur autorisé). */
    APP_ENV: z.enum(['local', 'test', 'staging', 'production']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    CORS_ORIGINS: csv.default([]),
    /** Nombre de reverse proxys devant l'API (0 en local, 1 derrière Caddy/Traefik). */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    SWAGGER_ENABLED: bool.optional(),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    S3_ENDPOINT: z.url().optional(),
    /** Adresse du stockage vue par les applications (URL présignées) si différente de S3_ENDPOINT (ex. émulateur Android : http://10.0.2.2:8333). */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('eu-west-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_BUCKET_PUBLIC: z.string().min(3),
    S3_BUCKET_PRIVATE: z.string().min(3),

    /** Fournisseur des codes SMS. `dev_console` écrit le code dans les journaux : interdit en production. */
    OTP_PROVIDER: z.enum(['dev_console', 'twilio_verify']).default('dev_console'),
    /** Secret servant à hacher les codes SMS en base (HMAC). Au moins 32 caractères. */
    OTP_PEPPER: z.string().min(32),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_VERIFY_SERVICE_SID: z.string().optional(),

    /** Clé privée ECDSA P-256 (PKCS#8 DER encodé en base64) qui signe les jetons d'accès. */
    JWT_PRIVATE_KEY_B64: z.string().min(100),
    JWT_ISSUER: z.string().default('ineed-api'),
    ACCESS_TOKEN_TTL_S: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(60),
    ADMIN_REFRESH_TOKEN_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    /** Clé AES-256 (32 octets en base64) qui chiffre les secrets stockés en base (TOTP, numéros de reversement). */
    DATA_ENCRYPTION_KEY_B64: z.string().refine((v) => Buffer.from(v, 'base64').length === 32, 'doit contenir 32 octets encodés en base64'),
    /** Fournisseur de paiement (phase 7). `sandbox` simule les paiements : interdit en production. */
    PAYMENT_PROVIDER: z.enum(['sandbox', 'cinetpay', 'wave']).default('sandbox'),
  })
  .superRefine((env, ctx) => {
    const forbid = (path: keyof typeof env, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (env.OTP_PROVIDER === 'twilio_verify' && !(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_VERIFY_SERVICE_SID)) {
      forbid('OTP_PROVIDER', 'twilio_verify exige TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_VERIFY_SERVICE_SID');
    }
    if (env.APP_ENV !== 'production') return;
    if (env.NODE_ENV !== 'production') forbid('NODE_ENV', 'doit valoir "production" quand APP_ENV=production');
    if (env.OTP_PROVIDER === 'dev_console') forbid('OTP_PROVIDER', 'le mode "dev_console" est interdit en production');
    if (env.PAYMENT_PROVIDER === 'sandbox') forbid('PAYMENT_PROVIDER', 'le simulateur "sandbox" est interdit en production');
    if (env.S3_BUCKET_PUBLIC === env.S3_BUCKET_PRIVATE) {
      forbid('S3_BUCKET_PRIVATE', 'les documents privés doivent être dans un bucket distinct du bucket public');
    }
  })
  .transform((env) => ({
    ...env,
    // Swagger est servi par défaut hors production, et seulement sur demande explicite en production.
    SWAGGER_ENABLED: env.SWAGGER_ENABLED ?? env.APP_ENV !== 'production',
  }));

export type Env = z.output<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Configuration invalide :\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Valide la configuration ; lève une EnvValidationError lisible si elle est incorrecte. */
export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(result.error.issues.map((i) => `${i.path.join('.') || '(racine)'} : ${i.message}`));
  }
  return result.data;
}

/** Jeton d'injection NestJS de la configuration validée. */
export const ENV = Symbol('ENV');
