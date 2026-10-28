import { describe, expect, it } from 'vitest';
import { matchScore, normalize } from './normalize.js';

describe('recherche dans le catalogue', () => {
  it('ignore accents, majuscules et apostrophes', () => {
    expect(normalize('Électricité')).toBe('electricite');
    expect(normalize('Chasse d’eau')).toBe('chasse d eau');
  });

  it('trouve un métier par le début d’un mot, quel que soit l’ordre', () => {
    expect(matchScore('plomb', 'Plomberie')).toBeGreaterThan(0);
    expect(matchScore('electricite', 'Électricité')).toBe(100);
    expect(matchScore('eau fuite', 'Fuite d’eau')).toBeGreaterThan(0);
    expect(matchScore('clim', 'entretien clim')).toBeGreaterThan(0);
  });

  it('ne trouve pas un mot au milieu d’un autre', () => {
    expect(matchScore('erie', 'Plomberie')).toBe(0);
    expect(matchScore('', 'Plomberie')).toBe(0);
  });

  it('classe la correspondance exacte avant le préfixe, avant le mot', () => {
    expect(matchScore('fuite', 'fuite')).toBeGreaterThan(matchScore('fuite', 'fuite d’eau'));
    expect(matchScore('fuite', 'fuite d’eau')).toBeGreaterThan(matchScore('fuite', 'grosse fuite'));
  });
});
