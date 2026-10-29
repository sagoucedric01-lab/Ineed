import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { AdminOnly, CurrentUser } from '../auth/decorators.js';
import { auditContext, type AppRequest } from '../common/http/request-context.js';
import { ComplaintsService } from './complaints.service.js';
import { AdminComplaintsQueryDto, ComplaintMessageDto, ComplaintStatusDto, CreateComplaintDto, SupportMessageDto } from './dto.js';

@ApiTags('Réclamations')
@ApiBearerAuth()
@Controller('v1/complaints')
export class ComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.complaints.listForUser(user.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Ouvrir une réclamation (sur une mission non clôturée : litige, reversement gelé)' })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateComplaintDto) {
    return this.complaints.create(user.userId, user.app, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.getForUser(user.userId, id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Répondre au support' })
  message(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ComplaintMessageDto) {
    return this.complaints.userMessage(user.userId, id, dto.body, dto.fileId);
  }
}

@ApiTags('Administration — réclamations')
@ApiBearerAuth()
@Controller('v1/admin/complaints')
export class AdminComplaintsController {
  constructor(private readonly complaints: ComplaintsService) {}

  @Get()
  @AdminOnly('complaint.handle')
  list(@Query() q: AdminComplaintsQueryDto) {
    return this.complaints.adminList(q.status, q.page);
  }

  @Get(':id')
  @AdminOnly('complaint.handle')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.complaints.adminGet(id);
  }

  @Post(':id/messages')
  @AdminOnly('complaint.handle')
  @ApiOperation({ summary: 'Répondre à l’utilisateur, ou ajouter une note interne (invisible pour lui)' })
  message(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportMessageDto) {
    return this.complaints.supportMessage({ ...auditContext(req), actorId: user.userId }, id, dto.body, dto.internal ?? false);
  }

  @Post(':id/status')
  @AdminOnly('complaint.handle')
  @ApiOperation({ summary: 'Changer le statut ; clore avec une décision (et le remboursement accordé s’il y en a un)' })
  status(@CurrentUser() user: AuthUser, @Req() req: AppRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ComplaintStatusDto) {
    return this.complaints.setStatus({ ...auditContext(req), actorId: user.userId }, id, dto.status, dto.resolution, dto.refundId);
  }
}
