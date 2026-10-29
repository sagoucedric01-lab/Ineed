import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser } from '../auth/decorators.js';
import { Idempotent } from '../common/idempotency/idempotency.js';
import { RejectQuoteDto, SubmitQuoteDto } from './dto.js';
import { QuotesService } from './quotes.service.js';

const idempotencyHeader = { name: 'Idempotency-Key', required: true, description: 'Clé unique par action (renvoyée telle quelle en cas de nouvel essai)' };

@ApiTags('Devis')
@ApiBearerAuth()
@Access({ app: 'CLIENT' })
@Controller('v1/missions/:missionId/quotes')
export class ClientQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  @ApiOperation({ summary: 'Devis de la mission, toutes versions' })
  list(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string) {
    return this.quotes.list(missionId, { clientId: user.userId });
  }

  @Post(':quoteId/accept')
  @HttpCode(200)
  @Idempotent()
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Accepter le devis (version courante et encore valable) : le paiement est ensuite demandé' })
  accept(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.quotes.accept(user.userId, missionId, quoteId);
  }

  @Post(':quoteId/reject')
  @HttpCode(200)
  @Idempotent()
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Refuser le devis : le professionnel peut proposer une nouvelle version' })
  reject(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Param('quoteId', ParseUUIDPipe) quoteId: string, @Body() dto: RejectQuoteDto) {
    return this.quotes.reject(user.userId, missionId, quoteId, dto.reason);
  }
}

@ApiTags('Professionnel — devis')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro/missions/:missionId/quotes')
export class ProQuotesController {
  constructor(private readonly quotes: QuotesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string) {
    return this.quotes.list(missionId, { proId: user.userId });
  }

  @Post()
  @Idempotent()
  @ApiHeader(idempotencyHeader)
  @ApiOperation({ summary: 'Envoyer un devis (ou une nouvelle version, qui remplace la précédente) ; pendant les travaux : frais supplémentaires' })
  submit(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Body() dto: SubmitQuoteDto) {
    return this.quotes.submit(user.userId, missionId, dto);
  }

  @Post(':quoteId/withdraw')
  @HttpCode(200)
  @ApiOperation({ summary: 'Retirer un devis encore sans réponse' })
  withdraw(@CurrentUser() user: AuthUser, @Param('missionId', ParseUUIDPipe) missionId: string, @Param('quoteId', ParseUUIDPipe) quoteId: string) {
    return this.quotes.withdraw(user.userId, missionId, quoteId);
  }
}
