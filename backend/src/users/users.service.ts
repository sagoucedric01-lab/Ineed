import { Injectable } from '@nestjs/common';
import { type AuditContext, AuditService } from '../audit/audit.service.js';
import { OtpService } from '../auth/otp/otp.service.js';
import { SessionsService } from '../auth/sessions.service.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import { PrismaService } from '../infra/prisma.service.js';

/** Missions et demandes considérées comme en cours (bloquent la suppression du compte). */
const OPEN_REQUEST_STATUSES = ['PUBLISHED', 'MATCHING', 'OFFERS_RECEIVED', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION', 'NO_PROVIDER_FOUND'] as const;
const CLOSED_MISSION_STATUSES = ['CLOSED', 'CANCELLED'] as const;

export interface MeView {
  id: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  roles: string[];
  profileComplete: boolean;
  proStatus: string | null;
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly otp: OtpService,
    private readonly sessions: SessionsService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string): Promise<MeView> {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: { userRoles: { include: { role: true } }, proProfile: { select: { verificationStatus: true } }, avatarFile: true },
    });
    return {
      id: u.id,
      phone: u.phoneE164,
      firstName: u.firstName,
      lastName: u.lastName,
      avatarUrl: u.avatarFile && u.avatarFile.status === 'READY' ? await this.files.readUrl(u.avatarFile) : null,
      roles: u.userRoles.map((r) => r.role.code),
      profileComplete: !!(u.firstName && u.lastName),
      proStatus: u.proProfile?.verificationStatus ?? null,
      createdAt: u.createdAt.toISOString(),
    };
  }

  async updateNames(userId: string, firstName: string, lastName: string): Promise<MeView> {
    await this.prisma.user.update({ where: { id: userId }, data: { firstName: firstName.trim(), lastName: lastName.trim(), updatedAt: new Date() } });
    return this.me(userId);
  }

  async setAvatar(userId: string, fileId: string): Promise<MeView> {
    const file = await this.files.requireReady(userId, fileId, 'AVATAR');
    const previous = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { avatarFileId: true } });
    await this.prisma.user.update({ where: { id: userId }, data: { avatarFileId: file.id, updatedAt: new Date() } });
    if (previous.avatarFileId && previous.avatarFileId !== file.id) await this.files.remove(previous.avatarFileId);
    return this.me(userId);
  }

  /** Envoie un code SMS au numéro du compte pour confirmer la suppression. */
  async requestDeletionCode(userId: string, ip: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phoneE164) throw new AppError(409, 'NO_PHONE', 'Aucun numéro n’est associé à ce compte.');
    await this.assertNothingInProgress(userId);
    return this.otp.request(user.phoneE164, 'ACCOUNT_DELETION', ip);
  }

  /**
   * Suppression du compte : anonymisation immédiate des données d'identité, révocation de toutes les sessions.
   * Les missions et paiements passés sont conservés sans données personnelles (obligations comptables).
   * Les documents de vérification d'un professionnel suivent la durée de conservation définie (docs/phase-1, §3.5).
   */
  async confirmDeletion(userId: string, challengeId: string, code: string, ctx: AuditContext): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.phoneE164) throw new AppError(409, 'NO_PHONE', 'Aucun numéro n’est associé à ce compte.');
    await this.otp.verify(challengeId, code, 'ACCOUNT_DELETION', ctx.ip ?? 'inconnue', user.phoneE164);
    await this.assertNothingInProgress(userId);
    const avatarFileId = user.avatarFileId;
    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          phoneE164: null, email: null, firstName: null, lastName: null, avatarFileId: null,
          status: 'DELETED', deletionRequestedAt: now, anonymizedAt: now, updatedAt: now,
        },
      });
      // Adresses : effacées, sauf la position des adresses liées à des demandes passées (texte vidé).
      await tx.address.updateMany({ where: { userId }, data: { label: null, street: null, landmark: null, instructions: null, deletedAt: now } });
      await tx.device.deleteMany({ where: { userId } });
      await tx.searchHistory.deleteMany({ where: { userId } });
      await tx.proProfile.updateMany({
        where: { userId },
        data: { businessName: 'Compte supprimé', bio: null, companyRegNumber: null, isOnline: false, lastLocation: undefined, updatedAt: now },
      });
      await tx.$executeRaw`UPDATE pro_profiles SET last_location = NULL, base_location = NULL WHERE user_id = ${userId}::uuid`;
      await this.sessions.revokeAllForUser(userId, 'ACCOUNT_DELETED', tx);
      await this.audit.record(ctx, { action: 'user.delete', entityType: 'user', entityId: userId, after: { status: 'DELETED' } }, tx);
    });
    if (avatarFileId) await this.files.remove(avatarFileId);
  }

  private async assertNothingInProgress(userId: string): Promise<void> {
    const [missions, requests] = await Promise.all([
      this.prisma.mission.count({
        where: { OR: [{ clientId: userId }, { proId: userId }], status: { notIn: [...CLOSED_MISSION_STATUSES] } },
      }),
      this.prisma.serviceRequest.count({ where: { clientId: userId, status: { in: [...OPEN_REQUEST_STATUSES] } } }),
    ]);
    if (missions > 0 || requests > 0) {
      throw new AppError(409, 'ACCOUNT_HAS_ACTIVE_ACTIVITY', 'Vous avez une demande ou une mission en cours. Terminez-la ou annulez-la avant de supprimer votre compte.');
    }
  }
}
