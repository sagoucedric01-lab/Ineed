const STYLES = {
  ok: 'bg-success-soft text-on-success-soft',
  error: 'bg-danger-soft text-on-danger-soft',
  neutral: 'bg-surface-muted text-text-muted',
} as const;

export function StatusPill({ tone, children }: { tone: keyof typeof STYLES; children: string }) {
  return (
    <span className={`inline-flex h-7 items-center rounded-pill px-3 text-caption font-semibold whitespace-nowrap ${STYLES[tone]}`}>
      {children}
    </span>
  );
}
