import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { totp } from '../../src/common/crypto/totp.js';
import { adminLogin, bearer, createAdmin, flushRedis, loginWithPhone, startTestContext, TINY_PDF, uploadFile, type TestAdmin, type TestContext, type Tokens } from '../helpers/api.js';
import { testServices } from '../helpers/env.js';

/** Photo JPEG portant des coordonnées GPS dans ses métadonnées EXIF. */
async function photoWithGps(): Promise<Buffer> {
  return sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 30, g: 90, b: 160 } } })
    .jpeg()
    .withExif({ IFD0: { Make: 'TestPhone', Model: 'Modèle 1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '5/1 22/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '3/1 58/1 0/1' } })
    .toBuffer();
}

const s3 = new S3Client({
  region: 'eu-west-1',
  endpoint: testServices.s3.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: { accessKeyId: testServices.s3.S3_ACCESS_KEY_ID, secretAccessKey: testServices.s3.S3_SECRET_ACCESS_KEY },
});

describe('Inscription professionnel et validation par l’administration', () => {
  let ctx: TestContext;
  let pro: Tokens;
  let proId: string;
  let ops: TestAdmin;
  let opsTokens: Tokens;
  const saved = { ...process.env };

  async function draftBody() {
    const cats = await ctx.http.get('/v1/catalog/categories').expect(200);
    const zones = await ctx.http.get('/v1/geo/zones').expect(200);
    const plomberie = cats.body.find((c: { slug: string }) => c.slug === 'plomberie');
    return {
      kind: 'INDIVIDUAL',
      businessName: 'Koffi Plomberie',
      bio: 'Plombier depuis 12 ans.',
      yearsExperience: 12,
      categoryIds: [plomberie.id],
      skillIds: [plomberie.skills[0].id],
      zoneIds: zones.body.filter((z: { name: string }) => ['Cocody', 'Bingerville'].includes(z.name)).map((z: { id: string }) => z.id),
      baseLocation: { lat: 5.37, lng: -3.985 },
      weeklyHours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: '08:00', end: '18:00' })),
    };
  }

  beforeAll(async () => {
    ctx = await startTestContext();
    ops = await createAdmin(ctx, 'ADMIN_OPS', 'ops@ineed.test');
    opsTokens = await adminLogin(ctx, ops);
    const login = await loginWithPhone(ctx, '07 55 55 55 01', 'PRO');
    pro = login.tokens;
    proId = login.userId;
  });
  afterAll(async () => {
    s3.destroy();
    await ctx?.close();
    process.env = { ...saved };
  });

  describe('fichiers', () => {
    it('ré-encode les photos et supprime les métadonnées (position GPS comprise)', async () => {
      const original = await photoWithGps();
      expect((await sharp(original).metadata()).exif).toBeDefined();
      const { fileId, complete } = await uploadFile(ctx, pro, 'AVATAR', original, 'image/jpeg');
      expect(complete.body.status).toBe('READY');
      const row = await ctx.prisma.file.findUniqueOrThrow({ where: { id: fileId } });
      const stored = Buffer.from(await (await s3.send(new GetObjectCommand({ Bucket: row.bucket, Key: row.objectKey }))).Body!.transformToByteArray());
      expect((await sharp(stored).metadata()).exif).toBeUndefined();
      expect(row.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('refuse un fichier dont le contenu ne correspond pas au type annoncé, et l’efface', async () => {
      const { fileId, complete } = await uploadFile(ctx, pro, 'AVATAR', Buffer.from('ceci n’est pas une image, malgré son type annoncé'), 'image/jpeg', 422);
      expect(complete.body.error.code).toBe('FILE_REJECTED');
      expect((await ctx.prisma.file.findUniqueOrThrow({ where: { id: fileId } })).status).toBe('REJECTED');
    });

    it('refuse un type non autorisé et une taille excessive dès la préparation', async () => {
      await ctx.http.post('/v1/files').set(bearer(pro)).send({ purpose: 'AVATAR', mimeType: 'application/pdf', sizeBytes: 1000 }).expect(422);
      await ctx.http.post('/v1/files').set(bearer(pro)).send({ purpose: 'AVATAR', mimeType: 'image/jpeg', sizeBytes: 11 * 1024 * 1024 }).expect(422);
    });

    it('un utilisateur ne peut pas finaliser ni utiliser le fichier d’un autre', async () => {
      const other = await loginWithPhone(ctx, '07 55 55 55 99');
      const { fileId } = await uploadFile(ctx, other.tokens, 'AVATAR', await photoWithGps(), 'image/jpeg');
      await ctx.http.post(`/v1/files/${fileId}/complete`).set(bearer(pro)).expect(404);
      await ctx.http.put('/v1/me/avatar').set(bearer(pro)).send({ fileId }).expect(404);
    });

    it('les justificatifs sont rangés dans le stockage privé', async () => {
      const { fileId } = await uploadFile(ctx, pro, 'VERIFICATION_DOC', TINY_PDF, 'application/pdf');
      const row = await ctx.prisma.file.findUniqueOrThrow({ where: { id: fileId } });
      expect(row).toMatchObject({ visibility: 'PRIVATE', bucket: testServices.s3.S3_BUCKET_PRIVATE, status: 'READY' });
    });
  });

  describe('T2 — inscription d’un professionnel', () => {
    it('aucun dossier au départ', async () => {
      const r = await ctx.http.get('/v1/pro/profile').set(bearer(pro)).expect(404);
      expect(r.body.error.code).toBe('PROFILE_NOT_STARTED');
    });

    it('enregistre le brouillon et liste ce qui manque', async () => {
      const r = await ctx.http.put('/v1/pro/profile').set(bearer(pro)).send(await draftBody()).expect(200);
      expect(r.body.verificationStatus).toBe('DRAFT');
      expect(r.body.missing).toEqual(['NAMES', 'PHOTO', 'DOCUMENT:PIECE_IDENTITE']);
      expect(r.body.canSubmit).toBe(false);
      expect(r.body.weeklyHours).toHaveLength(5);
    });

    it('refuse plus de 3 métiers, une commune inconnue et un point de départ hors zone', async () => {
      const body = await draftBody();
      const cats = (await ctx.http.get('/v1/catalog/categories')).body.map((c: { id: string }) => c.id);
      await ctx.http.put('/v1/pro/profile').set(bearer(pro)).send({ ...body, categoryIds: cats.slice(0, 4) }).expect(422);
      await ctx.http.put('/v1/pro/profile').set(bearer(pro)).send({ ...body, zoneIds: ['00000000-0000-4000-8000-000000000000'] }).expect(422);
      const far = await ctx.http.put('/v1/pro/profile').set(bearer(pro)).send({ ...body, baseLocation: { lat: 7.69, lng: -5.03 } }).expect(422);
      expect(far.body.error.code).toBe('LOCATION_OUTSIDE_CITY');
    });

    it('refuse la soumission d’un dossier incomplet en listant les manques', async () => {
      const r = await ctx.http.post('/v1/pro/profile/submit').set(bearer(pro)).expect(422);
      expect(r.body.error.code).toBe('PROFILE_INCOMPLETE');
      expect(r.body.error.details.missing).toContain('PHOTO');
    });

    it('soumet le dossier complet', async () => {
      await ctx.http.patch('/v1/me').set(bearer(pro)).send({ firstName: 'Koffi', lastName: 'Kouassi' }).expect(200);
      const avatar = await uploadFile(ctx, pro, 'AVATAR', await photoWithGps(), 'image/jpeg');
      await ctx.http.put('/v1/me/avatar').set(bearer(pro)).send({ fileId: avatar.fileId }).expect(200);
      const doc = await uploadFile(ctx, pro, 'VERIFICATION_DOC', TINY_PDF, 'application/pdf');
      const withDoc = await ctx.http.post('/v1/pro/documents').set(bearer(pro)).send({ typeCode: 'PIECE_IDENTITE', fileId: doc.fileId }).expect(201);
      expect(withDoc.body.missing).toEqual([]);
      const r = await ctx.http.post('/v1/pro/profile/submit').set(bearer(pro)).expect(200);
      expect(r.body.verificationStatus).toBe('SUBMITTED');
      const me = await ctx.http.get('/v1/me').set(bearer(pro)).expect(200);
      expect(me.body.proStatus).toBe('SUBMITTED');
    });

    it('le dossier soumis ne peut plus être modifié', async () => {
      const r = await ctx.http.put('/v1/pro/profile').set(bearer(pro)).send(await draftBody()).expect(409);
      expect(r.body.error.code).toBe('PROFILE_LOCKED');
      await ctx.http.post('/v1/pro/profile/submit').set(bearer(pro)).expect(409);
    });

    it('un professionnel non validé ne peut pas se déclarer disponible', async () => {
      const r = await ctx.http.patch('/v1/pro/availability').set(bearer(pro)).send({ isOnline: true }).expect(409);
      expect(r.body.error.code).toBe('PRO_NOT_APPROVED');
    });
  });

  describe('T3 — validation administrative', () => {
    it('le dossier apparaît dans la file d’attente', async () => {
      const r = await ctx.http.get('/v1/admin/pros?status=SUBMITTED').set(bearer(opsTokens)).expect(200);
      expect(r.body.items.map((i: { id: string }) => i.id)).toContain(proId);
    });

    it('la consultation d’un justificatif privé est journalisée et l’URL expire vite', async () => {
      const detail = await ctx.http.get(`/v1/admin/pros/${proId}`).set(bearer(opsTokens)).expect(200);
      const docId = detail.body.profile.documents[0].id;
      const r = await ctx.http.get(`/v1/admin/documents/${docId}/url`).set(bearer(opsTokens)).expect(200);
      expect(r.body.expiresInSeconds).toBe(60);
      expect(await (await fetch(r.body.url)).arrayBuffer()).toBeTruthy();
      expect(await ctx.prisma.auditLog.count({ where: { action: 'document.view', entityId: docId, actorId: ops.userId } })).toBe(1);
    });

    it('un refus sans motif est rejeté', async () => {
      const r = await ctx.http.post(`/v1/admin/pros/${proId}/reject`).set(bearer(opsTokens)).send({}).expect(422);
      expect(r.body.error.code).toBe('REASON_REQUIRED');
    });

    it('demande de compléments : le pro voit le message, corrige et soumet de nouveau', async () => {
      const detail = await ctx.http.get(`/v1/admin/pros/${proId}`).set(bearer(opsTokens)).expect(200);
      const docId = detail.body.profile.documents[0].id;
      const note = 'La pièce d’identité est illisible. Merci de la reprendre à la lumière du jour.';
      await ctx.http.post(`/v1/admin/pros/${proId}/request-info`).set(bearer(opsTokens)).send({ note, rejectedDocumentIds: [docId] }).expect(200);

      const mine = await ctx.http.get('/v1/pro/profile').set(bearer(pro)).expect(200);
      expect(mine.body).toMatchObject({ verificationStatus: 'INFO_REQUESTED', lastDecisionNote: note, missing: ['DOCUMENT:PIECE_IDENTITE'] });
      expect(mine.body.documents[0]).toMatchObject({ status: 'REJECTED', rejectionReason: note });
      expect(await ctx.prisma.notification.count({ where: { userId: proId, type: 'pro.VERIFICATION_INFO_REQUESTED' } })).toBe(1);

      const doc = await uploadFile(ctx, pro, 'VERIFICATION_DOC', TINY_PDF, 'application/pdf');
      await ctx.http.post('/v1/pro/documents').set(bearer(pro)).send({ typeCode: 'PIECE_IDENTITE', fileId: doc.fileId }).expect(201);
      await ctx.http.post('/v1/pro/profile/submit').set(bearer(pro)).expect(200);
    });

    it('validation : statut, date de vérification, documents, notification et journal d’audit', async () => {
      await ctx.http.post(`/v1/admin/pros/${proId}/approve`).set(bearer(opsTokens)).send({}).expect(200);
      const p = await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: proId }, include: { verificationDocuments: true } });
      expect(p.verificationStatus).toBe('APPROVED');
      expect(p.verifiedAt).not.toBeNull();
      expect(p.verifiedBy).toBe(ops.userId);
      expect(p.verificationDocuments.filter((d) => d.status === 'PENDING')).toHaveLength(0);
      expect(await ctx.prisma.notification.count({ where: { userId: proId, type: 'pro.VERIFICATION_APPROVED' } })).toBe(1);
      const audit = await ctx.prisma.auditLog.findMany({ where: { entityId: proId, entityType: 'pro_profile' }, orderBy: { id: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['pro.submit', 'pro.requestInfo', 'pro.submit', 'pro.approve']);
    });

    it('une décision ne peut pas être appliquée deux fois (décisions concurrentes)', async () => {
      const second = await loginWithPhone(ctx, '07 55 55 55 02', 'PRO');
      await ctx.http.patch('/v1/me').set(bearer(second.tokens)).send({ firstName: 'Moussa', lastName: 'Bamba' }).expect(200);
      const avatar = await uploadFile(ctx, second.tokens, 'AVATAR', await photoWithGps(), 'image/jpeg');
      await ctx.http.put('/v1/me/avatar').set(bearer(second.tokens)).send({ fileId: avatar.fileId }).expect(200);
      await ctx.http.put('/v1/pro/profile').set(bearer(second.tokens)).send({ ...(await draftBody()), businessName: 'Bamba Services' }).expect(200);
      const doc = await uploadFile(ctx, second.tokens, 'VERIFICATION_DOC', TINY_PDF, 'application/pdf');
      await ctx.http.post('/v1/pro/documents').set(bearer(second.tokens)).send({ typeCode: 'PIECE_IDENTITE', fileId: doc.fileId }).expect(201);
      await ctx.http.post('/v1/pro/profile/submit').set(bearer(second.tokens)).expect(200);

      const results = await Promise.all([
        ctx.http.post(`/v1/admin/pros/${second.userId}/approve`).set(bearer(opsTokens)).send({}),
        ctx.http.post(`/v1/admin/pros/${second.userId}/reject`).set(bearer(opsTokens)).send({ note: 'Doublon' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await ctx.prisma.proVerificationEvent.count({ where: { proId: second.userId, actorId: ops.userId } })).toBe(1);
    });

    it('le professionnel validé peut se déclarer disponible ; suspendu, il ne reçoit plus de demandes', async () => {
      const on = await ctx.http.patch('/v1/pro/availability').set(bearer(pro)).send({ isOnline: true }).expect(200);
      expect(on.body.isOnline).toBe(true);
      await ctx.http.post(`/v1/admin/pros/${proId}/suspend`).set(bearer(opsTokens)).send({ note: 'Réclamations répétées' }).expect(200);
      const p = await ctx.prisma.proProfile.findUniqueOrThrow({ where: { userId: proId } });
      expect(p).toMatchObject({ verificationStatus: 'SUSPENDED', isOnline: false });
      await ctx.http.patch('/v1/pro/availability').set(bearer(pro)).send({ isOnline: true }).expect(409);
      await ctx.http.post(`/v1/admin/pros/${proId}/reactivate`).set(bearer(opsTokens)).send({}).expect(200);
    });
  });

  describe('connexion administrateur', () => {
    it('première connexion : graine TOTP fournie, activée au premier code valide', async () => {
      const role = await ctx.prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN_SUPPORT' } });
      const { hashPassword } = await import('../../src/admin-auth/passwords.js');
      const user = await ctx.prisma.user.create({ data: { email: 'nouveau@ineed.test' } });
      await ctx.prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
      await ctx.prisma.adminCredential.create({ data: { userId: user.id, passwordHash: await hashPassword('Provisoire-123456') } });
      const step1 = await ctx.http.post('/v1/admin/auth/login').send({ email: 'Nouveau@Ineed.test', password: 'Provisoire-123456' }).expect(200);
      expect(step1.body.totpSetupRequired).toBe(true);
      expect(step1.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
      await ctx.http.post('/v1/admin/auth/totp').send({ mfaToken: step1.body.mfaToken, code: totp(step1.body.totpSecret) }).expect(200);
      expect((await ctx.prisma.adminCredential.findUniqueOrThrow({ where: { userId: user.id } })).totpEnabledAt).not.toBeNull();
      const again = await ctx.http.post('/v1/admin/auth/login').send({ email: 'nouveau@ineed.test', password: 'Provisoire-123456' }).expect(200);
      expect(again.body.totpSetupRequired).toBe(false);
      expect(again.body.totpSecret).toBeUndefined();
    });

    it('un code TOTP ne peut pas être rejoué', async () => {
      const at = Date.now() + 30_000; // pas suivant : accepté (tolérance d'un pas) et distinct du code déjà utilisé
      const s1 = await ctx.http.post('/v1/admin/auth/login').send({ email: ops.email, password: ops.password }).expect(200);
      await ctx.http.post('/v1/admin/auth/totp').send({ mfaToken: s1.body.mfaToken, code: totp(ops.totpSecret, at) }).expect(200);
      const s2 = await ctx.http.post('/v1/admin/auth/login').send({ email: ops.email, password: ops.password }).expect(200);
      await ctx.http.post('/v1/admin/auth/totp').send({ mfaToken: s2.body.mfaToken, code: totp(ops.totpSecret, at) }).expect(401);
    });

    it('même réponse pour un e-mail inconnu et un mauvais mot de passe ; blocage après 5 échecs', async () => {
      await flushRedis();
      const unknown = await ctx.http.post('/v1/admin/auth/login').send({ email: 'personne@ineed.test', password: 'x' }).expect(401);
      const victim = await createAdmin(ctx, 'ADMIN_FINANCE', 'finance@ineed.test');
      const wrong = await ctx.http.post('/v1/admin/auth/login').send({ email: victim.email, password: 'mauvais' }).expect(401);
      expect(unknown.body.error).toMatchObject({ code: wrong.body.error.code, message: wrong.body.error.message });
      for (let i = 0; i < 4; i++) await ctx.http.post('/v1/admin/auth/login').send({ email: victim.email, password: 'mauvais' }).expect(401);
      const locked = await ctx.http.post('/v1/admin/auth/login').send({ email: victim.email, password: victim.password }).expect(429);
      expect(locked.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('un administrateur ne peut pas utiliser les applications mobiles avec sa session admin, et inversement', async () => {
      await ctx.http.get('/v1/pro/profile').set(bearer(opsTokens)).expect(403);
      await ctx.http.get('/v1/admin/pros').set(bearer(pro)).expect(403);
    });
  });
});
