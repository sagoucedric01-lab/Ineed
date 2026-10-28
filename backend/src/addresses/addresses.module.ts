import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module.js';
import { AddressesController } from './addresses.controller.js';
import { AddressesService } from './addresses.service.js';

@Module({ imports: [GeoModule], controllers: [AddressesController], providers: [AddressesService], exports: [AddressesService] })
export class AddressesModule {}
