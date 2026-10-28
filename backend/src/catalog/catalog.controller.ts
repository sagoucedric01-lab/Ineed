import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser, Public } from '../auth/decorators.js';
import { PrismaService } from '../infra/prisma.service.js';
import { type CatalogSearchResult, CatalogService } from './catalog.service.js';
import { CatalogSearchQueryDto, CategoryDto } from './dto.js';

/** Recherches conservées par utilisateur (les plus anciennes sont effacées au fil de l'eau). */
const SEARCH_HISTORY_KEEP = 20;

@ApiTags('Référentiel')
@Controller('v1/catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('categories')
  @Public()
  @ApiOperation({ summary: 'Métiers actifs avec leurs prestations et compétences, dans l’ordre défini par l’administration' })
  @ApiResponse({ status: 200, type: [CategoryDto] })
  categories() {
    return this.catalog.activeCategories();
  }

  @Get('search')
  @ApiBearerAuth()
  @Access({ app: 'CLIENT' })
  @ApiOperation({ summary: 'Recherche d’un métier ou d’une prestation (mots du client, synonymes, compétences)' })
  async search(@CurrentUser() user: AuthUser, @Query() q: CatalogSearchQueryDto): Promise<CatalogSearchResult> {
    const result = await this.catalog.search(q.q);
    await this.prisma.$transaction([
      this.prisma.searchHistory.create({ data: { userId: user.userId, query: q.q.slice(0, 80), categoryId: result.categories[0]?.id ?? null } }),
      this.prisma.$executeRaw`DELETE FROM search_history WHERE user_id = ${user.userId}::uuid AND id NOT IN (
        SELECT id FROM search_history WHERE user_id = ${user.userId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${SEARCH_HISTORY_KEEP})`,
    ]);
    return result;
  }

  @Get('recent-searches')
  @ApiBearerAuth()
  @Access({ app: 'CLIENT' })
  @ApiOperation({ summary: 'Mes dernières recherches (sans doublon)' })
  async recent(@CurrentUser() user: AuthUser): Promise<{ query: string; categoryId: string | null }[]> {
    const rows = await this.prisma.searchHistory.findMany({ where: { userId: user.userId, query: { not: null } }, orderBy: { createdAt: 'desc' }, take: SEARCH_HISTORY_KEEP });
    const seen = new Set<string>();
    const out: { query: string; categoryId: string | null }[] = [];
    for (const r of rows) {
      const key = r.query!.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ query: r.query!, categoryId: r.categoryId });
      if (out.length === 5) break;
    }
    return out;
  }
}
