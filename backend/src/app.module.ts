import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './common/idempotency/idempotency.js';
import { LoggerModule } from 'nestjs-pino';
import { AddressesModule } from './addresses/addresses.module.js';
import { AdminAuthModule } from './admin-auth/admin-auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AuthModule } from './auth/auth.module.js';
import { BillingModule } from './billing/billing.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { ComplaintsModule } from './complaints/complaints.module.js';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { loggerParams } from './common/http/logger.config.js';
import { DispatchModule } from './dispatch/dispatch.module.js';
import { FilesModule } from './files/files.module.js';
import { GeoModule } from './geo/geo.module.js';
import { HealthModule } from './health/health.module.js';
import { InfraModule } from './infra/infra.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { MissionsModule } from './missions/missions.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { ProsModule } from './pros/pros.module.js';
import { QuotesModule } from './quotes/quotes.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RequestsModule } from './requests/requests.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { SearchModule } from './search/search.module.js';
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
    BillingModule,
    AuthModule,
    FilesModule,
    UsersModule,
    GeoModule,
    AddressesModule,
    CatalogModule,
    SearchModule,
    RequestsModule,
    DispatchModule,
    MissionsModule,
    QuotesModule,
    PaymentsModule,
    RealtimeModule,
    MessagingModule,
    ReviewsModule,
    ComplaintsModule,
    ProsModule,
    AdminAuthModule,
    HealthModule,
  ],
  providers: [{ provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class AppModule {}
