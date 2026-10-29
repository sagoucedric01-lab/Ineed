import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, AdminOnly, CurrentUser } from '../auth/decorators.js';
import type { MissionStatus } from '../generated/prisma/client.js';
import { AdminListMissionsQueryDto, CompleteMissionDto, ListMissionsQueryDto, LocationBatchDto, MissionReasonDto, RequiredReasonDto } from './dto.js';
import { MissionsService } from './missions.service.js';

const ACTIVE: MissionStatus[] = ['AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'EN_ROUTE', 'ARRIVED', 'IN_PROGRESS', 'WORK_COMPLETED', 'DISPUTED'];
const scopeFilter = (scope?: 'active' | 'history') => ({ status: scope === 'history' ? { in: ['CLOSED', 'CANCELLED'] as MissionStatus[] } : { in: ACTIVE } });

@ApiTags('Missions')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/missions')
export class ClientMissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListMissionsQueryDto) {
    return this.missions.list({ clientId: user.userId, ...scopeFilter(q.scope) }, q.page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Suivi de la mission : étapes, position du professionnel pendant le trajet, conditions d’annulation' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.getForClient(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annuler (gratuit avant le départ du professionnel ; impossible une fois les travaux commencés)' })
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MissionReasonDto) {
    await this.missions.transition(id, 'CANCELLED', 'CLIENT', user.userId, { reason: dto.reason });
    return this.missions.getForClient(user.userId, id);
  }

  @Post(':id/confirm-completion')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmer la fin de l’intervention (clôture la mission)' })
  async confirmCompletion(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.missions.transition(id, 'CLOSED', 'CLIENT', user.userId);
    return this.missions.getForClient(user.userId, id);
  }

  @Post(':id/problem')
  @HttpCode(200)
  @ApiOperation({ summary: 'Signaler un problème (litige examiné par l’équipe Ineed)' })
  async problem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredReasonDto) {
    await this.missions.transition(id, 'DISPUTED', 'CLIENT', user.userId, { reason: dto.reason });
    return this.missions.getForClient(user.userId, id);
  }
}

@ApiTags('Professionnel — missions')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro/missions')
export class ProMissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: ListMissionsQueryDto) {
    return this.missions.list({ proId: user.userId, ...scopeFilter(q.scope) }, q.page);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Mission : adresse précise, indications et prénom du client' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.missions.getForPro(user.userId, id);
  }

  private async act(user: AuthUser, id: string, to: MissionStatus, opts: { reason?: string; report?: string } = {}) {
    await this.missions.transition(id, to, 'PRO', user.userId, opts);
    return this.missions.getForPro(user.userId, id);
  }

  @Post(':id/depart')
  @HttpCode(200)
  @ApiOperation({ summary: '« Je pars » : le client est prévenu et suit le trajet' })
  depart(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.act(user, id, 'EN_ROUTE');
  }

  @Post(':id/arrive')
  @HttpCode(200)
  arrive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.act(user, id, 'ARRIVED');
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.act(user, id, 'IN_PROGRESS');
  }

  @Post(':id/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Terminer l’intervention (le client confirme ; sinon clôture automatique)' })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CompleteMissionDto) {
    return this.act(user, id, 'WORK_COMPLETED', { report: dto.report });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Se désister (compte dans le taux de fiabilité ; la demande repart en recherche)' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredReasonDto) {
    return this.act(user, id, 'CANCELLED', { reason: dto.reason });
  }

  @Post(':id/locations')
  @HttpCode(200)
  @ApiOperation({ summary: 'Positions du trajet (uniquement en route ; doublons ignorés)' })
  locations(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LocationBatchDto) {
    return this.missions.recordLocations(user.userId, id, dto.points.map((p) => ({ ...p, recordedAt: new Date(p.recordedAt) })));
  }
}

@ApiTags('Administration — missions')
@ApiBearerAuth()
@Controller('v1/admin/missions')
export class AdminMissionsController {
  constructor(private readonly missions: MissionsService) {}

  @Get()
  @AdminOnly('mission.read')
  list(@Query() q: AdminListMissionsQueryDto) {
    return this.missions.list(q.status ? { status: q.status as MissionStatus } : {}, q.page);
  }

  @Get(':id')
  @AdminOnly('mission.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.missions.getForAdmin(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AdminOnly('mission.intervene')
  async cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredReasonDto) {
    await this.missions.transition(id, 'CANCELLED', 'ADMIN', user.userId, { reason: dto.reason });
    return this.missions.getForAdmin(id);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @AdminOnly('mission.intervene')
  @ApiOperation({ summary: 'Clore un litige (le remboursement éventuel relève du module de paiement)' })
  async resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequiredReasonDto) {
    await this.missions.transition(id, 'CLOSED', 'ADMIN', user.userId, { reason: dto.reason });
    return this.missions.getForAdmin(id);
  }
}
