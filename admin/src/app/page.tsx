import { StatusPill } from '@/components/status-pill';
import { DEPENDENCY_LABELS, type DependencyKey, fetchPlatformStatus } from '@/lib/health';

// Page rendue à chaque requête : l'état affiché est celui du moment.
export const dynamic = 'force-dynamic';

const ENV_LABELS: Record<string, string> = {
  local: 'Environnement local',
  test: 'Environnement de test',
  staging: 'Préproduction',
  production: 'Production',
};

const WORKER_LABELS = {
  ok: 'Actif',
  absent: 'Arrêté ou injoignable',
  unknown: 'Inconnu (Redis indisponible)',
} as const;

function formatTime(iso: string): string {
  return new Intl.DateTimeFormat('fr-FR', { timeZone: 'Africa/Abidjan', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(iso));
}

export default async function PlatformStatusPage() {
  const apiUrl = process.env.INEED_API_URL ?? 'http://localhost:3000';
  const env = process.env.NEXT_PUBLIC_APP_ENV ?? 'local';
  const status = await fetchPlatformStatus(apiUrl);
  const checkedAt = new Date().toISOString();

  return (
    <main className="mx-auto grid max-w-3xl gap-6 px-4 py-10">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- icône SVG locale, pas d'optimisation nécessaire */}
          <img src="/icon.svg" alt="" width={40} height={40} />
          <h1 className="font-display text-title-l text-text">État de la plateforme</h1>
        </div>
        <StatusPill tone={env === 'production' ? 'neutral' : 'error'}>{ENV_LABELS[env] ?? env}</StatusPill>
      </header>

      <p className="text-body-m text-text-muted">
        Cette page vérifie que l’API et ses dépendances répondent. Les modules d’administration (validation des
        professionnels, missions, paiements…) seront ajoutés en phase 9, avec la connexion sécurisée.
      </p>

      {status.kind === 'unreachable' ? (
        <section className="grid gap-2 rounded-in-lg border border-border bg-danger-soft p-5 text-on-danger-soft" role="alert">
          <h2 className="font-display text-title-m">API injoignable</h2>
          <p className="text-body-m">{status.reason}</p>
        </section>
      ) : (
        <section className="grid gap-4 rounded-in-lg border border-border bg-surface p-5 shadow-in-card">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-title-m">API</h2>
            <StatusPill tone={status.report.status === 'ok' ? 'ok' : 'error'}>
              {status.report.status === 'ok' ? 'Opérationnelle' : 'Dégradée'}
            </StatusPill>
          </div>
          <ul className="grid divide-y divide-border">
            {(Object.keys(DEPENDENCY_LABELS) as DependencyKey[]).map((key) => {
              const check = status.report.checks[key];
              return (
                <li key={key} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="grid min-w-0">
                    <span className="text-label font-semibold">{DEPENDENCY_LABELS[key]}</span>
                    {check.detail && <span className="text-caption break-words text-text-muted">{check.detail}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-caption text-text-subtle tabular-nums">{check.latencyMs} ms</span>
                    <StatusPill tone={check.status === 'ok' ? 'ok' : 'error'}>{check.status === 'ok' ? 'Disponible' : 'En panne'}</StatusPill>
                  </div>
                </li>
              );
            })}
            <li className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="grid">
                <span className="text-label font-semibold">Tâches de fond (worker)</span>
                {status.report.worker.lastSeenAt && (
                  <span className="text-caption text-text-muted">Dernier signal : {formatTime(status.report.worker.lastSeenAt)}</span>
                )}
              </div>
              <StatusPill tone={status.report.worker.status === 'ok' ? 'ok' : 'neutral'}>{WORKER_LABELS[status.report.worker.status]}</StatusPill>
            </li>
          </ul>
        </section>
      )}

      <p className="text-caption text-text-subtle">Vérifié le {formatTime(checkedAt)} (heure d’Abidjan). Actualisez la page pour relancer la vérification.</p>
    </main>
  );
}
