import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service.js';
import { AdminOnly } from '../auth/decorators.js';
import { AppError } from '../common/http/api-error.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { PrismaService } from '../infra/prisma.service.js';
import { CreateZoneDto, UpdateCityDto, UpdateZoneDto } from './dto.js';
import { pointSql } from './geo.service.js';

interface ZoneRow {
  id: string;
  cityId: string;
  parentId: string | null;
  kind: string;
  name: string;
  isActive: boolean;
  lat: number | null;
  lng: number | null;
  hasBoundary: boolean;
}

/** Villes, communes, quartiers et secteurs (module « Zones géographiques » de l'administration). */
@ApiTags('Administration — zones géographiques')
@ApiBearerAuth()
@Controller('v1/admin/geo')
export class AdminGeoController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('cities')
  @AdminOnly('geo.write')
  cities() {
    return this.prisma.$queryRaw`
      SELECT id, country_code AS "countryCode", name, timezone, is_active AS "isActive",
             ST_Y(center::geometry) AS lat, ST_X(center::geometry) AS lng
      FROM cities ORDER BY name`;
  }

  @Patch('cities/:id')
  @AdminOnly('geo.write')
  @ApiOperation({ summary: 'Active ou désactive une ville, ou déplace son centre' })
  async updateCity(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCityDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.city.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Cette ville n’existe pas.');
      if (dto.isActive !== undefined) await tx.city.update({ where: { id }, data: { isActive: dto.isActive } });
      if (dto.center) await tx.$executeRaw`UPDATE cities SET center = ${pointSql(dto.center)} WHERE id = ${id}::uuid`;
      await this.audit.record(auditContext(req), { action: 'geo.city.update', entityType: 'city', entityId: id, before: { isActive: before.isActive }, after: dto }, tx);
      return { id, ...dto };
    });
  }

  @Get('zones')
  @AdminOnly('geo.write')
  @ApiQuery({ name: 'cityId', required: true })
  zones(@Query('cityId', ParseUUIDPipe) cityId: string): Promise<ZoneRow[]> {
    return this.prisma.$queryRaw<ZoneRow[]>`
      SELECT id, city_id AS "cityId", parent_id AS "parentId", kind, name, is_active AS "isActive",
             ST_Y(centroid::geometry) AS lat, ST_X(centroid::geometry) AS lng, boundary IS NOT NULL AS "hasBoundary"
      FROM zones WHERE city_id = ${cityId}::uuid ORDER BY kind, name`;
  }

  @Post('zones')
  @AdminOnly('geo.write')
  @ApiOperation({ summary: 'Ajoute une commune, un quartier ou un secteur' })
  async createZone(@Body() dto: CreateZoneDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const city = await tx.city.findUnique({ where: { id: dto.cityId } });
      if (!city) throw new AppError(422, 'CITY_INVALID', 'Cette ville n’existe pas.');
      if (dto.parentId) {
        const parent = await tx.zone.findFirst({ where: { id: dto.parentId, cityId: dto.cityId } });
        if (!parent) throw new AppError(422, 'ZONE_PARENT_INVALID', 'La zone parente doit appartenir à la même ville.');
      } else if (dto.kind !== 'COMMUNE') {
        throw new AppError(422, 'ZONE_PARENT_REQUIRED', 'Un quartier ou un secteur doit être rattaché à une commune.');
      }
      const exists = await tx.zone.findFirst({ where: { cityId: dto.cityId, parentId: dto.parentId ?? null, name: dto.name.trim() } });
      if (exists) throw new AppError(409, 'ZONE_EXISTS', 'Une zone porte déjà ce nom à cet endroit.');
      const zone = await tx.zone.create({ data: { cityId: dto.cityId, parentId: dto.parentId ?? null, kind: dto.kind, name: dto.name.trim() } });
      if (dto.centroid) await tx.$executeRaw`UPDATE zones SET centroid = ${pointSql(dto.centroid)} WHERE id = ${zone.id}::uuid`;
      await this.audit.record(auditContext(req), { action: 'geo.zone.create', entityType: 'zone', entityId: zone.id, after: dto }, tx);
      return { id: zone.id };
    });
  }

  @Patch('zones/:id')
  @AdminOnly('geo.write')
  @ApiOperation({ summary: 'Renomme, désactive, déplace le centre ou enregistre le contour d’une zone' })
  async updateZone(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateZoneDto, @Req() req: AppRequest) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.zone.findUnique({ where: { id } });
      if (!before) throw new AppError(404, 'NOT_FOUND', 'Cette zone n’existe pas.');
      if (dto.name !== undefined || dto.isActive !== undefined) {
        await tx.zone.update({ where: { id }, data: { name: dto.name?.trim(), isActive: dto.isActive } });
      }
      if (dto.centroid) await tx.$executeRaw`UPDATE zones SET centroid = ${pointSql(dto.centroid)} WHERE id = ${id}::uuid`;
      if (dto.boundary === null) {
        await tx.$executeRaw`UPDATE zones SET boundary = NULL WHERE id = ${id}::uuid`;
      } else if (dto.boundary) {
        const geojson = JSON.stringify(dto.boundary);
        const [check] = await tx.$queryRaw<{ valid: boolean; kind: string }[]>`
          SELECT ST_IsValid(g) AS valid, GeometryType(g) AS kind FROM (SELECT ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326) AS g) s`.catch(() => {
          throw new AppError(422, 'BOUNDARY_INVALID', 'Le contour n’est pas un GeoJSON lisible.');
        });
        if (!check?.valid || !['POLYGON', 'MULTIPOLYGON'].includes(check.kind)) {
          throw new AppError(422, 'BOUNDARY_INVALID', 'Le contour doit être un polygone valide (Polygon ou MultiPolygon).');
        }
        await tx.$executeRaw`UPDATE zones SET boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(${geojson}), 4326))::geography WHERE id = ${id}::uuid`;
        // Centre recalculé depuis le contour s'il n'est pas fourni.
        if (!dto.centroid) await tx.$executeRaw`UPDATE zones SET centroid = ST_Centroid(boundary::geometry)::geography WHERE id = ${id}::uuid`;
      }
      await this.audit.record(
        auditContext(req),
        { action: 'geo.zone.update', entityType: 'zone', entityId: id, before: { name: before.name, isActive: before.isActive }, after: { ...dto, boundary: dto.boundary === undefined ? undefined : dto.boundary ? 'contour modifié' : 'contour effacé' } },
        tx,
      );
      return { id };
    });
  }
}
