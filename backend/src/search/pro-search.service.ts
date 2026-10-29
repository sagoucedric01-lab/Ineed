import { Injectable } from '@nestjs/common';
import { AppError } from '../common/http/api-error.js';
import { FilesService } from '../files/files.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { GeoService, type LatLng, pointSql } from '../geo/geo.service.js';
import { PrismaService } from '../infra/prisma.service.js';
import { DispatchRulesService } from '../settings/dispatch-rules.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { type Candidate, etaMinutes, MIN_RATINGS, rank } from './ranking.js';
import { checkWindow, type TimeWindow } from './window.js';

export type SearchMode = 'URGENT' | 'SCHEDULED';

export interface SearchInput {
  categoryId: string;
  serviceId?: string;
  mode: SearchMode;
  location: LatLng;
  /** Commune du client : sert pour les professionnels sans position connue. */
  zoneId?: string;
  radiusM?: number;
  window?: TimeWindow;
  limit?: number;
}

export type Suggestion = 'WIDEN_RADIUS' | 'SCHEDULE' | 'CHANGE_SLOT';

export interface ProCard {
  id: string;
  businessName: string;
  avatarUrl: string | null;
  verified: true;
  distanceM: number | null;
  etaMinutes: number | null;
  /** LIVE : position du moment ; BASE : point de départ habituel ; ZONE : intervient dans la commune du client. */
  locationPrecision: 'LIVE' | 'BASE' | 'ZONE';
  ratingAvg: number | null;
  ratingCount: number;
  missionsCompleted: number;
  indicativePriceXof: number | null;
  isOnline: boolean;
}

export interface SearchResult {
  mode: SearchMode;
  radiusM: number;
  maxRadiusM: number;
  zoneName: string | null;
  items: ProCard[];
  /** Pistes proposées au client quand aucun professionnel n'est trouvé. */
  suggestions: Suggestion[];
  nextRadiusM: number | null;
}

export interface CandidateQuery {
  cityId: string;
  timezone: string;
  categoryId: string;
  mode: SearchMode;
  point: LatLng;
  zoneId: string | null;
  radiusM: number;
  window?: TimeWindow;
  /** Le client lui-même n'est jamais proposé (un professionnel peut aussi être client). */
  excludeUserId?: string;
  /** Professionnels déjà sollicités pour cette demande (sauf ceux dont l'offre a été retirée sans qu'ils refusent). */
  excludeOffersOf?: string;
  now?: Date;
}

type Db = PrismaService | Prisma.TransactionClient;

export type RankedCandidate = Candidate & { row: Row };

export interface Row {
  id: string;
  businessName: string;
  avatarBucket: string | null;
  avatarKey: string | null;
  distanceM: number | null;
  source: 'LIVE' | 'BASE' | null;
  ratingAvg: string;
  ratingCount: number;
  missionsCompleted: number;
  offersReceived: number;
  offersAccepted: number;
  cancellationsByPro: number;
  indicativePriceXof: bigint | null;
  isOnline: boolean;
}

/** Missions pendant lesquelles un professionnel est occupé et ne peut pas partir en urgence. */
const BUSY_MISSION_STATUSES = Prisma.sql`'EN_ROUTE','ARRIVED','IN_PROGRESS'`;

