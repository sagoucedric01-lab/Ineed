import { Injectable } from '@nestjs/common';
import { type AddressSnapshot, AddressesService, type ResolvedPlace } from '../addresses/addresses.service.js';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import { Prisma, type RequestStatus } from '../generated/prisma/client.js';
import { GeoService, pointSql } from '../geo/geo.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { ProSearchService } from '../search/pro-search.service.js';
import { checkWindow } from '../search/window.js';
import { DispatchService } from '../dispatch/dispatch.service.js';
import { Logger } from '@nestjs/common';
import { SettingsService } from '../settings/settings.service.js';
import type { RequestInputDto } from './dto.js';

type Tx = Prisma.TransactionClient;

/** Demandes en cours (comptent dans la limite par client). */
export const ACTIVE_STATUSES: RequestStatus[] = [
  'PUBLISHED', 'MATCHING', 'OFFERS_RECEIVED', 'NO_PROVIDER_FOUND', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION',
];
/** États depuis lesquels le client peut annuler sans pénalité (aucun professionnel réservé). */
const CANCELLABLE: RequestStatus[] = ['DRAFT', 'PUBLISHED', 'MATCHING', 'OFFERS_RECEIVED', 'NO_PROVIDER_FOUND', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION'];
const TERMINAL: RequestStatus[] = ['ASSIGNED', 'EXPIRED', 'CANCELLED'];
const MEDIA_URL_TTL_S = 600;

interface Extra {
  lat: number;
  lng: number;
  windowStart: Date | null;
  windowEnd: Date | null;
}

@Injectable()
export class RequestsService {
  private readonly logger = new Logger('Demandes');

  constructor(
    private readonly prisma: PrismaService,
    private readonly addresses: AddressesService,
    private readonly geo: GeoService,
    private readonly files: FilesService,
    private readonly settings: SettingsService,
    private readonly search: ProSearchService,
    private readonly dispatch: DispatchService,
  ) {}

  // ------------------------------------------------------------------ lecture

  private async extra(id: string, db: PrismaService | Tx = this.prisma): Promise<Extra> {
    const [row] = await db.$queryRaw<Extra[]>`
      SELECT ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
             lower(desired_window) AS "windowStart", upper(desired_window) AS "windowEnd"
      FROM service_requests WHERE id = ${id}::uuid`;
    return row!;
  }

  private load(where: Prisma.ServiceRequestWhereInput, db: PrismaService | Tx = this.prisma) {
    return db.serviceRequest.findFirst({
      where,
      include: {
        category: true,
        service: true,
        requestMedia: { include: { file: true }, orderBy: [{ kind: 'asc' }, { position: 'asc' }] },
        requestStatusHistories: { orderBy: { createdAt: 'asc' } },
      },
    });
  }

  private async view(r: NonNullable<Awaited<ReturnType<RequestsService['load']>>>, db: PrismaService | Tx = this.prisma) {
    const x = await this.extra(r.id, db);
    const snapshot = r.addressSnapshot as unknown as AddressSnapshot;
    return {
      id: r.id,
      status: r.status,
      mode: r.mode,
      category: { id: r.category.id, name: r.category.name, iconKey: r.category.iconKey },
      service: r.service ? { id: r.service.id, name: r.service.name } : null,
      pricingModel: r.pricingModel,
      description: r.description,
      place: {
        addressId: r.addressId,
        zoneId: r.zoneId,
        location: { lat: x.lat, lng: x.lng },
        label: snapshot.label,
        street: snapshot.street,
        landmark: snapshot.landmark,
        instructions: snapshot.instructions,
        zoneName: snapshot.zoneName,
        cityName: snapshot.cityName,
      },
      window: x.windowStart && x.windowEnd ? { start: x.windowStart.toISOString(), end: x.windowEnd.toISOString() } : null,
      budgetXof: r.budgetXof === null ? null : Number(r.budgetXof),
      media: await Promise.all(
        r.requestMedia
          .filter((m) => m.file.status === 'READY')
          .map(async (m) => ({ fileId: m.fileId, kind: m.kind, mimeType: m.file.mimeType, url: await this.files.readUrl(m.file, MEDIA_URL_TTL_S) })),
      ),
      history: r.requestStatusHistories.map((h) => ({ from: h.fromStatus, to: h.toStatus, at: h.createdAt.toISOString(), reason: h.reason })),
      createdAt: r.createdAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
      reservedProId: r.reservedProId,
      reservationExpiresAt: r.reservationExpiresAt?.toISOString() ?? null,
      searchRadiusM: r.currentRadiusM,
      missionId: (await db.mission.findFirst({ where: { requestId: r.id, status: { not: 'CANCELLED' } }, select: { id: true } }))?.id ?? null,
    };
  }

  async get(clientId: string, id: string) {
    const r = await this.load({ id, clientId });
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
    return this.view(r);
  }

  async list(clientId: string, scope: 'active' | 'history' = 'active', page = 1) {
    const statuses: RequestStatus[] = scope === 'active' ? ['DRAFT', ...ACTIVE_STATUSES] : TERMINAL;
    const pageSize = 20;
    const rows = await this.prisma.serviceRequest.findMany({
      where: { clientId, status: { in: statuses } },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: true, service: true },
    });
    return rows.map((r) => ({
      id: r.id,
      status: r.status,
      mode: r.mode,
      category: { id: r.category.id, name: r.category.name, iconKey: r.category.iconKey },
      service: r.service ? { id: r.service.id, name: r.service.name } : null,
      description: r.description,
      zoneName: (r.addressSnapshot as unknown as AddressSnapshot).zoneName,
      createdAt: r.createdAt.toISOString(),
      publishedAt: r.publishedAt?.toISOString() ?? null,
    }));
  }

  // ------------------------------------------------------------------ brouillon

  /** Contrôle et prépare le contenu d'un brouillon (tout est revérifié à la publication). */
  private async prepare(clientId: string, input: RequestInputDto, tx: Tx, requestId?: string) {
    const category = await tx.category.findFirst({ where: { id: input.categoryId, parentId: null } });
    if (!category?.isActive) throw new AppError(422, 'CATEGORY_UNAVAILABLE', 'Ce métier n’est pas proposé pour le moment.');
    const service = input.serviceId ? await tx.service.findFirst({ where: { id: input.serviceId, categoryId: category.id } }) : null;
    if (input.serviceId && !service?.isActive) throw new AppError(422, 'SERVICE_UNAVAILABLE', 'Cette prestation n’est pas proposée pour le moment.');

    let place: ResolvedPlace;
    if (input.addressId) {
      const a = await this.addresses.get(clientId, input.addressId, tx);
      place = await this.addresses.resolve(
        { location: a.location, zoneId: a.zoneId ?? undefined, street: a.street ?? undefined, landmark: a.landmark ?? undefined, instructions: a.instructions ?? undefined, label: a.label ?? undefined },
        tx,
      );
    } else if (input.place) {
      place = await this.addresses.resolve(input.place, tx);
    } else {
      throw new AppError(422, 'PLACE_REQUIRED', 'Indiquez où doit avoir lieu l’intervention.');
    }

    if (input.mode === 'URGENT' && input.window) {
      throw new AppError(422, 'WINDOW_NOT_ALLOWED', 'Une intervention immédiate n’a pas de créneau : choisissez « Programmer une intervention ».');
    }
    const window = input.window ? { start: new Date(input.window.start), end: new Date(input.window.end) } : null;
    if (window) checkWindow(window, await this.search.windowRules());

    const maxPhotos = await this.settings.number('request.max_photos', 5);
    const photos = [...new Set(input.photoFileIds ?? [])];
    if (photos.length > maxPhotos) throw new AppError(422, 'TOO_MANY_PHOTOS', `Ajoutez au plus ${maxPhotos} photos.`);
    const media: { fileId: string; kind: 'PHOTO' | 'VOICE'; position: number }[] = [];
    for (const [i, fileId] of photos.entries()) {
      await this.files.requireReady(clientId, fileId, 'REQUEST_PHOTO');
      media.push({ fileId, kind: 'PHOTO', position: i });
    }
    if (input.voiceFileId) {
      await this.files.requireReady(clientId, input.voiceFileId, 'REQUEST_VOICE');
      media.push({ fileId: input.voiceFileId, kind: 'VOICE', position: 0 });
    }
    // Un fichier n'appartient qu'à une seule demande.
    const used = await tx.requestMedia.findFirst({ where: { fileId: { in: media.map((m) => m.fileId) }, ...(requestId ? { requestId: { not: requestId } } : {}) } });
    if (used) throw new AppError(409, 'FILE_ALREADY_USED', 'Ce fichier est déjà joint à une autre demande.');

    return { category, service, place, window, media };
  }

  async create(clientId: string, input: RequestInputDto) {
    return this.prisma.$transaction(async (tx) => {
      const p = await this.prepare(clientId, input, tx);
      const windowSql = p.window ? Prisma.sql`tstzrange(${p.window.start}::timestamptz, ${p.window.end}::timestamptz, '[)')` : Prisma.sql`NULL`;
      const [row] = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO service_requests (client_id, city_id, category_id, service_id, pricing_model, mode, status, description, location,
                                      zone_id, address_id, address_snapshot, desired_window, budget_xof)
        VALUES (${clientId}::uuid, ${p.place.cityId}::uuid, ${p.category.id}::uuid, ${p.service?.id ?? null}::uuid,
                ${p.service?.pricingModel ?? 'QUOTE'}::pricing_model, ${input.mode}::request_mode, 'DRAFT', ${input.description},
                ${pointSql(p.place.location)}, ${p.place.zoneId}::uuid, ${input.addressId ?? null}::uuid,
                ${JSON.stringify(p.place.snapshot)}::jsonb, ${windowSql}, ${input.budgetXof ?? null}::bigint)
        RETURNING id`;
      const id = row!.id;
      if (p.media.length) await tx.requestMedia.createMany({ data: p.media.map((m) => ({ requestId: id, ...m })) });
      await tx.requestStatusHistory.create({ data: { requestId: id, fromStatus: null, toStatus: 'DRAFT', actorId: clientId } });
      return this.view((await this.load({ id }, tx))!, tx);
    });
  }

  async update(clientId: string, id: string, input: RequestInputDto) {
    const detached = await this.prisma.$transaction(async (tx) => {
      const current = await tx.serviceRequest.findFirst({ where: { id, clientId }, include: { requestMedia: true } });
      if (!current) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
      if (current.status !== 'DRAFT') throw new AppError(409, 'REQUEST_NOT_DRAFT', 'Une demande publiée ne peut plus être modifiée. Annulez-la pour en créer une nouvelle.');
      const p = await this.prepare(clientId, input, tx, id);
      const windowSql = p.window ? Prisma.sql`tstzrange(${p.window.start}::timestamptz, ${p.window.end}::timestamptz, '[)')` : Prisma.sql`NULL`;
      const n = await tx.$executeRaw`
        UPDATE service_requests SET city_id = ${p.place.cityId}::uuid, category_id = ${p.category.id}::uuid, service_id = ${p.service?.id ?? null}::uuid,
               pricing_model = ${p.service?.pricingModel ?? 'QUOTE'}::pricing_model, mode = ${input.mode}::request_mode,
               description = ${input.description}, location = ${pointSql(p.place.location)}, zone_id = ${p.place.zoneId}::uuid,
               address_id = ${input.addressId ?? null}::uuid, address_snapshot = ${JSON.stringify(p.place.snapshot)}::jsonb,
               desired_window = ${windowSql}, budget_xof = ${input.budgetXof ?? null}::bigint, version = version + 1, updated_at = now()
        WHERE id = ${id}::uuid AND status = 'DRAFT' AND version = ${current.version}`;
      if (n === 0) throw new AppError(409, 'REQUEST_CHANGED', 'La demande a été modifiée entre-temps. Rechargez-la puis recommencez.');
      await tx.requestMedia.deleteMany({ where: { requestId: id } });
      if (p.media.length) await tx.requestMedia.createMany({ data: p.media.map((m) => ({ requestId: id, ...m })) });
      const kept = new Set(p.media.map((m) => m.fileId));
      return current.requestMedia.filter((m) => !kept.has(m.fileId)).map((m) => m.fileId);
    });
    // Fichiers retirés de la demande : effacés du stockage.
    for (const fileId of detached) await this.files.remove(fileId);
    return this.get(clientId, id);
  }

  // ------------------------------------------------------------------ cycle de vie

  async publish(clientId: string, id: string) {
    const max = await this.settings.number('request.max_active_per_client', 3);
    const windowRules = await this.search.windowRules();
    await this.prisma.$transaction(async (tx) => {
      // Verrou sur le compte client : deux publications simultanées ne peuvent pas dépasser la limite.
      await tx.$executeRaw`SELECT 1 FROM users WHERE id = ${clientId}::uuid FOR UPDATE`;
      const r = await tx.serviceRequest.findFirst({ where: { id, clientId }, include: { category: true, service: true, requestMedia: { include: { file: true } } } });
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
      if (r.status !== 'DRAFT') throw new AppError(409, 'REQUEST_NOT_DRAFT', 'Cette demande a déjà été publiée.');
      if (!r.category.isActive) throw new AppError(422, 'CATEGORY_UNAVAILABLE', 'Ce métier n’est plus proposé. Modifiez votre demande.');
      if (r.service && !r.service.isActive) throw new AppError(422, 'SERVICE_UNAVAILABLE', 'Cette prestation n’est plus proposée. Modifiez votre demande.');
      const x = await this.extra(id, tx);
      const located = await this.geo.requireInServiceArea({ lat: x.lat, lng: x.lng }, tx);
      if (located.cityId !== r.cityId) throw new AppError(422, 'OUTSIDE_SERVICE_AREA', 'Ineed n’est plus disponible à cet endroit.');
      if (r.mode === 'SCHEDULED') {
        if (!x.windowStart || !x.windowEnd) throw new AppError(422, 'WINDOW_REQUIRED', 'Choisissez un créneau pour programmer l’intervention.');
        checkWindow({ start: x.windowStart, end: x.windowEnd }, windowRules, new Date(), located.timezone);
      }
      if (r.requestMedia.some((m) => m.file.status !== 'READY')) {
        throw new AppError(409, 'MEDIA_NOT_READY', 'Une photo ou la note vocale n’est plus disponible. Retirez-la puis réessayez.');
      }
      const active = await tx.serviceRequest.count({ where: { clientId, status: { in: ACTIVE_STATUSES } } });
      if (active >= max) {
        throw new AppError(409, 'TOO_MANY_ACTIVE_REQUESTS', `Vous avez déjà ${max} demandes en cours. Attendez qu’une demande aboutisse ou annulez-en une.`);
      }
      const n = await tx.serviceRequest.updateMany({
        where: { id, status: 'DRAFT', version: r.version },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          pricingModel: r.service?.pricingModel ?? 'QUOTE',
          version: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (n.count === 0) throw new AppError(409, 'REQUEST_CHANGED', 'La demande a été modifiée entre-temps. Rechargez-la puis recommencez.');
      await tx.requestStatusHistory.create({ data: { requestId: id, fromStatus: 'DRAFT', toStatus: 'PUBLISHED', actorId: clientId } });
    });
    // Recherche lancée tout de suite ; en cas d'échec, le worker la reprend au tick suivant.
    await this.dispatch.kick(id).catch((e: unknown) => {
      this.logger.error({ err: e, requestId: id }, 'Lancement immédiat de la recherche impossible');
    });
    return this.get(clientId, id);
  }

  async cancel(clientId: string, id: string, reason?: string) {
    await this.prisma.$transaction(async (tx) => {
      // Verrou : une acceptation simultanée par un professionnel ne peut pas croiser l'annulation.
      await tx.$executeRaw`SELECT 1 FROM service_requests WHERE id = ${id}::uuid FOR UPDATE`;
      const r = await tx.serviceRequest.findFirst({ where: { id, clientId } });
      if (!r) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
      if (r.status === 'CANCELLED') return;
      if (!CANCELLABLE.includes(r.status)) {
        throw new AppError(409, 'REQUEST_NOT_CANCELLABLE', TERMINAL.includes(r.status)
          ? 'Cette demande est terminée.'
          : 'Un professionnel est déjà réservé pour cette demande : annulez depuis le suivi de l’intervention.');
      }
      const n = await tx.serviceRequest.updateMany({
        where: { id, status: r.status, version: r.version },
        data: {
          status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null, reservedProId: null, reservationExpiresAt: null, nextWaveAt: null,
          version: { increment: 1 }, updatedAt: new Date(),
        },
      });
      if (n.count === 0) throw new AppError(409, 'REQUEST_CHANGED', 'La demande a changé entre-temps. Rechargez-la puis recommencez.');
      await tx.requestStatusHistory.create({ data: { requestId: id, fromStatus: r.status, toStatus: 'CANCELLED', actorId: clientId, reason: reason ?? null } });
      await this.dispatch.onRequestCancelled(tx, id, r.reservedProId);
    });
    return this.get(clientId, id);
  }

  windowRules() {
    return this.search.windowRules();
  }

  // ------------------------------------------------------------------ administration

  async adminList(status: string | undefined, page: number, pageSize: number) {
    const where: Prisma.ServiceRequestWhereInput = status ? { status: status as RequestStatus } : {};
    const [total, rows] = await Promise.all([
      this.prisma.serviceRequest.count({ where }),
      this.prisma.serviceRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { category: true, client: { select: { id: true, firstName: true, lastName: true } } },
      }),
    ]);
    return {
      total,
      items: rows.map((r) => ({
        id: r.id, status: r.status, mode: r.mode, category: r.category.name,
        client: { id: r.client.id, name: [r.client.firstName, r.client.lastName].filter(Boolean).join(' ') },
        zoneName: (r.addressSnapshot as unknown as AddressSnapshot).zoneName,
        createdAt: r.createdAt.toISOString(), publishedAt: r.publishedAt?.toISOString() ?? null,
      })),
    };
  }

  async adminGet(id: string) {
    const r = await this.load({ id });
    if (!r) throw new AppError(404, 'NOT_FOUND', 'Cette demande n’existe pas.');
    const v = await this.view(r);
    // Les photos du domicile ne sont pas exposées à l'administration par défaut (consultation à journaliser, phase 9).
    return { ...v, media: v.media.map(({ url: _, ...m }) => m), clientId: r.clientId };
  }
}
