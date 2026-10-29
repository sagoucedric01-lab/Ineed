import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { InitiateInput, InitiateResult, ParsedNotification, PaymentProvider, RefundOutcome, VerifyResult } from './payment-provider.js';

const KEY = (ref: string) => `ineed:sandbox:payment:${ref}`;
const TTL_S = 7 * 86_400;

export type SandboxOutcome = 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

interface SandboxState {
  status: 'PENDING' | SandboxOutcome;
  amountXof: string;
  method: string | null;
  txnId: string;
  description: string;
}

export const SANDBOX_SIGNATURE_HEADER = 'x-ineed-sandbox-signature';

/**
 * SIMULATEUR DE PAIEMENT — développement et tests uniquement, refusé en production (configuration et module).
 * Aucun argent ne circule. Il reproduit le comportement d'un vrai prestataire : page de paiement, notification
 * signée envoyée au serveur, vérification serveur à serveur, remboursement.
 * L'état est gardé dans Redis pour être partagé par l'API et le worker.
 */
export class SandboxPaymentProvider implements PaymentProvider {
  readonly name = 'sandbox';
  readonly isSandbox = true;
  private readonly secret: Buffer;

  constructor(
    private readonly redis: Redis,
    private readonly checkoutBase: string,
    dataKey: Buffer,
  ) {
    this.secret = createHmac('sha256', dataKey).update('ineed-sandbox-notification').digest();
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const txnId = `SBX${createHash('sha256').update(input.merchantReference).digest('hex').slice(0, 16).toUpperCase()}`;
    const state: SandboxState = { status: 'PENDING', amountXof: input.amountXof.toString(), method: null, txnId, description: input.description };
    await this.redis.set(KEY(input.merchantReference), JSON.stringify(state), 'EX', TTL_S, 'NX');
    return { checkoutUrl: `${this.checkoutBase}/v1/payments/sandbox/checkout/${encodeURIComponent(input.merchantReference)}`, providerTxnId: null };
  }

  async state(ref: string): Promise<SandboxState | null> {
    const raw = await this.redis.get(KEY(ref));
    return raw ? (JSON.parse(raw) as SandboxState) : null;
  }

  /** Issue choisie sur la page simulée. Une issue déjà tranchée ne change plus (comme chez un vrai prestataire). */
  async decide(ref: string, outcome: SandboxOutcome, method: string): Promise<SandboxState | null> {
    const s = await this.state(ref);
    if (!s) return null;
    if (s.status !== 'PENDING') return s;
    const next: SandboxState = { ...s, status: outcome, method };
    await this.redis.set(KEY(ref), JSON.stringify(next), 'EX', TTL_S);
    return next;
  }

  /** Notification telle que l'enverrait le prestataire : elle ne porte que la référence, signée. */
  signedNotification(ref: string, nonce: string): { headers: Record<string, string>; body: Record<string, string> } {
    const body = { merchantReference: ref, nonce };
    return { headers: { [SANDBOX_SIGNATURE_HEADER]: this.sign(body) }, body };
  }

  private sign(body: { merchantReference: string; nonce: string }): string {
    return createHmac('sha256', this.secret).update(`${body.merchantReference}|${body.nonce}`).digest('hex');
  }

  parseNotification(headers: Record<string, string | string[] | undefined>, body: unknown): ParsedNotification {
    const b = (body ?? {}) as Record<string, unknown>;
    const ref = typeof b.merchantReference === 'string' ? b.merchantReference : null;
    const nonce = typeof b.nonce === 'string' ? b.nonce : '';
    const given = headers[SANDBOX_SIGNATURE_HEADER];
    let valid = false;
    if (ref && typeof given === 'string') {
      const expected = Buffer.from(this.sign({ merchantReference: ref, nonce }), 'hex');
      const actual = Buffer.from(given, 'hex');
      valid = actual.length === expected.length && timingSafeEqual(actual, expected);
    }
    return { signatureValid: valid, eventId: `${ref ?? '?'}:${nonce}`, merchantReference: ref, payload: b };
  }

  async verify(ref: string): Promise<VerifyResult> {
    const s = await this.state(ref);
    if (!s) return { status: 'FAILED', amountXof: null, currency: null, providerTxnId: null, method: null, failureCode: 'UNKNOWN_TRANSACTION', failureMessage: 'Transaction inconnue du simulateur.', raw: null };
    return {
      status: s.status,
      amountXof: BigInt(s.amountXof),
      currency: 'XOF',
      providerTxnId: s.status === 'SUCCEEDED' ? s.txnId : null,
      method: s.method,
      failureCode: s.status === 'FAILED' ? 'SANDBOX_DECLINED' : s.status === 'CANCELLED' ? 'SANDBOX_CANCELLED' : null,
      failureMessage: s.status === 'FAILED' ? 'Paiement refusé (simulation).' : s.status === 'CANCELLED' ? 'Paiement abandonné (simulation).' : null,
      raw: s,
    };
  }

  refund(input: { refundReference: string }): Promise<RefundOutcome> {
    return Promise.resolve({ status: 'SUCCEEDED', providerRefundId: `SBXR-${input.refundReference}` });
  }
}