@Injectable()
export class ProSearchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly geo: GeoService,
    private readonly rules: DispatchRulesService,
    private readonly settings: SettingsService,
    private readonly files: FilesService,
  ) {}

  async windowRules() {
    return {
      minLeadMinutes: await this.settings.number('request.min_schedule_lead_minutes', 60),
      maxDays: await this.settings.number('request.max_schedule_days', 30),
    };
  }

  /**
   * Professionnels admissibles, classés (règles communes à la recherche du client et aux vagues d'attribution) :
   * validés, du métier, non suspendus ; disponibles maintenant sans mission en cours (urgence) ou sur le créneau
   * (programmé) ; dans le rayon demandé et leur rayon personnel, ou rattachés à la commune sans position connue.
   */
  async candidates(q: CandidateQuery, db: Db = this.prisma): Promise<RankedCandidate[]> {
    const now = q.now ?? new Date();
    const freshMinutes = await this.settings.number('pro.location_fresh_minutes', 30);
    const pt = pointSql(q.point);
    const modeFilter =
      q.mode === 'URGENT'
        ? Prisma.sql`AND pc.accepts_urgent AND p.is_online
            AND NOT EXISTS (SELECT 1 FROM missions m WHERE m.pro_id = p.user_id AND m.status IN (${BUSY_MISSION_STATUSES}))`
        : Prisma.sql`AND pc.accepts_scheduled
            AND EXISTS (
              SELECT 1 FROM pro_weekly_hours h
              WHERE h.pro_id = p.user_id
                AND h.weekday = EXTRACT(ISODOW FROM (${q.window!.start}::timestamptz AT TIME ZONE ${q.timezone}))
                AND h.start_time < (${q.window!.end}::timestamptz AT TIME ZONE ${q.timezone})::time
                AND h.end_time > (${q.window!.start}::timestamptz AT TIME ZONE ${q.timezone})::time)
            AND NOT EXISTS (
              SELECT 1 FROM pro_time_off t WHERE t.pro_id = p.user_id
                AND t.period && tstzrange(${q.window!.start}::timestamptz, ${q.window!.end}::timestamptz))`;
    const exclusions = Prisma.sql`
      ${q.excludeUserId ? Prisma.sql`AND p.user_id <> ${q.excludeUserId}::uuid` : Prisma.empty}
      ${q.excludeOffersOf ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM request_offers o WHERE o.request_id = ${q.excludeOffersOf}::uuid AND o.pro_id = p.user_id AND o.status <> 'WITHDRAWN')` : Prisma.empty}`;
    const fresh = Prisma.sql`p.is_online AND p.last_location IS NOT NULL AND p.last_location_at > ${now}::timestamptz - make_interval(mins => ${freshMinutes}::int)`;

    const rows = await db.$queryRaw<Row[]>`
      SELECT p.user_id AS id, p.business_name AS "businessName", f.bucket AS "avatarBucket", f.object_key AS "avatarKey",
             CASE WHEN eff.loc IS NULL THEN NULL ELSE ST_Distance(eff.loc, ${pt}) END AS "distanceM",
             eff.source, p.rating_avg AS "ratingAvg", p.rating_count AS "ratingCount", p.missions_completed AS "missionsCompleted",
             p.offers_received AS "offersReceived", p.offers_accepted AS "offersAccepted", p.cancellations_by_pro AS "cancellationsByPro",
             p.indicative_price_xof AS "indicativePriceXof", p.is_online AS "isOnline"
      FROM pro_profiles p
      JOIN users u ON u.id = p.user_id AND u.status = 'ACTIVE'
      JOIN pro_categories pc ON pc.pro_id = p.user_id AND pc.category_id = ${q.categoryId}::uuid
      LEFT JOIN files f ON f.id = u.avatar_file_id AND f.status = 'READY'
      CROSS JOIN LATERAL (
        SELECT CASE WHEN ${fresh} THEN p.last_location ELSE p.base_location END AS loc,
               CASE WHEN ${fresh} THEN 'LIVE' WHEN p.base_location IS NOT NULL THEN 'BASE' END AS source
      ) eff
      WHERE p.verification_status = 'APPROVED' AND p.verified_at IS NOT NULL
        AND p.city_id = ${q.cityId}::uuid
        AND (p.paused_until IS NULL OR p.paused_until < ${now}::timestamptz)
        ${modeFilter}
        ${exclusions}
        AND (
          (eff.loc IS NOT NULL AND ST_DWithin(eff.loc, ${pt}, LEAST(${q.radiusM}::int, p.service_radius_m)))
          OR (eff.loc IS NULL AND ${q.zoneId}::uuid IS NOT NULL
              AND EXISTS (SELECT 1 FROM pro_service_zones z WHERE z.pro_id = p.user_id AND z.zone_id = ${q.zoneId}::uuid))
        )
      LIMIT 200`;
    return rank(
      rows.map((r) => ({
        id: r.id,
        distanceM: r.distanceM === null ? null : Number(r.distanceM),
        ratingAvg: Number(r.ratingAvg),
        ratingCount: r.ratingCount,
        offersReceived: r.offersReceived,
        offersAccepted: r.offersAccepted,
        missionsCompleted: r.missionsCompleted,
        cancellationsByPro: r.cancellationsByPro,
        isOnline: r.isOnline,
        row: r,
      })),
      q.radiusM,
    );
  }

  async search(input: SearchInput): Promise<SearchResult> {
    const located = await this.geo.requireInServiceArea(input.location);
    const category = await this.prisma.category.findFirst({ where: { id: input.categoryId, isActive: true, parentId: null } });
    if (!category) throw new AppError(422, 'CATEGORY_UNAVAILABLE', 'Ce métier n’est pas proposé pour le moment.');
    if (input.serviceId) {
      const service = await this.prisma.service.findFirst({ where: { id: input.serviceId, categoryId: category.id, isActive: true } });
      if (!service) throw new AppError(422, 'SERVICE_UNAVAILABLE', 'Cette prestation n’est pas proposée pour le moment.');
    }
    if (input.mode === 'SCHEDULED') {
      if (!input.window) throw new AppError(422, 'WINDOW_REQUIRED', 'Choisissez un créneau pour programmer l’intervention.');
      checkWindow(input.window, await this.windowRules(), new Date(), located.timezone);
    }
    const zoneId = input.zoneId ? (await this.geo.requireZoneInCity(input.zoneId, located.cityId)).id : located.zoneId;
    const zone = zoneId ? await this.prisma.zone.findUnique({ where: { id: zoneId } }) : null;

    const rule = await this.rules.ruleFor({ mode: input.mode, cityId: located.cityId, categoryId: category.id, serviceId: input.serviceId });
    const initial = rule?.initialRadiusM ?? 5000;
    const max = rule?.maxRadiusM ?? 20_000;
    const radius = Math.min(Math.max(input.radiusM ?? initial, 500), max);
    const candidates = await this.candidates({
      cityId: located.cityId,
      timezone: located.timezone,
      categoryId: category.id,
      mode: input.mode,
      point: input.location,
      zoneId,
      radiusM: radius,
      window: input.window,
    });
    const speed = await this.settings.number('search.eta_speed_kmh', 18);
    const departure = await this.settings.number('search.eta_departure_minutes', 10);
    const ranked = candidates.slice(0, Math.min(input.limit ?? 20, 50));
    const items: ProCard[] = await Promise.all(
      ranked.map(async (c) => ({
        id: c.id,
        businessName: c.row.businessName,
        avatarUrl: c.row.avatarBucket && c.row.avatarKey ? await this.files.readUrl({ bucket: c.row.avatarBucket, objectKey: c.row.avatarKey }) : null,
        verified: true as const,
        distanceM: c.distanceM === null ? null : Math.round(c.distanceM),
        etaMinutes: input.mode === 'URGENT' && c.distanceM !== null ? etaMinutes(c.distanceM, speed, departure) : null,
        locationPrecision: c.row.source ?? 'ZONE',
        // Une note n'est affichée qu'à partir de quelques avis vérifiés.
        ratingAvg: c.ratingCount >= MIN_RATINGS ? Math.round(c.ratingAvg * 10) / 10 : null,
        ratingCount: c.ratingCount,
        missionsCompleted: c.missionsCompleted,
        indicativePriceXof: c.row.indicativePriceXof === null ? null : Number(c.row.indicativePriceXof),
        isOnline: c.isOnline,
      })),
    );

    const step = rule?.radiusStepM ?? 5000;
    const suggestions: Suggestion[] = [];
    let nextRadiusM: number | null = null;
    if (items.length === 0) {
      if (radius < max) {
        suggestions.push('WIDEN_RADIUS');
        nextRadiusM = Math.min(radius + step, max);
      }
      suggestions.push(input.mode === 'URGENT' ? 'SCHEDULE' : 'CHANGE_SLOT');
    }
    return { mode: input.mode, radiusM: radius, maxRadiusM: max, zoneName: zone?.name ?? null, items, suggestions, nextRadiusM };
  }
}
