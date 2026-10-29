import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  ProviderUnavailableError,
  type InitiateInput,
  type InitiateResult,
  type ParsedNotification,
  type PaymentProvider,
  type ProviderPaymentStatus,
  type RefundOutcome,
  type VerifyResult,
} from './payment-provider.js';

export interface CinetPayConfig {
  apiUrl: string;
  apiKey: string;
  siteId: string;
  secretKey: string;
}

type Fetch = typeof fetch;

/** Champs de la notification, dans l'ordre de concaténation de la signature x-token (HMAC SHA-256). */
export const CINETPAY_TOKEN_FIELDS = [
  'cpm_site_id', 'cpm_trans_id', 'cpm_trans_date', 'cpm_amount', 'cpm_currency', 'signature', 'payment_method',
  'cel_phone_num', 'cpm_phone_prefixe', 'cpm_language', 'cpm_version', 'cpm_payment_config', 'cpm_page_action',
  'cpm_custom', 'cpm_designation', 'cpm_error_message',
] as const;

const REQUEST_TIMEOUT_MS = 15_000;

/** Valeur scalaire d'une réponse JSON ou d'un formulaire, en texte ('' si absente ou non scalaire). */
const str = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean' ? String(v) : '');

/** Codes de vérification « en attente » : le client n'a pas encore validé sur son téléphone. */
const WAITING_CODES = new Set(['662', '623']);

/**
 * Adaptateur CinetPay (API Checkout v2) : Orange Money, MTN MoMo, Moov Money, Wave, carte.
 *
 * ÉTAT : écrit d'après la documentation publique de CinetPay et testé sur des réponses de cette
 * documentation (tests de contrat). Il n'a PAS été essayé sur un compte marchand : à valider sur
 * l'environnement de test de CinetPay dès réception des clés (voir docs/phase-7/rapport-phase-7.md).
 *
 * Remboursement : pas d'opération connue dans l'API Checkout (à confirmer avec CinetPay) ; il est exécuté depuis
 * l'espace marchand, puis sa référence est saisie dans Ineed par un administrateur habilité.
 */
export class CinetPayProvider implements PaymentProvider {
  readonly name = 'cinetpay';
  readonly isSandbox = false;

  constructor(
    private readonly cfg: CinetPayConfig,
    private readonly http: Fetch = fetch,
  ) {}

  private async post(path: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.http(`${this.cfg.apiUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new ProviderUnavailableError('CinetPay injoignable', e);
    }
    const text = await res.text();
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ProviderUnavailableError(`Réponse CinetPay illisible (HTTP ${res.status})`);
    }
  }

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    const phone = input.customerPhoneE164?.replace(/^\+225/, '') ?? undefined;
    const r = await this.post('/v2/payment', {
      apikey: this.cfg.apiKey,
      site_id: this.cfg.siteId,
      transaction_id: input.merchantReference,
      amount: Number(input.amountXof),
      currency: 'XOF',
      description: sanitizeDescription(input.description),
      notify_url: input.notifyUrl,
      return_url: input.returnUrl,
      channels: 'ALL',
      lang: 'FR',
      customer_name: input.customerFirstName ?? undefined,
      customer_phone_number: phone,
      metadata: input.merchantReference,
    });
    const data = (r.data ?? {}) as Record<string, unknown>;
    if (String(r.code) !== '201' || typeof data.payment_url !== 'string') {
      throw new ProviderUnavailableError(`CinetPay a refusé la création du paiement : ${str(r.code)} ${str(r.message)}`.trim());
    }
    return { checkoutUrl: data.payment_url, providerTxnId: null };
  }

  async verify(merchantReference: string): Promise<VerifyResult> {
    const r = await this.post('/v2/payment/check', { apikey: this.cfg.apiKey, site_id: this.cfg.siteId, transaction_id: merchantReference });
    return mapCheckResponse(r);
  }

  parseNotification(headers: Record<string, string | string[] | undefined>, body: unknown): ParsedNotification {
    const b = (body ?? {}) as Record<string, unknown>;
    const field = (k: string) => str(b[k]);
    const data = CINETPAY_TOKEN_FIELDS.map(field).join('');
    const expected = createHmac('sha256', this.cfg.secretKey).update(data).digest('hex');
    const token = headers['x-token'];
    let valid = false;
    if (typeof token === 'string' && /^[0-9a-f]+$/i.test(token)) {
      const a = Buffer.from(token.toLowerCase(), 'hex');
      const e = Buffer.from(expected, 'hex');
      valid = a.length === e.length && timingSafeEqual(a, e) && field('cpm_site_id') === this.cfg.siteId;
    }
    // CinetPay ne fournit pas d'identifiant d'événement : empreinte du contenu, pour dédoublonner les renvois.
    const eventId = createHash('sha256').update(data).digest('hex');
    const ref = field('cpm_trans_id') || null;
    return { signatureValid: valid, eventId, merchantReference: ref, payload: b };
  }

  refund(): Promise<RefundOutcome> {
    return Promise.resolve({ status: 'MANUAL' });
  }
}

/** Lettres, chiffres, espaces et ponctuation simple : CinetPay refuse certains caractères spéciaux. */
export function sanitizeDescription(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .,'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Paiement Ineed';
}

const METHODS: [RegExp, string][] = [
  [/^OM/i, 'ORANGE_MONEY'],
  [/^(MOMO|MTN)/i, 'MTN_MOMO'],
  [/^(FLOOZ|MOOV)/i, 'MOOV_MONEY'],
  [/^WAVE/i, 'WAVE'],
  [/^(VISA|MASTER|CARD|VISAM)/i, 'CARD'],
];

export function mapMethod(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null;
  return METHODS.find(([re]) => re.test(raw))?.[1] ?? raw.toUpperCase();
}

/** Traduit la réponse de /v2/payment/check. Tout cas non reconnu reste « en attente » : on revérifiera. */
export function mapCheckResponse(r: Record<string, unknown>): VerifyResult {
  const code = str(r.code);
  const message = str(r.message);
  const data = (r.data ?? {}) as Record<string, unknown>;
  const dataStatus = str(data.status);
  let status: ProviderPaymentStatus = 'PENDING';
  if (code === '00' && dataStatus === 'ACCEPTED') status = 'SUCCEEDED';
  else if (dataStatus === 'REFUSED' || code === '600' || code === '602' || code === '604') status = 'FAILED';
  else if (code === '627' || dataStatus === 'CANCELED' || dataStatus === 'CANCELLED') status = 'CANCELLED';
  else if (WAITING_CODES.has(code)) status = 'PENDING';
  const rawAmount = str(data.amount);
  const amount = /^\d+$/.test(rawAmount) ? BigInt(rawAmount) : null;
  return {
    status,
    amountXof: amount,
    currency: typeof data.currency === 'string' ? data.currency : null,
    providerTxnId: typeof data.operator_id === 'string' && data.operator_id ? data.operator_id : null,
    method: mapMethod(data.payment_method),
    failureCode: status === 'FAILED' || status === 'CANCELLED' ? code || dataStatus : null,
    failureMessage: status === 'FAILED' || status === 'CANCELLED' ? failureText(code, message) : null,
    raw: r,
  };
}

function failureText(code: string, message: string): string {
  switch (code) {
    case '602':
      return 'Solde insuffisant sur le compte Mobile Money.';
    case '604':
      return 'Code de validation incorrect.';
    case '627':
      return 'Paiement annulé.';
    default:
      return message ? `Paiement refusé par l’opérateur (${message}).` : 'Paiement refusé par l’opérateur.';
  }
}
