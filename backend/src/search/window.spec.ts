import { describe, expect, it } from 'vitest';
import { checkWindow } from './window.js';

const now = new Date('2026-10-28T10:00:00Z');
const rules = { minLeadMinutes: 60, maxDays: 30 };
const w = (start: string, end: string) => ({ start: new Date(start), end: new Date(end) });

describe('créneau d’intervention programmée', () => {
  it('accepte un créneau demain matin', () => {
    expect(() => checkWindow(w('2026-10-29T08:00:00Z', '2026-10-29T12:00:00Z'), rules, now)).not.toThrow();
  });

  it('refuse un créneau trop proche, inversé, trop lointain ou sur deux jours', () => {
    expect(() => checkWindow(w('2026-10-28T10:30:00Z', '2026-10-28T12:00:00Z'), rules, now)).toThrow(/au moins 60 minutes/);
    expect(() => checkWindow(w('2026-10-29T12:00:00Z', '2026-10-29T08:00:00Z'), rules, now)).toThrow(/après l’heure de début/);
    expect(() => checkWindow(w('2026-12-15T08:00:00Z', '2026-12-15T10:00:00Z'), rules, now)).toThrow(/30 jours/);
    expect(() => checkWindow(w('2026-10-29T20:00:00Z', '2026-10-30T02:00:00Z'), rules, now)).toThrow(/même journée/);
  });

  it('un créneau qui finit à minuit pile reste sur la journée', () => {
    expect(() => checkWindow(w('2026-10-29T18:00:00Z', '2026-10-30T00:00:00Z'), rules, now)).not.toThrow();
  });
});
