import { Module } from '@nestjs/common';
import { AdminProsController } from './admin-pros.controller.js';
import { AdminProsService } from './admin-pros.service.js';
import { ProController } from './pro.controller.js';
import { ProsService } from './pros.service.js';

@Module({ controllers: [ProController, AdminProsController], providers: [ProsService, AdminProsService] })
export class ProsModule {}
