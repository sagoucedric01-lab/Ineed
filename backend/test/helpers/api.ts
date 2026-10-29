import type { INestApplication } from '@nestjs/common';
import { Redis } from 'ioredis';
import request from 'supertest';
import { hashPassword } from '../../src/admin-auth/passwords.js';
import { type DevConsoleOtpProvider } from '../../src/auth/otp/dev-console.provider.js';
import { OTP_PROVIDER } from '../../src/auth/otp/otp-provider.js';
import { createApp } from '../../src/bootstrap.js';
import { SecretBox } from '../../src/common/crypto/secret-box.js';
import { generateTotpSecret, totp } from '../../src/common/crypto/totp.js';
import { Prisma, type PrismaClient } from '../../src/generated/prisma/client.js';
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
  purpose: 'AVATAR' | 'VERIFICATION_DOC' | 'REQUEST_PHOTO' | 'REQUEST_VOICE',
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

export interface TestProOptions {
  phone: string;
  businessName: string;
  categorySlugs: string[];
  /** Point de départ habituel. */
  base?: { lat: number; lng: number };
  /** Position du moment (envoyée il y a `liveMinutesAgo` minutes, 1 par défaut). */
  live?: { lat: number; lng: number };
  liveMinutesAgo?: number;
  online?: boolean;
  zoneNames?: string[];
  /** Jours travaillés (1 = lundi), de 08:00 à 18:00. */
  weekdays?: number[];
  status?: 'APPROVED' | 'SUBMITTED' | 'SUSPENDED';
  pausedUntil?: Date;
  radiusM?: number;
  urgent?: boolean;
}

/**
 * Professionnel créé directement en base, pour préparer une recherche (le parcours réel d'inscription
 * et de validation est couvert par pro-onboarding.int.spec.ts).
 */
export async function createTestPro(ctx: TestContext, o: TestProOptions): Promise<{ userId: string; tokens: Tokens }> {
  // Compteurs de limitation vidés : la préparation crée de nombreux comptes depuis la même adresse IP.
  await flushRedis();
  const login = await loginWithPhone(ctx, o.phone, 'PRO');
  const city = await ctx.prisma.city.findFirstOrThrow({ where: { isActive: true } });
  const status = o.status ?? 'APPROVED';
  const verifiedAt = status === 'SUBMITTED' ? null : new Date();
  const pt = (p?: { lat: number; lng: number }) => (p ? Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography` : Prisma.sql`NULL`);
  await ctx.prisma.$executeRaw`
    INSERT INTO pro_profiles (user_id, business_name, city_id, verification_status, verified_at, is_online, paused_until,
                              base_location, last_location, last_location_at, service_radius_m)
    VALUES (${login.userId}::uuid, ${o.businessName}, ${city.id}::uuid, ${status}::verification_status, ${verifiedAt},
            ${o.online ?? false}, ${o.pausedUntil ?? null}, ${pt(o.base)}, ${pt(o.live)},
            ${o.live ? new Date(Date.now() - (o.liveMinutesAgo ?? 1) * 60_000) : null}, ${o.radiusM ?? 20_000})`;
  for (const slug of o.categorySlugs) {
    const c = await ctx.prisma.category.findUniqueOrThrow({ where: { slug } });
    await ctx.prisma.proCategory.create({ data: { proId: login.userId, categoryId: c.id, acceptsUrgent: o.urgent ?? true } });
  }
  for (const name of o.zoneNames ?? []) {
    const z = await ctx.prisma.zone.findFirstOrThrow({ where: { name, parentId: null } });
    await ctx.prisma.proServiceZone.create({ data: { proId: login.userId, zoneId: z.id } });
  }
  for (const weekday of o.weekdays ?? []) {
    await ctx.prisma.proWeeklyHour.create({
      data: { proId: login.userId, weekday, startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z') },
    });
  }
  return { userId: login.userId, tokens: login.tokens };
}

/**
 * Arrête puis relance l'API sur la même base (simulation d'un redémarrage ou d'une panne du serveur) :
 * rien n'est conservé en mémoire, seul l'état en base subsiste.
 */
export async function restartApi(ctx: TestContext): Promise<void> {
  await ctx.app.close();
  const app = await createApp();
  app.useLogger(false);
  await app.listen(0, '127.0.0.1');
  ctx.app = app;
  ctx.http = request(await app.getUrl());
  ctx.otp = app.get<DevConsoleOtpProvider>(OTP_PROVIDER);
}

export const DEFAULT_QUOTE_LINES = [
  { kind: 'TRAVEL' as const, label: 'Déplacement', unitPriceXof: 2000 },
  { kind: 'LABOR' as const, label: 'Main-d’œuvre', unitPriceXof: 13000 },
];

/**
 * Parcours de paiement réel avec le simulateur (PAYMENT_PROVIDER=sandbox) : devis du professionnel accepté par
 * le client si la mission en attend un, création du paiement, issue choisie sur la page simulée, notification
 * signée, vérification serveur. Renvoie l'identifiant du paiement.
 */
export async function payWithSandbox(
  ctx: TestContext,
  missionId: string,
  o: { outcome?: 'SUCCEEDED' | 'FAILED' | 'CANCELLED'; lines?: { kind: 'TRAVEL' | 'LABOR' | 'MATERIAL' | 'OTHER'; label: string; unitPriceXof: number; quantity?: number }[] } = {},
): Promise<string> {
  const { QuotesService } = await import('../../src/quotes/quotes.service.js');
  const { PaymentsService } = await import('../../src/payments/payments.service.js');
  const quotes = ctx.app.get(QuotesService);
  const payments = ctx.app.get(PaymentsService);
  const m = await ctx.prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
  if (m.status === 'AWAITING_QUOTE') {
    const q = await quotes.submit(m.proId, missionId, { lines: o.lines ?? DEFAULT_QUOTE_LINES });
    await quotes.accept(m.clientId, missionId, q.id);
  }
  const p = await payments.initiate(m.clientId, missionId, `test-${missionId}-${Date.now()}`);
  const ref = p.checkoutUrl!.split('/').pop()!;
  await ctx.http.post(`/v1/payments/sandbox/checkout/${ref}`).type('form').send({ outcome: o.outcome ?? 'SUCCEEDED', method: 'ORANGE_MONEY' }).expect(200);
  return p.id;
}
