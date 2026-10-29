import { Injectable, type OnApplicationBootstrap, type OnApplicationShutdown } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { RedisService } from '../infra/redis.service.js';

export const DISPATCH_TICK_MS = 5_000;
const LOCK_KEY = 'ineed:dispatch:tick';
const LOCK_TTL_MS = 60_000;

/**
 * Boucle du moteur d'attribution : un tick toutes les 5 s. Un verrou Redis évite que deux workers lancent le
 * même tick en même temps (le verrouillage par demande en base suffirait à la cohérence ; le verrou évite le
 * travail en double). L'état étant en base, un worker redémarré reprend au tick suivant.
 */
@Injectable()
export class DispatchLoop implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly dispatch: DispatchService,
    private readonly redis: RedisService,
    private readonly logger: PinoLogger,
  ) {
    logger.setContext('Attribution');
  }

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.once(), DISPATCH_TICK_MS);
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
      const report = await this.dispatch.tick();
      const busy = Object.values(report).some((v) => v > 0);
      if (busy) this.logger.info({ report }, 'Tick d’attribution');
    } catch (err) {
      this.logger.error({ err }, 'Tick d’attribution en échec ; nouvel essai au prochain tick');
    } finally {
      // Libère le verrou seulement s'il nous appartient encore.
      await this.redis.client.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0", 1, LOCK_KEY, token).catch(() => undefined);
      this.running = false;
    }
  }
}
