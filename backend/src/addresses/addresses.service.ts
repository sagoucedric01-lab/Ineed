import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import { Prisma } from '../generated/prisma/client.js';
import { GeoService, type LatLng, pointSql } from '../geo/geo.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AddressDto, AddressInputDto } from './dto.js';

type Db = PrismaService | Prisma.TransactionClient;

/** Copie figée d'une adresse, conservée avec une demande même si l'adresse est ensuite modifiée ou supprimée. */
export interface AddressSnapshot {
  label: string | null;
  street: string | null;
  landmark: string | null;
  instructions: string | null;
  zoneName: string | null;
  cityName: string;
  lat: number;
  lng: number;
}

export interface ResolvedPlace {
  location: LatLng;
  cityId: string;
  zoneId: string | null;
  snapshot: AddressSnapshot;
}

interface AddressRow {
  id: string;
  label: string | null;
  lat: number;
  lng: number;
  cityId: string;
  cityName: string;
  zoneId: string | null;
  zoneName: string | null;
  street: string | null;
  landmark: string | null;
  instructions: string | null;
}

@Injectable()
export class AddressesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly settings: SettingsService,
  ) {}

  /** Contrôle un lieu saisi : point dans la zone desservie, commune cohérente, repère ou rue indiqué. */
  async resolve(input: Omit<AddressInputDto, 'label'> & { label?: string }, db: Db = this.prisma): Promise<ResolvedPlace> {
    if (!input.landmark && !input.street) {
      throw new AppError(422, 'ADDRESS_INCOMPLETE', 'Indiquez un repère (ou une rue) pour que le professionnel trouve l’endroit.');
    }
    const located = await this.geo.requireInServiceArea(input.location, db);
    const zone = input.zoneId ? await this.geo.requireZoneInCity(input.zoneId, located.cityId, db) : located.zoneId ? { id: located.zoneId, name: located.zoneName! } : null;
    return {
      location: input.location,
      cityId: located.cityId,
      zoneId: zone?.id ?? null,
      snapshot: {
        label: input.label ?? null,
        street: input.street ?? null,
        landmark: input.landmark ?? null,
        instructions: input.instructions ?? null,
        zoneName: zone?.name ?? null,
        cityName: located.cityName,
        lat: input.location.lat,
        lng: input.location.lng,
      },
    };
  }

  private async rows(userId: string, id?: string, db: Db = this.prisma): Promise<AddressRow[]> {
    return db.$queryRaw<AddressRow[]>`
      SELECT a.id, a.label, ST_Y(a.location::geometry) AS lat, ST_X(a.location::geometry) AS lng,
             a.city_id AS "cityId", c.name AS "cityName", a.zone_id AS "zoneId", z.name AS "zoneName",
             a.street, a.landmark, a.instructions
      FROM addresses a JOIN cities c ON c.id = a.city_id LEFT JOIN zones z ON z.id = a.zone_id
      WHERE a.user_id = ${userId}::uuid AND a.deleted_at IS NULL ${id ? Prisma.sql`AND a.id = ${id}::uuid` : Prisma.empty}
      ORDER BY a.created_at DESC`;
  }

  private view(r: AddressRow): AddressDto {
    return {
      id: r.id, label: r.label, location: { lat: r.lat, lng: r.lng }, cityId: r.cityId, cityName: r.cityName,
      zoneId: r.zoneId, zoneName: r.zoneName, street: r.street, landmark: r.landmark, instructions: r.instructions,
    };
  }

  async list(userId: string): Promise<AddressDto[]> {
    return (await this.rows(userId)).map((r) => this.view(r));
  }

  async get(userId: string, id: string, db: Db = this.prisma): Promise<AddressDto> {
    const [row] = await this.rows(userId, id, db);
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Cette adresse n’existe plus.');
    return this.view(row);
  }

  async create(userId: string, input: AddressInputDto): Promise<AddressDto> {
    const max = await this.settings.number('address.max_per_user', 10);
    return this.prisma.$transaction(async (tx) => {
      const count = await tx.address.count({ where: { userId, deletedAt: null } });
      if (count >= max) throw new AppError(409, 'ADDRESS_LIMIT', `Vous avez déjà ${max} adresses enregistrées. Supprimez-en une pour en ajouter une autre.`);
      const place = await this.resolve(input, tx);
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO addresses (user_id, label, city_id, zone_id, location, street, landmark, instructions)
        VALUES (${userId}::uuid, ${input.label ?? null}, ${place.cityId}::uuid, ${place.zoneId}::uuid, ${pointSql(place.location)},
                ${input.street ?? null}, ${input.landmark ?? null}, ${input.instructions ?? null})
        RETURNING id`;
      return this.get(userId, row!.id, tx);
    });
  }

  async update(userId: string, id: string, input: AddressInputDto): Promise<AddressDto> {
    return this.prisma.$transaction(async (tx) => {
      await this.get(userId, id, tx);
      const place = await this.resolve(input, tx);
      await tx.$executeRaw`
        UPDATE addresses SET label = ${input.label ?? null}, city_id = ${place.cityId}::uuid, zone_id = ${place.zoneId}::uuid,
               location = ${pointSql(place.location)}, street = ${input.street ?? null}, landmark = ${input.landmark ?? null},
               instructions = ${input.instructions ?? null}
        WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`;
      return this.get(userId, id, tx);
    });
  }

  /** Suppression douce : les demandes passées gardent leur copie de l'adresse. */
  async remove(userId: string, id: string): Promise<void> {
    const res = await this.prisma.address.updateMany({ where: { id, userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (res.count === 0) throw new AppError(404, 'NOT_FOUND', 'Cette adresse n’existe plus.');
  }
}
