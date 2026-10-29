import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';
import { PUSH_PROVIDER, type PushProvider } from './push/push-provider.js';

/** Nombre d'essais d'envoi avant d'abandonner (la notification reste visible dans l'application). */
export const MAX_PUSH_ATTEMPTS = 5;
const RETRY_BASE_MS = 30_000;
/** Une notification restée plus longtemps en attente n'est plus envoyée en push (elle n'aurait plus de sens). */
const STALE_MS = 24 * 3_600_000;
/** Une notification prise en charge par un worker interrompu redevient disponible après ce délai. */
const CLAIM_MS = 60_000;

interface Claimed {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  attempts: number;
  createdAt: Date;
}

export interface DeliveryReport {
  sent: number;
  noDevice: number;
  retried: number;
  failed: number;
}

/**
 * Envoi des notifications push à partir de la file en base (créée dans la même transaction que l'événement) :
 * aucune notification n'est perdue si le serveur s'arrête, et une reprise ne l'envoie pas deux fois.
 * Les notifications « pro.* » vont aux appareils Ineed Pro, les autres à l'application client.
 */
@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger('Notifications push');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async deliverDue(now = new Date(), limit = 100): Promise<DeliveryReport> {
    const report: DeliveryReport = { sent: 0, noDevice: 0, retried: 0, failed: 0 };
    // Prise en charge exclusive (plusieurs workers possibles) ; libérée d'elle-même si le worker s'arrête.
    const batch = await this.prisma.$queryRaw<Claimed[]>`
      UPDATE notifications n SET next_attempt_at = ${new Date(now.getTime() + CLAIM_MS)}
      FROM (SELECT id FROM notifications WHERE status = 'QUEUED' AND next_attempt_at <= ${now} ORDER BY next_attempt_at LIMIT ${limit} FOR UPDATE SKIP LOCKED) due
      WHERE n.id = due.id
      RETURNING n.id, n.user_id AS "userId", n.type, n.title, n.body, n.data, n.attempts, n.created_at AS "createdAt"`;
    for (const n of batch) {
      const outcome = await this.deliverOne(n, now);
      report[outcome]++;
    }
    return report;
  }

  private async deliverOne(n: Claimed, now: Date): Promise<keyof DeliveryReport> {
    if (now.getTime() - n.createdAt.getTime() > STALE_MS) {
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', lastError: 'Trop ancienne pour être envoyée' } });
      return 'failed';
    }
    const app = n.type.startsWith('pro.') ? 'PRO' : 'CLIENT';
    const devices = await this.prisma.device.findMany({ where: { userId: n.userId, app, disabledAt: null }, orderBy: { lastSeenAt: 'desc' }, take: 5 });
    if (!devices.length) {
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', pushResult: 'NO_DEVICE', sentAt: now } });
      return 'noDevice';
    }
    const data: Record<string, string> = { type: n.type, notificationId: n.id };
    for (const [k, v] of Object.entries(n.data ?? {})) if (typeof v === 'string') data[k] = v;
    let delivered = false;
    const errors: string[] = [];
    for (const d of devices) {
      const r = await this.push.send(d.pushToken, { title: n.title, body: n.body, data });
      if (r.status === 'SENT') delivered = true;
      else if (r.status === 'INVALID_TOKEN') await this.prisma.device.update({ where: { id: d.id }, data: { disabledAt: now } });
      else errors.push(r.error);
    }
    if (delivered) {
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', pushResult: 'SENT', sentAt: now, attempts: { increment: 1 }, lastError: null } });
      return 'sent';
    }
    if (!errors.length) {
      // Tous les jetons étaient périmés.
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'SENT', pushResult: 'NO_DEVICE', sentAt: now, attempts: { increment: 1 } } });
      return 'noDevice';
    }
    const attempts = n.attempts + 1;
    if (attempts >= MAX_PUSH_ATTEMPTS) {
      this.logger.warn(`Notification ${n.id} abandonnée après ${attempts} essais : ${errors.join(' ; ')}`);
      await this.prisma.notification.update({ where: { id: n.id }, data: { status: 'FAILED', attempts, lastError: errors.join(' ; ').slice(0, 500) } });
      return 'failed';
    }
    await this.prisma.notification.update({
      where: { id: n.id },
      data: { attempts, lastError: errors.join(' ; ').slice(0, 500), nextAttemptAt: new Date(now.getTime() + RETRY_BASE_MS * 2 ** (attempts - 1)) },
    });
    return 'retried';
  }
}
