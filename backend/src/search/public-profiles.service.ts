import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { MIN_RATINGS } from './ranking.js';

const fromTime = (d: Date) => d.toISOString().slice(11, 16);

/** Profil public : uniquement pour un professionnel réellement validé, sans donnée privée (téléphone, position, documents). */
@Injectable()
export class PublicProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
  ) {}

  async get(id: string) {
    const p = await this.prisma.proProfile.findFirst({
      where: { userId: id, verificationStatus: 'APPROVED', verifiedAt: { not: null }, user: { status: 'ACTIVE' } },
      include: {
        user: { include: { avatarFile: true } },
        proCategories: { include: { category: true } },
        proSkills: { include: { skill: true } },
        proServiceZones: { include: { zone: true } },
        proWeeklyHours: { orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }] },
      },
    });
    if (!p) throw new AppError(404, 'NOT_FOUND', 'Ce professionnel n’est pas disponible sur Ineed.');
    const avatar = p.user.avatarFile?.status === 'READY' ? p.user.avatarFile : null;
    return {
      id: p.userId,
      businessName: p.businessName,
      avatarUrl: avatar ? await this.files.readUrl(avatar) : null,
      verified: true,
      verifiedAt: p.verifiedAt!.toISOString(),
      kind: p.kind,
      bio: p.bio,
      yearsExperience: p.yearsExperience,
      categories: p.proCategories.filter((c) => c.category.isActive).map((c) => ({ id: c.category.id, name: c.category.name, iconKey: c.category.iconKey })),
      skills: p.proSkills.map((s) => ({ id: s.skill.id, name: s.skill.name })),
      zones: p.proServiceZones.filter((z) => z.zone.isActive).map((z) => ({ id: z.zone.id, name: z.zone.name })),
      weeklyHours: p.proWeeklyHours.map((h) => ({ weekday: h.weekday, start: fromTime(h.startTime), end: fromTime(h.endTime) })),
      ratingAvg: p.ratingCount >= MIN_RATINGS ? Math.round(Number(p.ratingAvg) * 10) / 10 : null,
      ratingCount: p.ratingCount,
      missionsCompleted: p.missionsCompleted,
      indicativePriceXof: p.indicativePriceXof === null ? null : Number(p.indicativePriceXof),
      isOnline: p.isOnline && (!p.pausedUntil || p.pausedUntil < new Date()),
      /** Avis vérifiés : publiés à partir de la phase 8 (évaluations). */
      reviews: [] as { rating: number; comment: string | null; createdAt: string }[],
    };
  }
}
