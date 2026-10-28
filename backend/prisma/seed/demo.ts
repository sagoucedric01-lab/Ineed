import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { Env } from '../../src/config/env.js';

/**
 * DONNÉES DE DÉMONSTRATION — fictives, réservées aux environnements local et test.
 * Repérables par : e-mail en @demo.ineed.invalid, nom suffixé « (démo) », numéros +225 07 00 00 00 xx.
 * Les professionnels « validés » ici n'ont fait l'objet d'AUCUNE vérification réelle : l'historique de
 * vérification le précise.
 */
export const DEMO_EMAIL_DOMAIN = 'demo.ineed.invalid';
export const DEMO_ALLOWED_ENVS: Env['APP_ENV'][] = ['local', 'test'];

export class DemoSeedForbiddenError extends Error {
  constructor(appEnv: string) {
    super(`Données de démonstration refusées : APP_ENV=${appEnv}. Autorisé uniquement en ${DEMO_ALLOWED_ENVS.join(', ')}.`);
    this.name = 'DemoSeedForbiddenError';
  }
}

interface DemoPro {
  phone: string; first: string; last: string; business: string; category: string; commune: string;
  lng: number; lat: number; status: 'APPROVED' | 'SUBMITTED' | 'INFO_REQUESTED'; note?: string; years: number; bio: string;
}

const CLIENTS = [
  { phone: '+2250700000001', first: 'Awa', last: 'Koné' },
  { phone: '+2250700000002', first: 'Yao', last: 'Kouadio' },
];

const PROS: DemoPro[] = [
  { phone: '+2250700000011', first: 'Koffi', last: 'Kouassi', business: 'Koffi Plomberie (démo)', category: 'plomberie', commune: 'Cocody',
    lng: -3.985, lat: 5.37, status: 'APPROVED', years: 12, bio: 'Plombier depuis 12 ans : fuites, débouchage, chauffe-eau.' },
  { phone: '+2250700000012', first: 'Moussa', last: 'Bamba', business: 'Électricité Bamba (démo)', category: 'electricite', commune: 'Yopougon',
    lng: -4.07, lat: 5.345, status: 'APPROVED', years: 8, bio: 'Dépannage électrique et installation de tableaux.' },
  { phone: '+2250700000013', first: 'Fatou', last: 'Diallo', business: 'Clim Services Diallo (démo)', category: 'climatisation', commune: 'Marcory',
    lng: -3.98, lat: 5.302, status: 'SUBMITTED', years: 5, bio: 'Entretien et recharge de climatiseurs.' },
  { phone: '+2250700000014', first: 'Ibrahim', last: 'Traoré', business: 'Serrurerie Traoré (démo)', category: 'serrurerie', commune: 'Plateau',
    lng: -4.018, lat: 5.325, status: 'INFO_REQUESTED', years: 3, bio: 'Ouverture de portes et changement de serrures.',
    note: 'La photo de la pièce d’identité est floue sur le verso. Merci de la reprendre à la lumière du jour.' },
];

export async function seedDemo(prisma: PrismaClient, appEnv: Env['APP_ENV']): Promise<void> {
  if (!DEMO_ALLOWED_ENVS.includes(appEnv)) throw new DemoSeedForbiddenError(appEnv);
  const city = await prisma.city.findFirstOrThrow({ where: { name: 'Abidjan', countryCode: 'CI' } });
  const roles = Object.fromEntries((await prisma.role.findMany({ where: { code: { in: ['CLIENT', 'PRO'] } } })).map((r) => [r.code, r.id]));

  await prisma.$transaction(async (tx) => {
    const upsertUser = (p: { phone: string; first: string; last: string }) =>
      tx.user.upsert({
        where: { phoneE164: p.phone },
        create: {
          phoneE164: p.phone, phoneVerifiedAt: new Date(), firstName: p.first, lastName: p.last, homeCityId: city.id,
          email: `${p.first.toLowerCase()}.${p.phone.slice(-2)}@${DEMO_EMAIL_DOMAIN}`,
        },
        update: {},
      });

    for (const c of CLIENTS) {
      const u = await upsertUser(c);
      await tx.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: roles.CLIENT! } }, create: { userId: u.id, roleId: roles.CLIENT! }, update: {} });
    }

    for (const p of PROS) {
      const u = await upsertUser(p);
      await tx.userRole.upsert({ where: { userId_roleId: { userId: u.id, roleId: roles.PRO! } }, create: { userId: u.id, roleId: roles.PRO! }, update: {} });
      const exists = await tx.proProfile.findUnique({ where: { userId: u.id } });
      if (exists) continue;
      await tx.proProfile.create({
        data: {
          userId: u.id, businessName: p.business, bio: p.bio, yearsExperience: p.years, cityId: city.id,
          verificationStatus: p.status, verifiedAt: p.status === 'APPROVED' ? new Date() : null,
        },
      });
      await tx.$executeRaw`
        UPDATE pro_profiles SET base_location = ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography
        WHERE user_id = ${u.id}::uuid`;
      const category = await tx.category.findUniqueOrThrow({ where: { slug: p.category } });
      await tx.proCategory.create({ data: { proId: u.id, categoryId: category.id } });
      const zone = await tx.zone.findFirstOrThrow({ where: { cityId: city.id, name: p.commune, parentId: null } });
      await tx.proServiceZone.create({ data: { proId: u.id, zoneId: zone.id } });
      await tx.proWeeklyHour.createMany({
        data: [1, 2, 3, 4, 5, 6].map((weekday) => ({
          proId: u.id, weekday, startTime: new Date('1970-01-01T08:00:00Z'), endTime: new Date('1970-01-01T18:00:00Z'),
        })),
      });
      await tx.proVerificationEvent.create({
        data: {
          proId: u.id, fromStatus: 'DRAFT', toStatus: p.status,
          note: p.status === 'APPROVED' ? 'Validation de démonstration : aucun document réel n’a été contrôlé.' : (p.note ?? null),
        },
      });
    }

    await tx.setting.upsert({
      where: { key: 'demo.seeded_at' },
      create: { key: 'demo.seeded_at', value: new Date().toISOString(), description: 'Données de démonstration présentes dans cette base' },
      update: { value: new Date().toISOString() },
    });
  });
}
