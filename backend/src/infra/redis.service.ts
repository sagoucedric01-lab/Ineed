import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';
import { ENV, type Env } from '../config/env.js';

/** Connexion Redis partagée (files de tâches, limitation de débit, temps réel). */
@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      // Reconnexion progressive plafonnée à 5 s : l'API reste disponible et /health/ready signale la panne.
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });
    // Les erreurs de connexion sont exposées par /health/ready ; on évite qu'elles fassent tomber le processus.
    this.client.on('error', () => undefined);
  }

  async ensureConnected(): Promise<void> {
    if (this.client.status === 'wait' || this.client.status === 'end') await this.client.connect();
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
