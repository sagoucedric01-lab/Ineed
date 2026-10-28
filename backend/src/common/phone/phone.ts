import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

/**
 * Numéros de téléphone. Stockage en E.164 (+2250712345678) ; saisie souple
 * (« 07 12 34 56 78 », « +225 0712345678 », « 00225… »). Pays par défaut : Côte d'Ivoire.
 */
export class InvalidPhoneError extends Error {
  constructor(readonly input: string) {
    super('Ce numéro n’est pas valide. Un numéro ivoirien compte 10 chiffres, par exemple 07 12 34 56 78.');
    this.name = 'InvalidPhoneError';
  }
}

export function normalizePhone(input: string, defaultCountry: 'CI' = 'CI'): string {
  const cleaned = input.trim().replace(/^00/, '+');
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry);
  if (!parsed || !parsed.isValid()) throw new InvalidPhoneError(input);
  const type = parsed.getType();
  // Les codes de connexion sont envoyés par SMS : on exige un mobile quand le type est connu.
  if (parsed.country === 'CI' && type !== undefined && type !== 'MOBILE' && type !== 'FIXED_LINE_OR_MOBILE') {
    throw new InvalidPhoneError(input);
  }
  return parsed.number;
}

/** Affichage : « +225 07 12 34 56 78 ». */
export function formatPhone(e164: string): string {
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return e164;
  if (parsed.countryCallingCode === '225') {
    const national = parsed.nationalNumber.toString();
    return `+225 ${national.replace(/(\d{2})(?=\d)/g, '$1 ')}`;
  }
  return parsed.formatInternational();
}
