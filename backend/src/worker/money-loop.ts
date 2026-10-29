import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { RefundsService } from '../billing/refunds.service.js';
import { purgeIdempotencyKeys } from '../common/idempotency/idempotency.js';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import { QuotesService } from '../quotes/quotes.service.js';

export const MONEY_TICK_MS = 15_000;
const LOCK_KEY = 'ineed:money:tick';
const LOCK_TTL_MS = 120_000;

export interface MoneyJobs {
  payments: PaymentsService;
  quotes: QuotesService;
  refunds: RefundsService;
  prisma: PrismaService;
}

/** Un passage complet des tâches de l'argent (utilisé par le worker et par les tests). */
export async function runMoneyJobs(j: MoneyJobs, now = new Date()) {
  const quotesExpired = await j.quotes.expireDue(now);
  const payments = await j.payments.tick(now);
  const refunds = await j.refunds.executeApproved(now);
  const keysPurged = await purgeIdempotencyKeys(j.prisma, now);
  return { ...payments, quotesExpired, refunds, keysPurged };
}

/**
 * Tâches de fond de l'argent, toutes les 15 s : revérification des paiements en attente (notification perdue),
 * expiration, relance et échéance des paiements, expiration des devis, exécution des remboursements, purge des
 * clés d'idempotence. Tout l'état est en base : un worker redémarré reprend au tick suivant.
 */
@Injectable()
export class MoneyLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    readonly payments: PaymentsService,
    readonly quotes: QuotesService,
    readonly refunds: RefundsService,
    readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext('Paiements');
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.once(), MONEY_TICK_MS);
    void this.once();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async once(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const token = `${process.pid}-${Date.now()}`;
    try {
      const acquired = await this.redis.client.set(LOCK_KEY, token, 'PX', LOCK_TTL_MS, 'NX');
      if (!acquired) return;
      const report = await runMoneyJobs(this);
      if (Object.values(report).some((v) => v > 0)) this.logger.info({ report }, 'Tick des paiements');
    } catch (err) {
      this.logger.error({ err }, 'Tick des paiements en échec ; nouvel essai au prochain tick');
    } finally {
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, LOCK_KEY, token).catch(() => undefined);
      this.running = false;
    }
  }
}
