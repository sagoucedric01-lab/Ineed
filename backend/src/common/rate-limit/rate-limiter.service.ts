import { Injectable } from '@nestjs/common';
import { AppError } from '../http/api-error.js';
import { RedisService } from '../../infra/redis.service.js';

export interface RateLimitRule {
  /** Identifiant logique de la règle (ex. « otp:phone »). */
  name: string;
  limit: number;
  windowSeconds: number;
}

/**
 * Limitation de débit à fenêtre fixe, partagée entre toutes les instances via Redis.
 * Si Redis est indisponible, la requête est refusée (503) plutôt que laissée sans limite.
 */
@Injectable()
export class RateLimiterService {
  constructor(private readonly redis: RedisService) {}

  async consume(rule: RateLimitRule, subject: string): Promise<void> {
    const key = `ineed:rl:${rule.name}:${subject}`;
    let count: number;
    let ttl: number;
    try {
      await this.redis.ensureConnected();
      const res = await this.redis.client.multi().incr(key).expire(key, rule.windowSeconds, 'NX').ttl(key).exec();
      count = Number(res?.[0]?.[1]);
      ttl = Number(res?.[2]?.[1]);
    } catch {
      throw new AppError(503, 'SERVICE_UNAVAILABLE', 'Le service est momentanément indisponible. Réessayez dans un instant.');
    }
    if (count > rule.limit) {
      throw new AppError(429, 'RATE_LIMITED', 'Trop de demandes en peu de temps. Patientez puis réessayez.', {
        retryAfterSeconds: Math.max(ttl, 1),
      });
    }
  }
}
