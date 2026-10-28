import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';
import {
  CATEGORIES, CITY, COMMUNES, COUNTRY, DEFAULT_DISPATCH_RULES, PERMISSIONS, ROLES, SETTINGS,
  VERIFICATION_DOCUMENT_TYPES,
} from './reference-data.js';

type Tx = Prisma.TransactionClient;

const NOTIFICATIONS_FILE = resolve(dirname(fileURLToPath(import.meta.url)), '../../../design/copy/notifications_fr.json');

interface NotificationCopy {
  client: Record<string, { title: string; body: string }>;
  pro: Record<string, { title: string; body: string }>;
  sms: Record<string, { body: string }>;
}

/**
 * Insère ou met à jour les données de référence. Idempotent.
 * Ce que l'administration peut modifier (activation, ordre, paramètres, gabarits) n'est créé
 * que s'il n'existe pas : un nouveau passage du seed n'écrase pas les réglages de production.
 */
export async function seedReference(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await seedGeography(tx);
      await seedAccessControl(tx);
      await seedCatalog(tx);
      await seedVerificationTypes(tx);
      await seedDispatchRules(tx);
      await seedSettings(tx);
      await seedNotificationTemplates(tx);
    },
    { timeout: 60_000 },
  );
}

async function seedGeography(tx: Tx): Promise<void> {
  await tx.country.upsert({
    where: { code: COUNTRY.code },
    create: { code: COUNTRY.code, name: COUNTRY.name, currency: COUNTRY.currency, phonePrefix: COUNTRY.phonePrefix, isActive: true },
    update: { name: COUNTRY.name, currency: COUNTRY.currency, phonePrefix: COUNTRY.phonePrefix },
  });
  // Colonnes géographiques : SQL paramétré (type non pris en charge par le client Prisma).
  await tx.$executeRaw`
    INSERT INTO cities (country_code, name, timezone, center, is_active)
    VALUES (${COUNTRY.code}, ${CITY.name}, ${CITY.timezone},
            ST_SetSRID(ST_MakePoint(${CITY.lng}, ${CITY.lat}), 4326)::geography, true)
    ON CONFLICT (country_code, name) DO UPDATE SET timezone = EXCLUDED.timezone`;
  const city = await tx.city.findUniqueOrThrow({ where: { countryCode_name: { countryCode: COUNTRY.code, name: CITY.name } } });
  for (const c of COMMUNES) {
    await tx.$executeRaw`
      INSERT INTO zones (city_id, parent_id, kind, name, centroid)
      VALUES (${city.id}::uuid, NULL, 'COMMUNE', ${c.name},
              ST_SetSRID(ST_MakePoint(${c.lng}, ${c.lat}), 4326)::geography)
      ON CONFLICT ON CONSTRAINT zones_city_id_parent_id_name_key DO NOTHING`;
  }
}

async function seedAccessControl(tx: Tx): Promise<void> {
  for (const [code, description] of Object.entries(PERMISSIONS)) {
    await tx.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
  }
  for (const r of ROLES) {
    const role = await tx.role.upsert({
      where: { code: r.code },
      create: { code: r.code, label: r.label, isSystem: true },
      update: { label: r.label, isSystem: true },
    });
    // Les rôles système ont exactement les permissions définies ici.
    await tx.rolePermission.deleteMany({ where: { roleId: role.id, permissionCode: { notIn: r.permissions } } });
    await tx.rolePermission.createMany({
      data: r.permissions.map((permissionCode) => ({ roleId: role.id, permissionCode })),
      skipDuplicates: true,
    });
  }
}

async function seedCatalog(tx: Tx): Promise<void> {
  for (const [i, c] of CATEGORIES.entries()) {
    const category = await tx.category.upsert({
      where: { slug: c.slug },
      create: { slug: c.slug, name: c.name, iconKey: c.iconKey, searchTerms: c.searchTerms, sortOrder: (i + 1) * 10 },
      update: { iconKey: c.iconKey },
    });
    for (const s of c.services) {
      await tx.service.upsert({
        where: { slug: s.slug },
        create: { slug: s.slug, name: s.name, categoryId: category.id, pricingModel: 'QUOTE' },
        update: {},
      });
    }
    await tx.skill.createMany({ data: c.skills.map((name) => ({ name, categoryId: category.id })), skipDuplicates: true });
  }
}

async function seedVerificationTypes(tx: Tx): Promise<void> {
  for (const t of VERIFICATION_DOCUMENT_TYPES) {
    await tx.verificationDocumentType.upsert({
      where: { code: t.code },
      create: { code: t.code, label: t.label, requiredFor: t.requiredFor },
      update: { label: t.label },
    });
  }
}

async function seedDispatchRules(tx: Tx): Promise<void> {
  for (const r of DEFAULT_DISPATCH_RULES) {
    const existing = await tx.dispatchRule.findFirst({
      where: { cityId: null, categoryId: null, serviceId: null, mode: r.mode, isActive: true },
    });
    if (!existing) await tx.dispatchRule.create({ data: { ...r } });
  }
}

async function seedSettings(tx: Tx): Promise<void> {
  for (const s of SETTINGS) {
    await tx.setting.upsert({
      where: { key: s.key },
      create: { key: s.key, value: s.value as Prisma.InputJsonValue, description: s.description },
      update: { description: s.description },
    });
  }
}

async function seedNotificationTemplates(tx: Tx): Promise<void> {
  const copy = JSON.parse(readFileSync(NOTIFICATIONS_FILE, 'utf8')) as NotificationCopy;
  const rows = [
    ...Object.entries(copy.client).map(([type, t]) => ({ type: `client.${type}`, channel: 'PUSH', title: t.title, body: t.body })),
    ...Object.entries(copy.pro).map(([type, t]) => ({ type: `pro.${type}`, channel: 'PUSH', title: t.title, body: t.body })),
    ...Object.entries(copy.sms).map(([type, t]) => ({ type: `sms.${type}`, channel: 'SMS', title: type, body: t.body })),
  ];
  await tx.notificationTemplate.createMany({ data: rows.map((r) => ({ ...r, locale: 'fr-CI' })), skipDuplicates: true });
}
