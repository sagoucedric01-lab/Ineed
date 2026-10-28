import { Logger } from '@nestjs/common';
import { hmac, numericCode, safeEqualHex } from '../../common/crypto/tokens.js';
import type { OtpProvider } from './otp-provider.js';

/**
 * MODE DÉVELOPPEMENT : aucun SMS n'est envoyé, le code est écrit dans les journaux du serveur.
 * Refusé au démarrage quand APP_ENV=production (voir config/env.ts).
 */
export class DevConsoleOtpProvider implements OtpProvider {
  readonly name = 'dev_console' as const;
  readonly isDevelopment = true;
  private readonly logger = new Logger('OTP (développement)');
  /** Dernier code par numéro, pour les tests automatisés (jamais exposé par l'API). */
  readonly lastCodes = new Map<string, string>();

  constructor(private readonly pepper: string) {}

  start(phone: string): Promise<{ codeHash: string }> {
    const code = numericCode();
    this.lastCodes.set(phone, code);
    if (this.lastCodes.size > 1000) this.lastCodes.delete(this.lastCodes.keys().next().value!);
    this.logger.warn(`[DÉVELOPPEMENT — aucun SMS envoyé] Code pour ${phone} : ${code}`);
    return Promise.resolve({ codeHash: hmac(this.pepper, `${phone}:${code}`) });
  }

  check(phone: string, code: string, stored: { codeHash: string | null }): Promise<boolean> {
    return Promise.resolve(!!stored.codeHash && safeEqualHex(hmac(this.pepper, `${phone}:${code}`), stored.codeHash));
  }
}
