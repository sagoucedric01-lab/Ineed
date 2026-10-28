import { Module } from '@nestjs/common';
import { AdminGeoController } from './admin-geo.controller.js';
import { GeoController } from './geo.controller.js';
import { GeoService } from './geo.service.js';

@Module({ controllers: [GeoController, AdminGeoController], providers: [GeoService], exports: [GeoService] })
export class GeoModule {}
