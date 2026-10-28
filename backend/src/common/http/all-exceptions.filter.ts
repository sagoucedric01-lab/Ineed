import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppError, type ApiErrorBody, DEFAULT_MESSAGES } from './api-error.js';

/**
 * Convertit toute erreur en réponse JSON au format ApiErrorBody.
 * Les erreurs inattendues sont journalisées avec leur pile, mais leur détail n'est jamais renvoyé au client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Erreurs');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request & { id?: string }>();
    const res = http.getResponse<Response>();
    const requestId = typeof req.id === 'string' ? req.id : undefined;
    const { status, body } = toApiError(exception);
    if (status >= 500) this.logger.error({ err: exception, requestId }, 'Erreur non gérée');
    res.status(status).json({ error: { ...body.error, ...(requestId ? { requestId } : {}) } } satisfies ApiErrorBody);
  }
}

export function toApiError(exception: unknown): { status: number; body: ApiErrorBody } {
  if (exception instanceof AppError) {
    const details = exception.details === undefined ? {} : { details: exception.details };
    return { status: exception.status, body: { error: { code: exception.code, message: exception.message, ...details } } };
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const fallback = DEFAULT_MESSAGES[status] ?? DEFAULT_MESSAGES[status >= 500 ? 500 : 400]!;
    const response = exception.getResponse();
    // Les exceptions Nest standard ont un message technique en anglais : on garde le message français par défaut
    // et on transmet les détails de validation éventuels.
    const details = typeof response === 'object' && response && 'message' in response && Array.isArray(response.message)
      ? { details: response.message }
      : {};
    return { status, body: { error: { ...fallback, ...details } } };
  }
  return { status: 500, body: { error: { ...DEFAULT_MESSAGES[500]! } } };
}
