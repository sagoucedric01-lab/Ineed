import { describe, expect, it } from 'vitest';
import { formatPhone, InvalidPhoneError, normalizePhone } from './phone.js';

describe('normalizePhone', () => {
  it.each([
    '07 12 34 56 78',
    '0712345678',
    '+225 07 12 34 56 78',
    '+2250712345678',
    '00225 0712345678',
    ' 07-12-34-56-78 ',
  ])('« %s » -> +2250712345678', (input) => {
    expect(normalizePhone(input)).toBe('+2250712345678');
  });

  it('accepte les mobiles des trois opérateurs (01 Moov, 05 MTN, 07 Orange)', () => {
    expect(normalizePhone('01 02 03 04 05')).toBe('+2250102030405');
    expect(normalizePhone('05 06 07 08 09')).toBe('+2250506070809');
  });

  it.each(['12345', '07 12 34', '0712345678901', 'abc', '+225 27 22 44 55 66'])('refuse « %s »', (input) => {
    expect(() => normalizePhone(input)).toThrow(InvalidPhoneError);
  });

  it('accepte un numéro étranger écrit au format international', () => {
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
  });
});

describe('formatPhone', () => {
  it('affiche les numéros ivoiriens par paires', () => {
    expect(formatPhone('+2250712345678')).toBe('+225 07 12 34 56 78');
  });
});
