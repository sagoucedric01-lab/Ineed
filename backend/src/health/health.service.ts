import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';
import { RedisService } from '../infra/redis.service.js';
import { StorageService } from '../infra/storage.service.js';
import { WORKER_HEARTBEAT_KEY } from '../worker/heartbeat.js';

export type CheckStatus = 'ok' | 'error';

export interface CheckResult {
  status: CheckStatus;
  latencyMs: number;
  detail?: string;
}

export interface ReadinessReport {
  status: CheckStatus;
  checks: { database: CheckResult; redis: CheckResult; storage: CheckResult };
  /** Informatif : un worker absent ne rend pas l'API indisponible. */
  worker: { status: 'ok' | 'absent' | 'unknown'; lastSeenAt?: string };
}

export const CHECK_TIMEOUT_MS = 2_000;

async function timed(fn: (signal: AbortSignal) => Promise<string | undefined>): Promise<CheckResult> {
  const started = performance.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`délai dépassé (${CHECK_TIMEOUT_MS} ms)`));
      }, CHECK_TIMEOUT_MS);
    });
    const detail = await Promise.race([fn(controller.signal), timeout]);
    return { status: 'ok', latencyMs: Math.round(performance.now() - started), ...(detail ? { detail } : {}) };
  } catch (e) {
    return { status: 'error', latencyMs: Math.round(performance.now() - started), detail: (e as Error).message || String(e) };
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly storage: StorageService,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [database, redis, storage] = await Promise.all([
      timed(async () => {
        const rows = await this.prisma.$queryRaw<{ v: string }[]>`SELECT postgis_lib_version() AS v`;
        return `PostGIS ${rows[0]?.v ?? '?'}`;
      }),
      timed(async () => {
        await this.redis.ensureConnected();
        await this.redis.client.ping();
        return undefined;
      }),
      timed(async (signal) => {
        await this.storage.checkBuckets(signal);
        return undefined;
      }),
    ]);
    const worker = await this.workerStatus(redis.status === 'ok');
    const status: CheckStatus = [database, redis, storage].every((c) => c.status === 'ok') ? 'ok' : 'error';
    return { status, checks: { database, redis, storage }, worker };
  }

  private async workerStatus(redisUp: boolean): Promise<ReadinessReport['worker']> {
    if (!redisUp) return { status: 'unknown' };
    try {
      const lastSeen = await this.redis.client.get(WORKER_HEARTBEAT_KEY);
      return lastSeen ? { status: 'ok', lastSeenAt: lastSeen } : { status: 'absent' };
    } catch {
      return { status: 'unknown' };
    }
  }
}
