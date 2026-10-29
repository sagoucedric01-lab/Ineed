import { createSign } from 'node:crypto';
import type { PushMessage, PushOutcome, PushProvider } from './push-provider.js';

type Fetch = typeof fetch;

export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const TIMEOUT_MS = 10_000;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** Lit le compte de service Firebase (JSON encodé en base64) ; erreur explicite s'il est incomplet. */
export function parseServiceAccount(b64: string): ServiceAccount {
  let sa: Partial<ServiceAccount>;
  try {
    sa = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as Partial<ServiceAccount>;
  } catch {
    throw new Error('FCM_SERVICE_ACCOUNT_B64 : JSON illisible');
  }
  if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error('FCM_SERVICE_ACCOUNT_B64 : project_id, client_email et private_key sont requis');
  return sa as ServiceAccount;
}

/**
 * Firebase Cloud Messaging, API HTTP v1 (Android, et iOS via APNs configuré dans le projet Firebase).
 * Jeton d'accès OAuth obtenu par assertion JWT signée avec la clé du compte de service, mis en cache.
 *
 * ÉTAT : testé sur des réponses au format documenté par Google (tests de contrat) ; aucun projet Firebase
 * n'a été fourni, donc aucun envoi réel n'a été fait.
 */
export class FcmPushProvider implements PushProvider {
  readonly name = 'fcm';
  readonly isSimulated = false;
  private access: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly sa: ServiceAccount,
    private readonly http: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Assertion JWT (RS256) échangée contre un jeton d'accès. */
  assertion(): string {
    const iat = Math.floor(this.now() / 1000);
    const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claims = b64url(JSON.stringify({ iss: this.sa.client_email, scope: SCOPE, aud: this.sa.token_uri ?? DEFAULT_TOKEN_URI, iat, exp: iat + 3600 }));
    const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(this.sa.private_key);
    return `${header}.${claims}.${b64url(signature)}`;
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.access && this.access.expiresAt > this.now() + 60_000) return this.access.token;
    const res = await this.http(this.sa.token_uri ?? DEFAULT_TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: this.assertion() }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
    if (!res.ok || !j.access_token) throw new Error(`Jeton FCM refusé (HTTP ${res.status} ${j.error ?? ''})`.trim());
    this.access = { token: j.access_token, expiresAt: this.now() + (j.expires_in ?? 3600) * 1000 };
    return j.access_token;
  }

  async send(pushToken: string, message: PushMessage): Promise<PushOutcome> {
    try {
      let res = await this.post(pushToken, message, await this.accessToken());
      if (res.status === 401) res = await this.post(pushToken, message, await this.accessToken(true));
      if (res.ok) return { status: 'SENT' };
      const body = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      const codes = [body.error?.status, ...(body.error?.details ?? []).map((d) => d.errorCode)].filter(Boolean);
      // Jeton désinscrit, inconnu ou d'un autre projet : inutile de réessayer.
      if (res.status === 404 || codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH') || (res.status === 400 && codes.includes('INVALID_ARGUMENT'))) {
        return { status: 'INVALID_TOKEN' };
      }
      return { status: 'RETRY', error: `FCM HTTP ${res.status} ${codes.join(',')}`.trim() };
    } catch (e) {
      return { status: 'RETRY', error: e instanceof Error ? e.message : 'erreur réseau' };
    }
  }

  private post(pushToken: string, m: PushMessage, accessToken: string): Promise<Response> {
    return this.http(`https://fcm.googleapis.com/v1/projects/${this.sa.project_id}/messages:send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        message: {
          token: pushToken,
          notification: { title: m.title, body: m.body },
          data: m.data,
          android: { priority: 'HIGH', notification: { channel_id: 'ineed_missions' } },
          apns: { payload: { aps: { sound: 'default' } } },
        },
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  }
}
