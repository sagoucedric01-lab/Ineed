import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { loggerParams } from './common/http/logger.config.js';
import { FilesModule } from './files/files.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { ProsModule } from './pros/pros.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    InfraModule,
    SettingsModule,
    AuditModule,
    NotificationsModule,
    AuthModule,
    FilesModule,
    UsersModule,
    CatalogModule,
    ProsModule,
    AdminAuthModule,
    HealthModule,
  ],
})
export class AppModule {}
