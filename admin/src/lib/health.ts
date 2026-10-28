/** Lecture de l'état de la plateforme (/health/ready de l'API), côté serveur uniquement. */

export type DependencyKey = 'database' | 'redis' | 'storage';

export interface ReadinessReport {
  status: 'ok' | 'error';
  checks: Record<DependencyKey, { status: 'ok' | 'error'; latencyMs: number; detail?: string }>;
  worker: { status: 'ok' | 'absent' | 'unknown'; lastSeenAt?: string };
}

export type PlatformStatus =
  | { kind: 'report'; report: ReadinessReport }
  | { kind: 'unreachable'; reason: string };

export const DEPENDENCY_LABELS: Record<DependencyKey, string> = {
  database: 'Base de données',
  redis: 'File de tâches et cache (Redis)',
  storage: 'Stockage des fichiers',
};

function isReport(value: unknown): value is ReadinessReport {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<ReadinessReport>;
  return (v.status === 'ok' || v.status === 'error') && typeof v.checks === 'object' && v.checks !== null;
}

/**
 * Interroge l'API. Un 503 est un rapport valide (une dépendance est en panne) ;
 * une absence de réponse est signalée comme « API injoignable ».
 */
export async function fetchPlatformStatus(
  apiUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 3_000,
): Promise<PlatformStatus> {
  try {
    const res = await fetchImpl(new URL('/health/ready', apiUrl), {
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body: unknown = await res.json().catch(() => null);
    if ((res.status === 200 || res.status === 503) && isReport(body)) return { kind: 'report', report: body };
    return { kind: 'unreachable', reason: `Réponse inattendue de l’API (HTTP ${res.status}).` };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
    return {
      kind: 'unreachable',
      reason: timedOut ? `L’API n’a pas répondu en ${(timeoutMs / 1000).toLocaleString('fr-FR')} s.` : 'L’API est injoignable. Vérifiez qu’elle est démarrée et que INEED_API_URL est correcte.',
    };
  }
}
