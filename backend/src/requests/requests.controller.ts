import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, AdminOnly, CurrentUser } from '../auth/decorators.js';
import { AdminListRequestsQueryDto, CancelRequestDto, ListRequestsQueryDto, RequestInputDto } from './dto.js';
import { RequestsService } from './requests.service.js';

@ApiTags('Demandes')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/requests')
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Crée un brouillon de demande (à relire puis publier)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: RequestInputDto) {
    return this.requests.create(user.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Mes demandes (en cours ou terminées)' })
  list(@CurrentUser() user: AuthUser, @Query() q: ListRequestsQueryDto) {
    return this.requests.list(user.userId, q.scope, q.page);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(user.userId, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Remplace le contenu d’un brouillon' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RequestInputDto) {
    return this.requests.update(user.userId, id, dto);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publie la demande après relecture (métier actif, lieu desservi, créneau valide si programmée)' })
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.publish(user.userId, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Annule une demande tant qu’aucun professionnel n’est réservé' })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRequestDto) {
    return this.requests.cancel(user.userId, id, dto.reason);
  }
}

@ApiTags('Administration — demandes')
@ApiBearerAuth()
@Controller('v1/admin/requests')
export class AdminRequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @AdminOnly('request.read')
  list(@Query() q: AdminListRequestsQueryDto) {
    return this.requests.adminList(q.status, q.page ?? 1, q.pageSize ?? 20);
  }

  @Get(':id')
  @AdminOnly('request.read')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.requests.adminGet(id);
  }
}
