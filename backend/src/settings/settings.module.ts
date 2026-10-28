import { Global, Module } from '@nestjs/common';
import { AdminSettingsController } from './admin-settings.controller.js';
import { DispatchRulesService } from './dispatch-rules.service.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({ controllers: [AdminSettingsController], providers: [SettingsService, DispatchRulesService], exports: [SettingsService, DispatchRulesService] })
export class SettingsModule {}
