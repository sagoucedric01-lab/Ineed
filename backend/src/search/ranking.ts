/** Données d'un professionnel admissible, utilisées pour le classement. */
export interface Candidate {
  id: string;
  distanceM: number | null;
  ratingAvg: number;
  ratingCount: number;
  offersReceived: number;
  offersAccepted: number;
  missionsCompleted: number;
  cancellationsByPro: number;
  isOnline: boolean;
}

/** En dessous de ces volumes, la note et le taux d'acceptation ne sont pas significatifs : valeur neutre. */
export const MIN_RATINGS = 3;
export const MIN_OFFERS = 5;
const NEUTRAL_RATING = 0.6;
const NEUTRAL_ACCEPTANCE = 0.7;

/**
 * Score entre 0 et 1 : distance (50 %), note vérifiée (20 %), taux d'acceptation (15 %), annulations (15 %),
 * plus un bonus si le professionnel est disponible maintenant. Un professionnel sans position connue
 * (rattaché à la commune) est classé comme s'il était au bord du rayon.
 */
export function score(c: Candidate, radiusM: number): number {
  const distance = c.distanceM === null ? 0 : Math.max(0, 1 - c.distanceM / Math.max(radiusM, 1));
  const rating = c.ratingCount >= MIN_RATINGS ? c.ratingAvg / 5 : NEUTRAL_RATING;
  const acceptance = c.offersReceived >= MIN_OFFERS ? c.offersAccepted / c.offersReceived : NEUTRAL_ACCEPTANCE;
  const done = c.missionsCompleted + c.cancellationsByPro;
  const reliability = done >= MIN_OFFERS ? 1 - c.cancellationsByPro / done : NEUTRAL_ACCEPTANCE;
  return 0.5 * distance + 0.2 * rating + 0.15 * acceptance + 0.15 * reliability + (c.isOnline ? 0.05 : 0);
}

export function rank<T extends Candidate>(candidates: T[], radiusM: number): T[] {
  return [...candidates]
    .map((c) => ({ c, s: score(c, radiusM) }))
    .sort((a, b) => b.s - a.s || (a.c.distanceM ?? Infinity) - (b.c.distanceM ?? Infinity) || a.c.id.localeCompare(b.c.id))
    .map((x) => x.c);
}

/** Délai d'arrivée estimé (minutes, arrondi à 5) : préparation + trajet à vitesse urbaine moyenne. */
export function etaMinutes(distanceM: number, speedKmh: number, departureMinutes: number): number {
  const travel = (distanceM / 1000 / Math.max(speedKmh, 1)) * 60;
  return Math.max(5, Math.ceil((departureMinutes + travel) / 5) * 5);
}
