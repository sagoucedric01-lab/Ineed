// Exporte la description OpenAPI dans docs/api/openapi.json (sans démarrer le serveur ni se connecter aux services).
import 'reflect-metadata';
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module.js';
import { buildOpenApiDocument } from '../swagger.js';

const placeholders: Record<string, string> = {
  DATABASE_URL: 'postgresql://export@localhost/export',
  REDIS_URL: 'redis://localhost:6379',
  S3_ACCESS_KEY_ID: 'export',
  S3_SECRET_ACCESS_KEY: 'export',
  S3_BUCKET_PUBLIC: 'export-public',
  S3_BUCKET_PRIVATE: 'export-private',
  // Secrets éphémères : l'export ne signe ni ne chiffre rien.
  JWT_PRIVATE_KEY_B64: generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
  DATA_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
  OTP_PEPPER: randomBytes(32).toString('base64url'),
};
for (const [k, v] of Object.entries(placeholders)) process.env[k] ??= v;

const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
const doc = buildOpenApiDocument(app);
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/api/openapi.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
await app.close();
console.log(`OpenAPI écrit : ${out} (${Object.keys(doc.paths).length} chemins)`);
