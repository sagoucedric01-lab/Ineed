/** Fuseau horaire métier du marché initial. Les dates sont stockées en UTC (timestamptz). */
export const BUSINESS_TIME_ZONE = 'Africa/Abidjan';

const dateFmt = (timeZone: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = (timeZone: string) =>
  new Intl.DateTimeFormat('fr-FR', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** « 28/10/2026 à 10:23 », dans le fuseau de la ville concernée (Abidjan par défaut). */
export function formatDateTime(date: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return `${dateFmt(timeZone).format(date)} à ${timeFmt(timeZone).format(date)}`;
}

export function formatDate(date: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return dateFmt(timeZone).format(date);
}

export function formatTime(date: Date, timeZone: string = BUSINESS_TIME_ZONE): string {
  return timeFmt(timeZone).format(date);
}
