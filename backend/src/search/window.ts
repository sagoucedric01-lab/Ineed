import { AppError } from '../common/http/api-error.js';
import { BUSINESS_TIME_ZONE } from '../common/time/business-time.js';

export interface TimeWindow {
  start: Date;
  end: Date;
}

export interface WindowRules {
  minLeadMinutes: number;
  maxDays: number;
}

const MAX_WINDOW_HOURS = 12;

function localDay(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('fr-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/**
 * Créneau d'une intervention programmée : dans le futur (délai minimal), pas trop loin, sur une seule journée
 * (heure locale de la ville), d'une durée raisonnable.
 */
export function checkWindow(w: TimeWindow, rules: WindowRules, now = new Date(), timeZone = BUSINESS_TIME_ZONE): void {
  if (Number.isNaN(w.start.getTime()) || Number.isNaN(w.end.getTime()) || w.end <= w.start) {
    throw new AppError(422, 'WINDOW_INVALID', 'L’heure de fin du créneau doit être après l’heure de début.');
  }
  if (w.start.getTime() < now.getTime() + rules.minLeadMinutes * 60_000) {
    throw new AppError(422, 'WINDOW_TOO_SOON', `Le créneau doit commencer au moins ${rules.minLeadMinutes} minutes après maintenant. Pour une urgence, choisissez « Intervention immédiate ».`);
  }
  if (w.start.getTime() > now.getTime() + rules.maxDays * 86_400_000) {
    throw new AppError(422, 'WINDOW_TOO_FAR', `Une intervention se programme au plus ${rules.maxDays} jours à l’avance.`);
  }
  if (w.end.getTime() - w.start.getTime() > MAX_WINDOW_HOURS * 3_600_000 || localDay(w.start, timeZone) !== localDay(new Date(w.end.getTime() - 1), timeZone)) {
    throw new AppError(422, 'WINDOW_INVALID', 'Le créneau doit tenir dans une même journée.');
  }
}
