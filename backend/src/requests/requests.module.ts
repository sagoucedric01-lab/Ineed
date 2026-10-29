import { Module } from '@nestjs/common';
import { AddressesModule } from '../addresses/addresses.module.js';
import { DispatchModule } from '../dispatch/dispatch.module.js';
import { FilesModule } from '../files/files.module.js';
import { GeoModule } from '../geo/geo.module.js';
import { SearchModule } from '../search/search.module.js';
import { AdminRequestsController, RequestsController } from './requests.controller.js';
import { RequestsService } from './requests.service.js';

@Module({ imports: [AddressesModule, DispatchModule, FilesModule, GeoModule, SearchModule], controllers: [RequestsController, AdminRequestsController], providers: [RequestsService] })
export class RequestsModule {}
