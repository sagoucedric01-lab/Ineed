import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';

/**
 * Paramètres modifiables depuis l'administration sans redéploiement (table `settings`).
 * Cache mémoire de 30 s : une modification est prise en compte en moins d'une minute sur toutes les instances.
 */
@Injectable()
export class SettingsService {
  private cache = new Map<string, { value: unknown; until: number }>();
  static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.until > Date.now()) return (hit.value ?? fallback) as T;
    const row = await this.prisma.setting.findUnique({ where: { key } });
    const value = row?.value ?? null;
    this.cache.set(key, { value, until: Date.now() + SettingsService.TTL_MS });
    return (value ?? fallback) as T;
  }

  async number(key: string, fallback: number): Promise<number> {
    const v = await this.get<unknown>(key, fallback);
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  }

  invalidate(key?: string): void {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
