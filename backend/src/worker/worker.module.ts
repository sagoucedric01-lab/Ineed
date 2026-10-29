import { Inject, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { LoggerModule, PinoLogger } from 'nestjs-pino';
import { ConfigModule } from '../config/config.module.js';
import { ENV, type Env } from '../config/env.js';
import { loggerParams } from '../common/http/logger.config.js';
import { AuditModule } from '../audit/audit.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { InfraModule } from '../infra/infra.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { QuotesModule } from '../quotes/quotes.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { DispatchLoop } from './dispatch-loop.js';
import { MoneyLoop } from './money-loop.js';
import { RedisService } from '../infra/redis.service.js';
import { WORKER_HEARTBEAT_INTERVAL_MS, WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_S } from './heartbeat.js';

/**
 * Processus des tâches de fond : signale sa présence, fait tourner le moteur d'attribution (vagues, expirations
 * des offres et réservations, clôtures automatiques, purge des positions) et les tâches de l'argent (MoneyLoop).
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    InfraModule,
    SettingsModule,
    AuditModule,
    NotificationsModule,
    BillingModule,
    DispatchModule,
    QuotesModule,
    PaymentsModule,
  ],
  providers: [DispatchLoop, MoneyLoop],
})
export class WorkerModule implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
    @Inject(ENV) private readonly env: Env,
  ) {
    logger.setContext('Worker');
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.redis.ensureConnected();
    await this.beat();
    this.timer = setInterval(() => void this.beat(), WORKER_HEARTBEAT_INTERVAL_MS);
    this.logger.info({ appEnv: this.env.APP_ENV }, 'Worker démarré');
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.redis.client.del(WORKER_HEARTBEAT_KEY).catch(() => undefined);
    this.logger.info('Worker arrêté');
  }

  private async beat(): Promise<void> {
    try {
      await this.redis.client.set(WORKER_HEARTBEAT_KEY, new Date().toISOString(), 'EX', WORKER_HEARTBEAT_TTL_S);
    } catch (err) {
      this.logger.warn({ err }, 'Battement du worker non enregistré (Redis indisponible)');
    }
  }
}
