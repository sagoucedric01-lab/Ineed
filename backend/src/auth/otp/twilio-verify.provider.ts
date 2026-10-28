import { AppError } from '../../common/http/api-error.js';
import type { OtpProvider } from './otp-provider.js';

export interface TwilioVerifyConfig {
  accountSid: string;
  authToken: string;
  serviceSid: string;
  baseUrl?: string;
}

/**
 * Twilio Verify (https://www.twilio.com/docs/verify/api) : Twilio génère, envoie et vérifie le code.
 * Adaptateur testé contre des réponses simulées au format documenté ; PAS encore testé avec un vrai compte.
 */
export class TwilioVerifyOtpProvider implements OtpProvider {
  readonly name = 'twilio_verify' as const;
  readonly isDevelopment = false;
  private readonly baseUrl: string;

  constructor(
    private readonly config: TwilioVerifyConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.baseUrl ?? 'https://verify.twilio.com/v2';
  }

  private async post(path: string, form: Record<string, string>): Promise<Record<string, unknown>> {
    const auth = Buffer.from(`${this.config.accountSid}:${this.config.authToken}`).toString('base64');
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/Services/${this.config.serviceSid}/${path}`, {
        method: 'POST',
        headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form),
        signal: AbortSignal.timeout(8_000),
      });
    } catch {
      throw new AppError(503, 'SMS_PROVIDER_UNAVAILABLE', 'L’envoi du SMS a échoué. Réessayez dans un instant.');
    }
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.status === 404 && path === 'VerificationCheck') return { status: 'expired' };
    if (!res.ok) throw new AppError(503, 'SMS_PROVIDER_UNAVAILABLE', 'L’envoi du SMS a échoué. Réessayez dans un instant.', { providerStatus: res.status });
    return body;
  }

  async start(phone: string): Promise<{ providerRef: string }> {
    const body = await this.post('Verifications', { To: phone, Channel: 'sms', Locale: 'fr' });
    if (typeof body.sid !== 'string') throw new AppError(503, 'SMS_PROVIDER_UNAVAILABLE', 'L’envoi du SMS a échoué. Réessayez dans un instant.');
    return { providerRef: body.sid };
  }

  async check(phone: string, code: string): Promise<boolean> {
    const body = await this.post('VerificationCheck', { To: phone, Code: code });
    return body.status === 'approved';
  }
}
