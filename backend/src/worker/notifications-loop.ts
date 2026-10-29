import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { NotificationDeliveryService } from '../notifications/delivery.service.js';

export const NOTIFICATIONS_TICK_MS = 3_000;

/**
 * Envoi des notifications push en file, toutes les 3 s. Pas de verrou global : chaque notification est prise en
 * charge de façon exclusive en base (plusieurs workers peuvent tourner sans envoyer deux fois).
 */
@Injectable()
export class NotificationsLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly delivery: NotificationDeliveryService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext('Notifications');
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.once(), NOTIFICATIONS_TICK_MS);
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async once(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const r = await this.delivery.deliverDue();
      if (r.sent + r.retried + r.failed > 0) this.logger.info({ report: r }, 'Envoi des notifications');
    } catch (err) {
      this.logger.error({ err }, 'Envoi des notifications en échec ; nouvel essai au prochain tick');
    } finally {
      this.running = false;
    }
  }
}
