import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { MissionsModule } from '../missions/missions.module.js';
import { AdminComplaintsController, ComplaintsController } from './complaints.controller.js';
import { ComplaintsService } from './complaints.service.js';

@Module({ imports: [MissionsModule, FilesModule], controllers: [ComplaintsController, AdminComplaintsController], providers: [ComplaintsService] })
export class ComplaintsModule {}
