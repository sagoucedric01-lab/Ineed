import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { AdminMissionsController, ClientMissionsController, ProMissionsController } from './missions.controller.js';
import { MissionsService } from './missions.service.js';

@Module({ imports: [FilesModule], controllers: [ClientMissionsController, ProMissionsController, AdminMissionsController], providers: [MissionsService], exports: [MissionsService] })
export class MissionsModule {}
