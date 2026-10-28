import { Injectable } from '@nestjs/common';
import type { DispatchRule } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';

export interface RuleScope {
  mode: 'URGENT' | 'SCHEDULED';
  cityId?: string | null;
  categoryId?: string | null;
  serviceId?: string | null;
}

/**
 * Règle d'attribution applicable : la plus précise parmi les règles actives (prestation, puis métier, puis ville,
 * puis règle par défaut). Relue en base à chaque appel : une modification de l'administration s'applique immédiatement.
 */
@Injectable()
export class DispatchRulesService {
  constructor(private readonly prisma: PrismaService) {}

  async ruleFor(scope: RuleScope): Promise<DispatchRule | null> {
    const rules = await this.prisma.dispatchRule.findMany({
      where: {
        isActive: true,
        mode: scope.mode,
        OR: [{ cityId: null }, ...(scope.cityId ? [{ cityId: scope.cityId }] : [])],
      },
    });
    const candidates = rules.filter(
      (r) => (r.categoryId === null || r.categoryId === scope.categoryId) && (r.serviceId === null || r.serviceId === scope.serviceId),
    );
    const weight = (r: DispatchRule) => (r.serviceId ? 4 : 0) + (r.categoryId ? 2 : 0) + (r.cityId ? 1 : 0);
    return candidates.sort((a, b) => weight(b) - weight(a))[0] ?? null;
  }
}
