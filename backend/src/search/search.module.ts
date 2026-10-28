import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { ProSearchService } from './pro-search.service.js';
import { PublicProfilesService } from './public-profiles.service.js';
import { SearchController } from './search.controller.js';

@Module({ imports: [GeoModule, FilesModule], controllers: [SearchController], providers: [ProSearchService, PublicProfilesService], exports: [ProSearchService] })
export class SearchModule {}
