import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Located {
  cityId: string;
  cityName: string;
  timezone: string;
  zoneId: string | null;
  zoneName: string | null;
  /** true quand la commune est déduite du centre le plus proche (contours pas encore saisis). */
  zoneApproximate: boolean;
}

type Db = PrismaService | Prisma.TransactionClient;

/** Rayon autour du centre d'une ville active dans lequel le service est proposé, tant que les contours ne sont pas saisis. */
export const SERVICE_AREA_SETTING = 'geo.service_area_radius_m';
const DEFAULT_SERVICE_AREA_M = 40_000;
/** Au-delà de cette distance du centre de commune le plus proche, aucune commune n'est déduite. */
const NEAREST_ZONE_MAX_M = 15_000;

/** Point PostGIS (geography, WGS 84) à insérer dans une requête paramétrée. */
export function pointSql(p: LatLng): Prisma.Sql {
  return Prisma.sql`ST_SetSRID(ST_MakePoint(${p.lng}, ${p.lat}), 4326)::geography`;
}

@Injectable()
export class GeoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** Ville active et commune d'un point, ou null si le point est hors de la zone desservie. */
  async locate(p: LatLng, db: Db = this.prisma): Promise<Located | null> {
    const radius = await this.settings.number(SERVICE_AREA_SETTING, DEFAULT_SERVICE_AREA_M);
    const pt = pointSql(p);
    const [city] = await db.$queryRaw<{ id: string; name: string; timezone: string }[]>`
      SELECT id, name, timezone FROM cities
      WHERE is_active AND ST_DWithin(center, ${pt}, ${radius})
      ORDER BY ST_Distance(center, ${pt}) LIMIT 1`;
    if (!city) return null;
    // Contours saisis : la zone la plus précise qui contient le point (secteur, puis quartier, puis commune).
    const [inside] = await db.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM zones
      WHERE city_id = ${city.id}::uuid AND is_active AND boundary IS NOT NULL AND ST_Covers(boundary, ${pt})
      ORDER BY CASE kind WHEN 'SECTEUR' THEN 0 WHEN 'QUARTIER' THEN 1 ELSE 2 END LIMIT 1`;
    if (inside) return { cityId: city.id, cityName: city.name, timezone: city.timezone, zoneId: inside.id, zoneName: inside.name, zoneApproximate: false };
    const [nearest] = await db.$queryRaw<{ id: string; name: string }[]>`
      SELECT id, name FROM zones
      WHERE city_id = ${city.id}::uuid AND is_active AND kind = 'COMMUNE' AND centroid IS NOT NULL
        AND ST_DWithin(centroid, ${pt}, ${NEAREST_ZONE_MAX_M})
      ORDER BY ST_Distance(centroid, ${pt}) LIMIT 1`;
    return { cityId: city.id, cityName: city.name, timezone: city.timezone, zoneId: nearest?.id ?? null, zoneName: nearest?.name ?? null, zoneApproximate: !!nearest };
  }

  /** Comme `locate`, mais refuse un point hors zone desservie avec un message clair. */
  async requireInServiceArea(p: LatLng, db: Db = this.prisma): Promise<Located> {
    const located = await this.locate(p, db);
    if (!located) {
      throw new AppError(422, 'OUTSIDE_SERVICE_AREA', 'Ineed n’est pas encore disponible à cet endroit. Le service couvre pour l’instant le district d’Abidjan.');
    }
    return located;
  }

  /** Vérifie qu'une zone choisie par l'utilisateur existe, est active et appartient à la ville. */
  async requireZoneInCity(zoneId: string, cityId: string, db: Db = this.prisma): Promise<{ id: string; name: string }> {
    const zone = await db.zone.findFirst({ where: { id: zoneId, cityId, isActive: true } });
    if (!zone) throw new AppError(422, 'ZONE_INVALID', 'Cette commune ne correspond pas à la position choisie.');
    return { id: zone.id, name: zone.name };
  }
}
