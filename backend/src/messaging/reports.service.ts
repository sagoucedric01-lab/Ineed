import { Injectable } from '@nestjs/common';
import type { AppKind } from '../auth/auth-user.js';
import { AppError } from '../common/http/api-error.js';
import { PrismaService } from '../infra/prisma.service.js';
import type { ReportDto } from './dto.js';

const notFound = () => new AppError(404, 'NOT_FOUND', 'Élément introuvable.');

/**
 * Signalements d'abus (message, utilisateur, profil, avis, demande). On ne peut signaler que ce qu'on a
 * réellement vu ; un même élément n'est signalé qu'une fois par personne (le renvoi rend le même signalement).
 * Le traitement par la modération arrive avec l'administration (phase 9).
 */
@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private async assertVisible(userId: string, app: AppKind, dto: ReportDto): Promise<void> {
    const participant = app === 'PRO' ? { proId: userId } : { clientId: userId };
    switch (dto.targetType) {
      case 'MESSAGE': {
        const m = await this.prisma.message.findUnique({ where: { id: dto.targetId }, include: { conversation: true } });
        if (!m || !(app === 'PRO' ? m.conversation.proId === userId : m.conversation.clientId === userId)) throw notFound();
        if (m.senderId === userId) throw new AppError(422, 'REPORT_OWN_CONTENT', 'Vous ne pouvez pas signaler votre propre message.');
        return;
      }
      case 'USER': {
        if (dto.targetId === userId) throw new AppError(422, 'REPORT_OWN_CONTENT', 'Vous ne pouvez pas vous signaler vous-même.');
        const other = app === 'PRO' ? { clientId: dto.targetId } : { proId: dto.targetId };
        if (!(await this.prisma.conversation.count({ where: { ...participant, ...other } })) && !(await this.prisma.mission.count({ where: { ...participant, ...other } }))) throw notFound();
        return;
      }
      case 'PRO_PROFILE':
        if (dto.targetId === userId) throw new AppError(422, 'REPORT_OWN_CONTENT', 'Vous ne pouvez pas vous signaler vous-même.');
        if (!(await this.prisma.proProfile.count({ where: { userId: dto.targetId, verificationStatus: 'APPROVED' } }))) throw notFound();
        return;
      case 'REVIEW': {
        const r = await this.prisma.review.findUnique({ where: { id: dto.targetId } });
        if (!r || (r.status !== 'PUBLISHED' && r.proId !== userId)) throw notFound();
        if (r.clientId === userId) throw new AppError(422, 'REPORT_OWN_CONTENT', 'Vous ne pouvez pas signaler votre propre avis.');
        return;
      }
      case 'REQUEST':
        if (app !== 'PRO' || !(await this.prisma.requestOffer.count({ where: { requestId: dto.targetId, proId: userId } }))) throw notFound();
        return;
    }
  }

  async create(userId: string, app: AppKind, dto: ReportDto) {
    await this.assertVisible(userId, app, dto);
    const key = { reporterId_targetType_targetId: { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId } };
    const r = await this.prisma.abuseReport.upsert({ where: key, create: { reporterId: userId, targetType: dto.targetType, targetId: dto.targetId, reason: dto.reason, details: dto.details ?? null }, update: {} });
    return { id: r.id, status: r.status, createdAt: r.createdAt.toISOString() };
  }
}
