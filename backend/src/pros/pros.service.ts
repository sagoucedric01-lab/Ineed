import { Injectable } from '@nestjs/common';
import { type AuditContext, AuditService } from '../audit/audit.service.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { EDITABLE_STATUSES, type MissingItem, missingRequirements, VERIFICATION_TRANSITIONS } from './pro-requirements.js';

export const MAX_CATEGORIES = 3;

export interface WeeklyHourInput {
  weekday: number;
  start: string;
  end: string;
}

export interface ProProfileInput {
  kind: 'INDIVIDUAL' | 'COMPANY';
  businessName: string;
  companyRegNumber?: string | null;
  bio?: string | null;
  yearsExperience?: number | null;
  categoryIds: string[];
  skillIds?: string[];
  zoneIds: string[];
  serviceRadiusM?: number;
  baseLocation?: { lat: number; lng: number } | null;
  weeklyHours: WeeklyHourInput[];
}

const toTime = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const fromTime = (d: Date) => d.toISOString().slice(11, 16);

const profileInclude = {
  proCategories: { include: { category: true } },
  proSkills: { include: { skill: true } },
  proServiceZones: { include: { zone: true } },
  proWeeklyHours: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
  verificationDocuments: { where: { status: { not: 'EXPIRED' } }, orderBy: { createdAt: 'asc' }, include: { type: true } },
  proVerificationEvents: { orderBy: { createdAt: 'desc' }, take: 1 },
  user: { select: { firstName: true, lastName: true, avatarFileId: true, phoneE164: true } },
} satisfies Prisma.ProProfileInclude;

type ProWithRelations = Prisma.ProProfileGetPayload<{ include: typeof profileInclude }>;

