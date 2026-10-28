/** Fournisseur de codes de vérification par SMS. */
export interface OtpProvider {
  readonly name: 'dev_console' | 'twilio_verify';
  /** Vrai si aucun SMS réel n'est envoyé : l'application affiche alors un bandeau « Mode développement ». */
  readonly isDevelopment: boolean;
  /** Envoie un code ; retourne soit l'empreinte du code (codes générés par Ineed), soit la référence du fournisseur. */
  start(phone: string): Promise<{ codeHash?: string; providerRef?: string }>;
  check(phone: string, code: string, stored: { codeHash: string | null; providerRef: string | null }): Promise<boolean>;
}

export const OTP_PROVIDER = Symbol('OTP_PROVIDER');
