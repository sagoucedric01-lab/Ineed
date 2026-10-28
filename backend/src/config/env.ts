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
    SWAGGER_ENABLED: bool.optional(),

    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),

    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default('eu-west-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_FORCE_PATH_STYLE: bool.default(false),
    S3_BUCKET_PUBLIC: z.string().min(3),
    S3_BUCKET_PRIVATE: z.string().min(3),

    /** Fournisseur des codes SMS (phase 4). `dev_console` écrit le code dans les journaux : interdit en production. */
    OTP_PROVIDER: z.enum(['dev_console', 'twilio_verify', 'orange_sms']).default('dev_console'),
    /** Fournisseur de paiement (phase 7). `sandbox` simule les paiements : interdit en production. */
    PAYMENT_PROVIDER: z.enum(['sandbox', 'cinetpay', 'wave']).default('sandbox'),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;
    const forbid = (path: keyof typeof env, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
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
