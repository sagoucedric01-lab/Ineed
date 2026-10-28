import { Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service.js';
import { matchScore } from './normalize.js';

export interface PublicService {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  pricingModel: string;
  referenceMinXof: number | null;
  referenceMaxXof: number | null;
  fixedPriceXof: number | null;
}

export interface PublicCategory {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  iconKey: string;
  skills: { id: string; name: string }[];
  services: PublicService[];
}

export interface CatalogSearchResult {
  categories: { id: string; name: string; iconKey: string }[];
  services: { id: string; name: string; categoryId: string; categoryName: string; iconKey: string }[];
}

const num = (v: bigint | null): number | null => (v === null ? null : Number(v));

/** Catalogue public : relu en base à chaque appel, une modification de l'administration s'applique immédiatement. */
@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async activeCategories(): Promise<PublicCategory[]> {
    return (await this.load()).map(({ searchTerms: _, ...c }) => c);
  }

  private async load(): Promise<(PublicCategory & { searchTerms: string[] })[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { skills: { orderBy: { name: 'asc' } }, services: { where: { isActive: true }, orderBy: { name: 'asc' } } },
    });
    return rows.map((c) => ({
      id: c.id,
      slug: c.slug,
      name: c.name,
      description: c.description,
      iconKey: c.iconKey,
      searchTerms: c.searchTerms,
      skills: c.skills.map((s) => ({ id: s.id, name: s.name })),
      services: c.services.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        description: s.description,
        pricingModel: s.pricingModel,
        referenceMinXof: num(s.referenceMinXof),
        referenceMaxXof: num(s.referenceMaxXof),
        fixedPriceXof: num(s.fixedPriceXof),
      })),
    }));
  }

  /** Recherche par métier, prestation, compétence ou description du problème (synonymes saisis par l'administration). */
  async search(query: string, limit = 8): Promise<CatalogSearchResult> {
    const categories = await this.load();
    const scoredCategories = categories
      .map((c) => ({
        c,
        score: Math.max(
          matchScore(query, c.name),
          ...c.searchTerms.map((t) => matchScore(query, t) - 10),
          ...c.skills.map((s) => matchScore(query, s.name) - 15),
          ...c.services.map((s) => matchScore(query, s.name) - 20),
        ),
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    const scoredServices = categories
      .flatMap((c) => c.services.map((s) => ({ c, s, score: Math.max(matchScore(query, s.name), matchScore(query, s.description ?? '') - 20) })))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    return {
      categories: scoredCategories.slice(0, limit).map(({ c }) => ({ id: c.id, name: c.name, iconKey: c.iconKey })),
      services: scoredServices
        .slice(0, limit)
        .map(({ c, s }) => ({ id: s.id, name: s.name, categoryId: c.id, categoryName: c.name, iconKey: c.iconKey })),
    };
  }
}
