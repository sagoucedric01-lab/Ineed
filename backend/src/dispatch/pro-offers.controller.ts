import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth-user.js';
import { Access, CurrentUser } from '../auth/decorators.js';
import { DispatchService } from './dispatch.service.js';
import { DeclineOfferDto, ProposalDto } from './dto.js';
import { OffersService } from './offers.service.js';

@ApiTags('Professionnel — demandes reçues')
@ApiBearerAuth()
@Access({ app: 'PRO', roles: ['PRO'] })
@Controller('v1/pro/offers')
export class ProOffersController {
  constructor(
    private readonly offers: OffersService,
    private readonly dispatch: DispatchService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Demandes en attente de ma réponse et réponses récentes' })
  list(@CurrentUser() user: AuthUser) {
    return this.offers.listForPro(user.userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d’une demande reçue (quartier et distance approximative ; l’adresse est donnée après confirmation)' })
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.offers.openForPro(user.userId, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Urgence : accepter (le premier qui accepte est réservé, le client confirme ensuite)' })
  async accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.dispatch.acceptUrgent(user.userId, id);
    return this.offers.openForPro(user.userId, id);
  }

  @Post(':id/propose')
  @HttpCode(200)
  @ApiOperation({ summary: 'Programmé : envoyer une proposition (heure d’arrivée, prix facultatif)' })
  async propose(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ProposalDto) {
    await this.dispatch.propose(user.userId, id, { ...dto, proposedStartAt: new Date(dto.proposedStartAt) });
    return this.offers.openForPro(user.userId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refuser une demande' })
  async decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeclineOfferDto) {
    await this.dispatch.decline(user.userId, id, dto.reason);
    return this.offers.openForPro(user.userId, id);
  }
}
