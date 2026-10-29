import { Module } from '@nestjs/common';
import { MissionsModule } from '../missions/missions.module.js';
import { ClientQuotesController, ProQuotesController } from './quotes.controller.js';
import { QuotesService } from './quotes.service.js';

@Module({ imports: [MissionsModule], controllers: [ClientQuotesController, ProQuotesController], providers: [QuotesService], exports: [QuotesService] })
export class QuotesModule {}
