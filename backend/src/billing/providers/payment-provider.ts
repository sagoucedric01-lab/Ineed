/**
 * Contrat commun des prestataires de paiement. Règle centrale : un paiement n'est jamais tenu pour réussi
 * sur la foi d'une application ou d'une notification ; seul `verify` (appel serveur à serveur) fait foi.
 */

export type ProviderPaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface InitiateInput {
  merchantReference: string;
  amountXof: bigint;
  description: string;
  customerPhoneE164: string | null;
  customerFirstName: string | null;
  notifyUrl: string;
  returnUrl: string;
}

export interface InitiateResult {
  checkoutUrl: string;
  providerTxnId: string | null;
}

export interface VerifyResult {
  status: ProviderPaymentStatus;
  amountXof: bigint | null;
  currency: string | null;
  providerTxnId: string | null;
  /** ORANGE_MONEY, MTN_MOMO, MOOV_MONEY, WAVE, CARD… */
  method: string | null;
  failureCode: string | null;
  failureMessage: string | null;
  raw: unknown;
}

export interface ParsedNotification {
  signatureValid: boolean;
  /** Identifiant de l'événement (ou empreinte du contenu quand le prestataire n'en fournit pas). */
  eventId: string;
  merchantReference: string | null;
  payload: Record<string, unknown>;
}

export type RefundOutcome =
  | { status: 'SUCCEEDED'; providerRefundId: string | null }
  | { status: 'FAILED'; message: string }
  /** Le prestataire n'offre pas de remboursement par API : exécution manuelle depuis son espace marchand, puis saisie dans Ineed. */
  | { status: 'MANUAL' };

export interface PaymentProvider {
  readonly name: string;
  readonly isSandbox: boolean;
  initiate(input: InitiateInput): Promise<InitiateResult>;
  verify(merchantReference: string): Promise<VerifyResult>;
  parseNotification(headers: Record<string, string | string[] | undefined>, body: unknown): ParsedNotification;
  refund(input: { merchantReference: string; providerTxnId: string | null; amountXof: bigint; refundReference: string }): Promise<RefundOutcome>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

/** Échec de communication avec le prestataire (réseau, réponse illisible) : rien n'est conclu, on réessaiera. */
export class ProviderUnavailableError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
