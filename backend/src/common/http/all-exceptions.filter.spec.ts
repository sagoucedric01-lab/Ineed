import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from './api-error.js';
import { toApiError } from './all-exceptions.filter.js';

describe('toApiError', () => {
  it('conserve le code et le message d’une erreur métier', () => {
    const r = toApiError(new AppError(409, 'REQUEST_ALREADY_TAKEN', 'Cette demande vient d’être attribuée à un autre professionnel.'));
    expect(r).toEqual({ status: 409, body: { error: { code: 'REQUEST_ALREADY_TAKEN', message: 'Cette demande vient d’être attribuée à un autre professionnel.' } } });
  });

  it('remplace le message anglais des exceptions Nest par un message français', () => {
    const r = toApiError(new NotFoundException('Cannot GET /x'));
    expect(r.status).toBe(404);
    expect(r.body.error.message).toBe('Cet élément n’existe plus ou a été supprimé.');
  });

  it('transmet les détails de validation', () => {
    const r = toApiError(new BadRequestException(['phone must be a string']));
    expect(r.body.error.details).toEqual(['phone must be a string']);
  });

  it('ne divulgue jamais le détail d’une erreur inattendue', () => {
    const r = toApiError(new Error('password=secret at db.ts:12'));
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('secret');
  });
});
