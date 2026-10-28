import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiProperty, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../infra/prisma.service.js';

export class SkillDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
}

export class CategoryDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() slug!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ description: 'Clé de l’icône (design/icons/categories)' }) iconKey!: string;
  @ApiProperty({ type: [SkillDto] }) skills!: SkillDto[];
}

export class ZoneDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['COMMUNE', 'QUARTIER', 'SECTEUR'] }) kind!: string;
}

/** Lectures publiques du référentiel. La recherche et le détail des prestations arrivent en phase 5. */
@ApiTags('Référentiel')
@Public()
@Controller('v1')
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('catalog/categories')
  @ApiOperation({ summary: 'Métiers actifs, dans l’ordre défini par l’administration' })
  @ApiResponse({ status: 200, type: [CategoryDto] })
  async categories(): Promise<CategoryDto[]> {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true, parentId: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { skills: { orderBy: { name: 'asc' } } },
    });
    return rows.map((c) => ({ id: c.id, slug: c.slug, name: c.name, iconKey: c.iconKey, skills: c.skills.map((s) => ({ id: s.id, name: s.name })) }));
  }

  @Get('geo/zones')
  @ApiOperation({ summary: 'Communes actives d’une ville (Abidjan par défaut)' })
  @ApiQuery({ name: 'cityId', required: false })
  @ApiResponse({ status: 200, type: [ZoneDto] })
  async zones(@Query('cityId') cityId?: string): Promise<ZoneDto[]> {
    const city = cityId
      ? await this.prisma.city.findFirst({ where: { id: cityId, isActive: true } })
      : await this.prisma.city.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } });
    if (!city) return [];
    const rows = await this.prisma.zone.findMany({ where: { cityId: city.id, parentId: null, isActive: true }, orderBy: { name: 'asc' } });
    return rows.map((z) => ({ id: z.id, name: z.name, kind: z.kind }));
  }
}
