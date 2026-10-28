import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module.js';
import { ENV, type Env } from './config/env.js';
import { loggerParams } from './common/http/logger.config.js';
import { InfraModule } from './infra/infra.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerParams(env) }),
    InfraModule,
    HealthModule,
  ],
})
export class AppModule {}
