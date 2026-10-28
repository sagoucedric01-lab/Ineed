import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import type { Env } from '../../config/env.js';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Reprend l'identifiant de requête fourni par le proxy s'il est sûr, sinon en génère un. */
export function requestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers['x-request-id'];
  const id = typeof incoming === 'string' && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', id);
  return id;
}

/** Journaux JSON structurés ; les secrets et données personnelles sont masqués. */
export function loggerParams(env: Env): Params {
  return {
    pinoHttp: {
      level: env.LOG_LEVEL,
      genReqId: requestId,
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          'req.body.code',
          'req.body.password',
          'req.body.phone',
        ],
        censor: '[masqué]',
      },
      autoLogging: { ignore: (req) => req.url?.startsWith('/health/') ?? false },
      customProps: () => ({ appEnv: env.APP_ENV }),
      transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
