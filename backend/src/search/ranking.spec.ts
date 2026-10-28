import { describe, expect, it } from 'vitest';
import { type Candidate, etaMinutes, rank, score } from './ranking.js';

const base: Candidate = { id: 'a', distanceM: 1000, ratingAvg: 0, ratingCount: 0, offersReceived: 0, offersAccepted: 0, missionsCompleted: 0, cancellationsByPro: 0, isOnline: false };

describe('classement des professionnels', () => {
  it('à profil égal, le plus proche passe devant', () => {
    const near = { ...base, id: 'near', distanceM: 500 };
    const far = { ...base, id: 'far', distanceM: 4000 };
    expect(rank([far, near], 5000).map((c) => c.id)).toEqual(['near', 'far']);
  });

  it('une note vérifiée et un bon taux d’acceptation peuvent compenser un peu de distance', () => {
    const good = { ...base, id: 'good', distanceM: 1500, ratingAvg: 4.9, ratingCount: 30, offersReceived: 40, offersAccepted: 38, missionsCompleted: 30 };
    const poor = { ...base, id: 'poor', distanceM: 1000, ratingAvg: 2.5, ratingCount: 30, offersReceived: 40, offersAccepted: 8, missionsCompleted: 10, cancellationsByPro: 10 };
    expect(rank([poor, good], 5000).map((c) => c.id)).toEqual(['good', 'poor']);
  });

  it('une seule note n’est pas significative : valeur neutre', () => {
    const oneBad = { ...base, ratingAvg: 1, ratingCount: 1 };
    expect(score(oneBad, 5000)).toBe(score(base, 5000));
  });

  it('les annulations du professionnel pénalisent', () => {
    const reliable = { ...base, id: 'r', missionsCompleted: 20 };
    const cancels = { ...base, id: 'c', missionsCompleted: 10, cancellationsByPro: 10 };
    expect(score(reliable, 5000)).toBeGreaterThan(score(cancels, 5000));
  });

  it('un professionnel sans position connue est classé au bord du rayon', () => {
    const unknown = { ...base, id: 'u', distanceM: null };
    const atEdge = { ...base, id: 'e', distanceM: 5000 };
    expect(score(unknown, 5000)).toBe(score(atEdge, 5000));
  });

  it('délai d’arrivée : préparation + trajet, arrondi à 5 minutes', () => {
    expect(etaMinutes(3000, 18, 10)).toBe(20);
    expect(etaMinutes(0, 18, 0)).toBe(5);
    expect(etaMinutes(9000, 18, 10)).toBe(40);
  });
});
