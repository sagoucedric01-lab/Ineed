import { describe, expect, it } from 'vitest';
import { detectContactSharing } from './contact-filter.js';

describe('repérage des coordonnées dans un message', () => {
  it.each([
    'Appelez-moi au 07 08 09 10 11',
    'mon numéro : +225 0708091011',
    '07.08.09.10.11',
    'écris sur whatsapp',
    'koffi.plombier@gmail.com',
    'Joignez-moi au +33 6 12 34 56 78',
  ])('averti : « %s »', (t) => expect(detectContactSharing(t)).toBe(true));

  it.each([
    'J’arrive dans 15 min',
    'Le devis est de 15 000 F CFA',
    'Mission IN-2026-000042, rendez-vous à 10 h 30',
    'Référence INP2026000001ABCD',
    '',
  ])('pas d’avertissement : « %s »', (t) => expect(detectContactSharing(t)).toBe(false));
});
