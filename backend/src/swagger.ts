import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('API Ineed')
    .setDescription(
      'API de la marketplace Ineed (Abidjan). Montants en XOF entiers, dates ISO 8601 en UTC, ' +
        'téléphones au format E.164. Les erreurs suivent le format { error: { code, message, details, requestId } }.',
    )
    .setVersion('0.4.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
    .build();
  return SwaggerModule.createDocument(app, config);
}
