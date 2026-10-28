import { describe, expect, it } from 'vitest';
import { formatDateTime } from './business-time.js';

describe('formatDateTime', () => {
  it('affiche l’heure d’Abidjan (UTC+0, sans heure d’été)', () => {
    expect(formatDateTime(new Date('2026-10-28T10:23:00Z'))).toBe('28/10/2026 à 10:23');
    expect(formatDateTime(new Date('2026-07-01T23:59:00Z'))).toBe('01/07/2026 à 23:59');
  });

  it('respecte le fuseau d’une autre ville', () => {
    expect(formatDateTime(new Date('2026-10-28T10:23:00Z'), 'Africa/Lagos')).toBe('28/10/2026 à 11:23');
  });
});
