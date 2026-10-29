import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { MissionsModule } from '../missions/missions.module.js';
import { SearchModule } from '../search/search.module.js';
import { DispatchService } from './dispatch.service.js';
import { OffersService } from './offers.service.js';
import { ProOffersController } from './pro-offers.controller.js';

@Module({ imports: [SearchModule, MissionsModule, FilesModule], controllers: [ProOffersController], providers: [DispatchService, OffersService], exports: [DispatchService, OffersService] })
export class DispatchModule {}
