import { Module } from '@nestjs/common';
import { AdminCatalogController } from './admin-catalog.controller.js';
import { CatalogController } from './catalog.controller.js';
import { CatalogService } from './catalog.service.js';

@Module({ controllers: [CatalogController, AdminCatalogController], providers: [CatalogService], exports: [CatalogService] })
export class CatalogModule {}
