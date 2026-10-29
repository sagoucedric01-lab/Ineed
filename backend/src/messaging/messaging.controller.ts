import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { CurrentUser } from '../auth/decorators.js';
import { MessagesQueryDto, OpenConversationDto, ReportDto, SendMessageDto } from './dto.js';
import { MessagingService } from './messaging.service.js';
import { ReportsService } from './reports.service.js';

/** Messagerie : mêmes routes pour Ineed et Ineed Pro ; le rôle dépend de l'application de la session. */
@ApiTags('Messagerie')
@ApiBearerAuth()
@Controller('v1/conversations')
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Get()
  @ApiOperation({ summary: 'Mes conversations (dernier message, non lus, écriture possible)' })
  list(@CurrentUser() user: AuthUser) {
    return this.messaging.list(user.userId, user.app);
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthUser) {
    return { unread: await this.messaging.unreadTotal(user.userId, user.app) };
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Ouvrir la conversation d’une demande (professionnel ayant accepté, ou mission confirmée)' })
  open(@CurrentUser() user: AuthUser, @Body() dto: OpenConversationDto) {
    return this.messaging.open(user.userId, user.app, dto.requestId, dto.proId);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.get(user.userId, user.app, id);
  }

  @Get(':id/messages')
  @ApiOperation({ summary: 'Messages (50 par page, du plus ancien au plus récent)' })
  messages(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: MessagesQueryDto) {
    return this.messaging.messages(user.userId, user.app, id, q.before ? new Date(q.before) : undefined);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Envoyer un message ou une photo ; renvoyer le même clientMsgId ne crée pas de doublon' })
  send(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SendMessageDto) {
    return this.messaging.send(user.userId, user.app, id, dto);
  }

  @Post(':id/read')
  @HttpCode(204)
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.messaging.markRead(user.userId, user.app, id);
  }
}

@ApiTags('Signalements')
@ApiBearerAuth()
@Controller('v1/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post()
  @ApiOperation({ summary: 'Signaler un abus (message, utilisateur, profil, avis, demande) à la modération' })
  create(@CurrentUser() user: AuthUser, @Body() dto: ReportDto) {
    return this.reports.create(user.userId, user.app, dto);
  }
}
