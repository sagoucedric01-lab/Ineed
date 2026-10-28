import { type ValidationError, ValidationPipe } from '@nestjs/common';
import { AppError } from './api-error.js';

function flatten(errors: ValidationError[], parent = ''): { field: string; rules: string[] }[] {
  return errors.flatMap((e) => {
    const field = parent ? `${parent}.${e.property}` : e.property;
    const own = e.constraints ? [{ field, rules: Object.keys(e.constraints) }] : [];
    return [...own, ...flatten(e.children ?? [], field)];
  });
}

/**
 * Validation des corps de requête : champs inconnus refusés, types convertis.
 * Les erreurs donnent la liste des champs fautifs (`details`) avec un message français générique.
 */
export const validationPipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new AppError(422, 'VALIDATION_FAILED', 'Certaines informations sont incomplètes ou invalides.', flatten(errors)),
});
