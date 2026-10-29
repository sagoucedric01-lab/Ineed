/**
 * Repère un numéro de téléphone ou une adresse e-mail dans un message. Le message est envoyé quand même, mais
 * l'expéditeur est averti : rester sur Ineed protège le paiement, l'assurance du suivi et les recours.
 */
// Numéros ivoiriens à 10 chiffres (01, 05, 07, 21, 25, 27…), avec ou sans +225, et tout numéro international.
const PHONE_CI = /(?<![\w-])(?:(?:\+|00)225[\s.-]*)?0[1-9](?:[\s.-]?\d){8}(?!\d)/;
const PHONE_INTL = /(?:\+|\b00)\d(?:[\s.-]?\d){7,13}(?!\d)/;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const WHATSAPP = /\bwh?ats?\s?app\b|\bwa\.me\b/i;

export function detectContactSharing(text: string | null | undefined): boolean {
  if (!text) return false;
  return PHONE_CI.test(text) || PHONE_INTL.test(text) || EMAIL.test(text) || WHATSAPP.test(text);
}
