import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators.js';
import { PrismaService } from '../infra/prisma.service.js';
import { LatLngDto, LocatedDto, PublicZoneDto } from './dto.js';
import { GeoService } from './geo.service.js';

@ApiTags('Référentiel')
@Controller('v1/geo')
export class GeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
  ) {}

  @Get('zones')
  @Public()
  @ApiOperation({ summary: 'Communes actives d’une ville (la première ville active par défaut)' })
  @ApiQuery({ name: 'cityId', required: false })
  @ApiResponse({ status: 200, type: [PublicZoneDto] })
  async zones(@Query('cityId') cityId?: string): Promise<PublicZoneDto[]> {
    const city = cityId
      ? await this.prisma.city.findFirst({ where: { id: cityId, isActive: true } })
      : await this.prisma.city.findFirst({ where: { isActive: true }, orderBy: { name: 'asc' } });
    if (!city) return [];
    const rows = await this.prisma.$queryRaw<{ id: string; name: string; kind: string; lat: number | null; lng: number | null }[]>`
      SELECT id, name, kind, ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng
      FROM zones WHERE city_id = ${city.id}::uuid AND parent_id IS NULL AND is_active ORDER BY name`;
    return rows.map((z) => ({ id: z.id, name: z.name, kind: z.kind, centroid: z.lat === null || z.lng === null ? null : { lat: z.lat, lng: z.lng } }));
  }

  @Get('locate')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Ville et commune d’un point choisi sur la carte (aucun service de géocodage externe)' })
  @ApiResponse({ status: 200, type: LocatedDto })
  async locate(@Query() q: LatLngDto): Promise<LocatedDto> {
    const located = await this.geo.locate(q);
    if (!located) return { inServiceArea: false };
    return {
      inServiceArea: true,
      cityId: located.cityId,
      cityName: located.cityName,
      zoneId: located.zoneId,
      zoneName: located.zoneName,
      zoneApproximate: located.zoneApproximate,
    };
  }
}