@Injectable()
export class ProsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  private async load(userId: string): Promise<ProWithRelations | null> {
    return this.prisma.proProfile.findUnique({ where: { userId }, include: profileInclude });
  }

  async requiredDocumentTypes(kind: 'INDIVIDUAL' | 'COMPANY'): Promise<string[]> {
    const types = await this.prisma.verificationDocumentType.findMany({ where: { isActive: true, requiredFor: { has: kind } } });
    return types.map((t) => t.code);
  }

  async view(userId: string) {
    const p = await this.load(userId);
    if (!p) return null;
    const required = await this.requiredDocumentTypes(p.kind);
    const lastEvent = p.proVerificationEvents[0];
    const missing: MissingItem[] = missingRequirements({
      kind: p.kind,
      hasNames: !!(p.user.firstName && p.user.lastName),
      businessName: p.businessName,
      companyRegNumber: p.companyRegNumber,
      categoryCount: p.proCategories.length,
      zoneCount: p.proServiceZones.length,
      hoursCount: p.proWeeklyHours.length,
      hasPhoto: !!p.user.avatarFileId,
      documentTypes: p.verificationDocuments.filter((d) => d.status !== 'REJECTED').map((d) => d.typeCode),
      requiredDocumentTypes: required,
    });
    return {
      kind: p.kind,
      businessName: p.businessName,
      companyRegNumber: p.companyRegNumber,
      bio: p.bio,
      yearsExperience: p.yearsExperience,
      serviceRadiusM: p.serviceRadiusM,
      categories: p.proCategories.map((c) => ({ id: c.category.id, name: c.category.name, iconKey: c.category.iconKey })),
      skills: p.proSkills.map((s) => ({ id: s.skill.id, name: s.skill.name })),
      zones: p.proServiceZones.map((z) => ({ id: z.zone.id, name: z.zone.name })),
      weeklyHours: p.proWeeklyHours.map((h) => ({ weekday: h.weekday, start: fromTime(h.startTime), end: fromTime(h.endTime) })),
      documents: p.verificationDocuments.map((d) => ({
        id: d.id, typeCode: d.typeCode, typeLabel: d.type.label, status: d.status, rejectionReason: d.rejectionReason, createdAt: d.createdAt.toISOString(),
      })),
      verificationStatus: p.verificationStatus,
      verifiedAt: p.verifiedAt?.toISOString() ?? null,
      /** Message de l'équipe Ineed lors de la dernière décision (motif de refus, compléments demandés). */
      lastDecisionNote: lastEvent && lastEvent.toStatus === p.verificationStatus ? lastEvent.note : null,
      isOnline: p.isOnline,
      pausedUntil: p.pausedUntil?.toISOString() ?? null,
      missing,
      canSubmit: missing.length === 0 && (EDITABLE_STATUSES as readonly string[]).includes(p.verificationStatus),
    };
  }

  private assertEditable(status: string | undefined): void {
    if (status && !(EDITABLE_STATUSES as readonly string[]).includes(status)) {
      throw new AppError(409, 'PROFILE_LOCKED', status === 'SUBMITTED'
        ? 'Votre dossier est en cours de vérification : il ne peut pas être modifié pour le moment.'
        : 'Votre dossier ne peut plus être modifié depuis l’application. Contactez l’assistance Ineed.');
    }
  }

  /** Crée ou remplace le brouillon de dossier (listes remplacées en entier). */
  async saveDraft(userId: string, input: ProProfileInput) {
    const existing = await this.prisma.proProfile.findUnique({ where: { userId } });
    this.assertEditable(existing?.verificationStatus);
    if (input.categoryIds.length === 0 || input.categoryIds.length > MAX_CATEGORIES) {
      throw new AppError(422, 'INVALID_CATEGORIES', `Choisissez entre 1 et ${MAX_CATEGORIES} métiers.`);
    }
    for (const h of input.weeklyHours) {
      if (h.end <= h.start) throw new AppError(422, 'INVALID_HOURS', 'Chaque plage horaire doit finir après son début.');
    }
    const city = await this.prisma.city.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } });
    if (!city) throw new AppError(503, 'NO_ACTIVE_CITY', 'Aucune ville n’est ouverte pour le moment.');
    const [categories, zones] = await Promise.all([
      this.prisma.category.findMany({ where: { id: { in: input.categoryIds }, isActive: true, parentId: null } }),
      this.prisma.zone.findMany({ where: { id: { in: input.zoneIds }, cityId: city.id, isActive: true } }),
    ]);
    if (categories.length !== new Set(input.categoryIds).size) throw new AppError(422, 'INVALID_CATEGORIES', 'Un des métiers choisis n’existe pas ou n’est plus proposé.');
    if (zones.length !== new Set(input.zoneIds).size) throw new AppError(422, 'INVALID_ZONES', 'Une des communes choisies n’est pas desservie.');
    const skills = input.skillIds?.length
      ? await this.prisma.skill.findMany({ where: { id: { in: input.skillIds }, categoryId: { in: input.categoryIds } } })
      : [];
    if (input.skillIds && skills.length !== new Set(input.skillIds).size) throw new AppError(422, 'INVALID_SKILLS', 'Une des spécialités ne correspond pas aux métiers choisis.');

    await this.prisma.$transaction(async (tx) => {
      const data = {
        kind: input.kind,
        businessName: input.businessName.trim(),
        companyRegNumber: input.kind === 'COMPANY' ? input.companyRegNumber?.trim() || null : null,
        bio: input.bio?.trim() || null,
        yearsExperience: input.yearsExperience ?? null,
        serviceRadiusM: input.serviceRadiusM ?? 10_000,
        updatedAt: new Date(),
      };
      await tx.proProfile.upsert({ where: { userId }, create: { userId, cityId: city.id, ...data }, update: data });
      if (input.baseLocation) {
        const inCity = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT ST_DWithin(center, ST_SetSRID(ST_MakePoint(${input.baseLocation.lng}, ${input.baseLocation.lat}), 4326)::geography, 60000) AS ok
            FROM cities WHERE id = ${city.id}::uuid`;
        if (!inCity[0]?.ok) throw new AppError(422, 'LOCATION_OUTSIDE_CITY', 'Le point de départ doit se trouver dans la zone desservie.');
        await tx.$executeRaw`UPDATE pro_profiles SET base_location = ST_SetSRID(ST_MakePoint(${input.baseLocation.lng}, ${input.baseLocation.lat}), 4326)::geography
                              WHERE user_id = ${userId}::uuid`;
      }
      await tx.proCategory.deleteMany({ where: { proId: userId } });
      await tx.proCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ proId: userId, categoryId })) });
      await tx.proSkill.deleteMany({ where: { proId: userId } });
      if (skills.length) await tx.proSkill.createMany({ data: skills.map((s) => ({ proId: userId, skillId: s.id })) });
      await tx.proServiceZone.deleteMany({ where: { proId: userId } });
      await tx.proServiceZone.createMany({ data: input.zoneIds.map((zoneId) => ({ proId: userId, zoneId })) });
      await tx.proWeeklyHour.deleteMany({ where: { proId: userId } });
      await tx.proWeeklyHour.createMany({
        data: input.weeklyHours.map((h) => ({ proId: userId, weekday: h.weekday, startTime: toTime(h.start), endTime: toTime(h.end) })),
      });
    });
    return this.view(userId);
  }

  async addDocument(userId: string, typeCode: string, fileId: string) {
    const pro = await this.prisma.proProfile.findUnique({ where: { userId } });
    if (!pro) throw new AppError(409, 'PROFILE_REQUIRED', 'Commencez par renseigner votre profil professionnel.');
    this.assertEditable(pro.verificationStatus);
    const type = await this.prisma.verificationDocumentType.findFirst({ where: { code: typeCode, isActive: true } });
    if (!type) throw new AppError(422, 'INVALID_DOCUMENT_TYPE', 'Ce type de justificatif n’est pas reconnu.');
    const file = await this.files.requireReady(userId, fileId, 'VERIFICATION_DOC');
    if (file.visibility !== 'PRIVATE') throw new AppError(422, 'INVALID_FILE', 'Ce fichier ne peut pas servir de justificatif.');
    await this.prisma.$transaction(async (tx) => {
      // Un nouveau dépôt remplace un justificatif du même type encore en attente ou refusé.
      await tx.verificationDocument.updateMany({ where: { proId: userId, typeCode, status: { in: ['PENDING', 'REJECTED'] } }, data: { status: 'EXPIRED' } });
      await tx.verificationDocument.create({ data: { proId: userId, typeCode, fileId: file.id } });
    });
    return this.view(userId);
  }

  async submit(userId: string, ctx: AuditContext) {
    const view = await this.view(userId);
    if (!view) throw new AppError(409, 'PROFILE_REQUIRED', 'Commencez par renseigner votre profil professionnel.');
    if (view.missing.length) throw new AppError(422, 'PROFILE_INCOMPLETE', 'Votre dossier est incomplet.', { missing: view.missing });
    const t = VERIFICATION_TRANSITIONS.submit;
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.proProfile.updateMany({ where: { userId, verificationStatus: { in: [...t.from] } }, data: { verificationStatus: t.to, updatedAt: new Date() } });
      if (updated.count !== 1) throw new AppError(409, 'INVALID_TRANSITION', 'Votre dossier a déjà été soumis.');
      await tx.proVerificationEvent.create({ data: { proId: userId, fromStatus: view.verificationStatus, toStatus: t.to, actorId: userId } });
      await this.audit.record(ctx, { action: 'pro.submit', entityType: 'pro_profile', entityId: userId, before: { status: view.verificationStatus }, after: { status: t.to } }, tx);
    });
    return this.view(userId);
  }

  /** Disponibilité immédiate et pause : réservées aux professionnels validés. */
  async setAvailability(userId: string, isOnline?: boolean, pausedUntil?: Date | null) {
    const pro = await this.prisma.proProfile.findUnique({ where: { userId } });
    if (!pro || pro.verificationStatus !== 'APPROVED') {
      throw new AppError(409, 'PRO_NOT_APPROVED', 'Votre compte doit être validé par Ineed avant de recevoir des demandes.');
    }
    if (pausedUntil && pausedUntil.getTime() <= Date.now()) throw new AppError(422, 'INVALID_PAUSE', 'La fin de la pause doit être dans le futur.');
    await this.prisma.proProfile.update({
      where: { userId },
      data: { ...(isOnline === undefined ? {} : { isOnline }), ...(pausedUntil === undefined ? {} : { pausedUntil }), updatedAt: new Date() },
    });
    return this.view(userId);
  }
}
