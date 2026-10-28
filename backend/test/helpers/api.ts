import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { hashPassword } from '../../src/admin-auth/passwords.js';
import { type DevConsoleOtpProvider } from '../../src/auth/otp/dev-console.provider.js';
import { OTP_PROVIDER } from '../../src/auth/otp/otp-provider.js';
import { createApp } from '../../src/bootstrap.js';
import { SecretBox } from '../../src/common/crypto/secret-box.js';
import { generateTotpSecret, totp } from '../../src/common/crypto/totp.js';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedReference } from '../../prisma/seed/reference.js';
import { createTestDatabase, migrate, prismaFor, type TestDatabase } from './db.js';
import { apiEnv, testSecrets, testServices } from './env.js';

export interface TestContext {
  db: TestDatabase;
  prisma: PrismaClient;
  app: INestApplication;
  http: ReturnType<typeof request>;
  otp: DevConsoleOtpProvider;
  close(): Promise<void>;
}

/** Base neuve + migrations + référentiel + API démarrée (Redis de test vidé). */
export async function startTestContext(overrides: Record<string, string> = {}): Promise<TestContext> {
  const db = await createTestDatabase();
  await migrate(db.url);
  const prisma = prismaFor(db.url);
  await seedReference(prisma);
  await flushRedis();
  Object.assign(process.env, apiEnv(db.url, overrides));
  const app = await createApp();
  app.useLogger(false);
  // Vrai port d'écoute : évite l'ouverture/fermeture d'un serveur éphémère à chaque requête.
  await app.listen(0, '127.0.0.1');
  const otp = app.get<DevConsoleOtpProvider>(OTP_PROVIDER);
  return {
    db,
    prisma,
    app,
    http: request(await app.getUrl()),
    otp,
    async close() {
      await app.close();
      await prisma.$disconnect();
      await db.drop();
    },
  };
}

export async function flushRedis(): Promise<void> {
  const r = new Redis(testServices.redisUrl);
  await r.flushdb();
  r.disconnect();
}

export interface Tokens {
  accessToken: string;
  refreshToken: string;
}

export interface LoginOutcome {
  tokens: Tokens;
  userId: string;
  isNewUser: boolean;
}

/** Connexion complète par code SMS (code lu dans le fournisseur de développement). */
export async function loginWithPhone(ctx: TestContext, phone: string, app: 'CLIENT' | 'PRO' = 'CLIENT'): Promise<LoginOutcome> {
  const req = await ctx.http.post('/v1/auth/otp/request').send({ phone }).expect(202);
  const e164 = await ctx.prisma.otpChallenge.findUniqueOrThrow({ where: { id: req.body.challengeId } });
  const code = ctx.otp.lastCodes.get(e164.phoneE164)!;
  const res = await ctx.http.post('/v1/auth/otp/verify').send({ challengeId: req.body.challengeId, code, app }).expect(200);
  return { tokens: res.body.tokens, userId: res.body.user.id, isNewUser: res.body.isNewUser };
}

/** Le délai minimal entre deux codes est contourné en vieillissant les défis existants. */
export async function ageChallenges(ctx: TestContext, phoneE164: string, seconds = 3600): Promise<void> {
  await ctx.prisma.$executeRaw`UPDATE otp_challenges SET created_at = created_at - make_interval(secs => ${seconds}) WHERE phone_e164 = ${phoneE164}`;
}

export const bearer = (t: { accessToken: string }) => ({ authorization: `Bearer ${t.accessToken}` });

export interface TestAdmin {
  email: string;
  password: string;
  totpSecret: string;
  userId: string;
}

/** Administrateur de test, double authentification déjà activée. */
export async function createAdmin(ctx: TestContext, roleCode: string, email: string): Promise<TestAdmin> {
  const password = 'Mot2passe-de-test-solide';
  const totpSecret = generateTotpSecret();
  const box = new SecretBox(testSecrets.DATA_ENCRYPTION_KEY_B64);
  const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: roleCode } });
  const user = await ctx.prisma.user.create({ data: { email, firstName: 'Admin', lastName: roleCode } });
  await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
  await ctx.prisma.adminCredential.create({
    data: { userId: user.id, passwordHash: await hashPassword(password), totpSecretEnc: box.seal(totpSecret), totpEnabledAt: new Date() },
  });
  return { email, password, totpSecret, userId: user.id };
}

/** Connexion administrateur complète (mot de passe puis code TOTP). `at` permet d'éviter le rejeu d'un même code. */
export async function adminLogin(ctx: TestContext, admin: TestAdmin, at = Date.now()): Promise<Tokens> {
  const step1 = await ctx.http.post('/v1/admin/auth/login').send({ email: admin.email, password: admin.password }).expect(200);
  const step2 = await ctx.http.post('/v1/admin/auth/totp').send({ mfaToken: step1.body.mfaToken, code: totp(admin.totpSecret, at) }).expect(200);
  return step2.body;
}

/** Envoi réel d'un fichier : URL présignée, PUT vers le stockage, puis finalisation. */
export async function uploadFile(
  ctx: TestContext,
  tokens: Tokens,
  purpose: 'AVATAR' | 'VERIFICATION_DOC',
  body: Buffer,
  mimeType: string,
  expectStatus = 200,
): Promise<{ fileId: string; complete: request.Response }> {
  const ticket = await ctx.http.post('/v1/files').set(bearer(tokens)).send({ purpose, mimeType, sizeBytes: body.length }).expect(201);
  const put = await fetch(ticket.body.uploadUrl, { method: 'PUT', headers: ticket.body.headers, body: new Uint8Array(body) });
  if (!put.ok) throw new Error(`Envoi vers le stockage refusé : HTTP ${put.status} ${await put.text()}`);
  const complete = await ctx.http.post(`/v1/files/${ticket.body.fileId}/complete`).set(bearer(tokens)).expect(expectStatus);
  return { fileId: ticket.body.fileId, complete };
}

/** PDF minimal valide (signature %PDF). */
export const TINY_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);
