import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

type Db = PrismaService | Prisma.TransactionClient;

/** Remplace les variables {{nom}} d'un gabarit ; une variable absente est laissée vide. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => vars[k] ?? '');
}

/**
 * Crée les notifications à partir des gabarits administrables (table notification_templates).
 * Phase 4 : notification visible dans l'application (statut QUEUED) ; l'envoi push (FCM) arrive en phase 8.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(private readonly prisma: PrismaService) {}

  async notify(
    userId: string,
    type: string,
    vars: Record<string, string> = {},
    data: Record<string, string> = {},
    db: Db = this.prisma,
  ): Promise<void> {
    const tpl = await db.notificationTemplate.findFirst({ where: { type, channel: 'PUSH', locale: 'fr-CI', isActive: true } });
    if (!tpl) {
      this.logger.warn(`Gabarit de notification absent ou désactivé : ${type}`);
      return;
    }
    await db.notification.create({
      data: { userId, type, title: renderTemplate(tpl.title, vars), body: renderTemplate(tpl.body, vars), data },
    });
  }
}
