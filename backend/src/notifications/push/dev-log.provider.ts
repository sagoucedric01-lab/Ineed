import { Logger } from '@nestjs/common';
import type { PushMessage, PushOutcome, PushProvider } from './push-provider.js';

/**
 * MODE DÉVELOPPEMENT — aucune notification n'est envoyée aux téléphones : le contenu est écrit dans les journaux.
 * Refusé au démarrage en production. Les notifications restent visibles dans la liste de l'application.
 */
export class DevLogPushProvider implements PushProvider {
  readonly name = 'dev_log';
  readonly isSimulated = true;
  private readonly logger = new Logger('Push (développement)');
  readonly sent: { token: string; message: PushMessage }[] = [];

  send(pushToken: string, message: PushMessage): Promise<PushOutcome> {
    this.sent.push({ token: pushToken, message });
    if (this.sent.length > 500) this.sent.shift();
    this.logger.log(`[DÉVELOPPEMENT — aucune notification envoyée] ${pushToken.slice(0, 12)}… « ${message.title} » ${message.body}`);
    return Promise.resolve({ status: 'SENT' });
  }
}
