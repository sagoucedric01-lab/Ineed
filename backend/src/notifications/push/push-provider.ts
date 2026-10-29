/** Message push adressé à un appareil. `data` sert aux liens profonds (ex. { missionId }). */
export interface PushMessage {
  title: string;
  body: string;
  data: Record<string, string>;
}

export type PushOutcome =
  | { status: 'SENT' }
  /** Jeton périmé ou inconnu du service : l'appareil est désactivé. */
  | { status: 'INVALID_TOKEN' }
  /** Erreur passagère (réseau, quota, panne) : nouvel essai plus tard. */
  | { status: 'RETRY'; error: string };

export interface PushProvider {
  readonly name: string;
  /** Vrai si rien n'est réellement envoyé (développement). */
  readonly isSimulated: boolean;
  send(pushToken: string, message: PushMessage): Promise<PushOutcome>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
