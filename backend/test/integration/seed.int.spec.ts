import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { seedReference } from '../../prisma/seed/reference.js';
import { DemoSeedForbiddenError, seedDemo } from '../../prisma/seed/demo.js';
import { createTestDatabase, migrate, prismaFor, type TestDatabase } from '../helpers/db.js';

async function counts(prisma: PrismaClient) {
  return {
    categories: await prisma.category.count(),
    services: await prisma.service.count(),
    zones: await prisma.zone.count(),
    roles: await prisma.role.count(),
    rolePermissions: await prisma.rolePermission.count(),
    templates: await prisma.notificationTemplate.count(),
    dispatchRules: await prisma.dispatchRule.count(),
    settings: await prisma.setting.count(),
    users: await prisma.user.count(),
    pros: await prisma.proProfile.count(),
  };
}

describe('seeds', () => {
  let db: TestDatabase;
  let prisma: PrismaClient;

  beforeAll(async () => {
    db = await createTestDatabase();
    await migrate(db.url);
    prisma = prismaFor(db.url);
  });
  afterAll(async () => {
    await prisma?.$disconnect();
    await db?.drop();
  });

  it('le référentiel est idempotent et ne crée aucun utilisateur', async () => {
    await seedReference(prisma);
    const first = await counts(prisma);
    await seedReference(prisma);
    expect(await counts(prisma)).toEqual(first);
    expect(first).toMatchObject({ categories: 12, zones: 13, roles: 7, dispatchRules: 2, users: 0 });
    expect(first.templates).toBeGreaterThan(30);
  });

  it('ne réécrase pas les réglages modifiés par l’administration', async () => {
    await prisma.category.update({ where: { slug: 'menuiserie' }, data: { isActive: false, sortOrder: 999 } });
    await prisma.setting.update({ where: { key: 'mission.auto_close_hours' }, data: { value: 72 } });
    await seedReference(prisma);
    expect(await prisma.category.findUnique({ where: { slug: 'menuiserie' } })).toMatchObject({ isActive: false, sortOrder: 999 });
    expect((await prisma.setting.findUnique({ where: { key: 'mission.auto_close_hours' } }))?.value).toBe(72);
  });

  it('n’invente aucun tarif : les prestations n’ont pas de prix de référence', async () => {
    expect(await prisma.service.count({ where: { OR: [{ fixedPriceXof: { not: null } }, { referenceMinXof: { not: null } }] } })).toBe(0);
  });

  it('refuse les données de démonstration en staging et en production', async () => {
    await expect(seedDemo(prisma, 'production')).rejects.toBeInstanceOf(DemoSeedForbiddenError);
    await expect(seedDemo(prisma, 'staging')).rejects.toBeInstanceOf(DemoSeedForbiddenError);
    expect(await prisma.user.count()).toBe(0);
  });

  it('les données de démonstration sont marquées et idempotentes', async () => {
    await seedDemo(prisma, 'test');
    const once = await counts(prisma);
    await seedDemo(prisma, 'test');
    expect(await counts(prisma)).toEqual(once);
    const users = await prisma.user.findMany();
    expect(users.every((u) => u.email?.endsWith('@demo.ineed.invalid'))).toBe(true);
    const pros = await prisma.proProfile.findMany({ include: { proVerificationEvents: true } });
    expect(pros.every((p) => p.businessName.endsWith('(démo)'))).toBe(true);
    for (const p of pros.filter((x) => x.verificationStatus === 'APPROVED')) {
      expect(p.proVerificationEvents.some((e) => e.note?.includes('aucun document réel'))).toBe(true);
    }
  });
});
