import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module.js';
import { MessagingController, ReportsController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';
import { ReportsService } from './reports.service.js';

@Module({ imports: [FilesModule], controllers: [MessagingController, ReportsController], providers: [MessagingService, ReportsService], exports: [MessagingService] })
export class MessagingModule {}
