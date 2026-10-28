import { type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { ENV, type Env } from './config/env.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { validationPipe } from './common/http/validation.js';
import { buildOpenApiDocument } from './swagger.js';

/** Construit l'application HTTP configurée (utilisé par main.ts et par les tests). */
export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const env = app.get<Env>(ENV);
  // Nombre de proxys de confiance (reverse proxy TLS) pour lire l'IP réelle du client (limitation de débit, audit).
  app.set('trust proxy', env.TRUST_PROXY_HOPS);
  app.useLogger(app.get(Logger));
  app.use(helmet());
  app.enableCors({ origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : false, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(validationPipe);
  app.enableShutdownHooks();
  if (env.SWAGGER_ENABLED) {
    SwaggerModule.setup('docs', app, buildOpenApiDocument(app), { jsonDocumentUrl: 'docs/openapi.json' });
  }
  return app;
}
