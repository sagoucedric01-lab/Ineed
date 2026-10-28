/** Format unique des erreurs de l'API. `message` est rédigé en français, prêt à être affiché. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
    requestId?: string;
  };
}

/** Messages par défaut selon le statut HTTP, quand l'erreur n'en fournit pas de plus précis. */
export const DEFAULT_MESSAGES: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'La requête est invalide.' },
  401: { code: 'UNAUTHENTICATED', message: 'Votre session a expiré. Reconnectez-vous pour continuer.' },
  403: { code: 'FORBIDDEN', message: 'Vous n’avez pas accès à cette information.' },
  404: { code: 'NOT_FOUND', message: 'Cet élément n’existe plus ou a été supprimé.' },
  409: { code: 'CONFLICT', message: 'Cette action entre en conflit avec l’état actuel. Actualisez puis réessayez.' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Le contenu envoyé est trop volumineux.' },
  422: { code: 'VALIDATION_FAILED', message: 'Certaines informations sont incomplètes ou invalides.' },
  429: { code: 'RATE_LIMITED', message: 'Trop de demandes en peu de temps. Patientez une minute puis réessayez.' },
  500: { code: 'INTERNAL_ERROR', message: 'Un problème est survenu de notre côté. Réessayez ; si cela continue, contactez l’assistance.' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Le service est momentanément indisponible. Réessayez dans un instant.' },
};

/** Erreur métier explicite : code stable pour les applications + message français. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
