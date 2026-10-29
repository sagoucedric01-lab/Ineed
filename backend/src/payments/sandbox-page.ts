import { formatXof } from '../common/money/xof.js';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const shell = (title: string, body: string) => `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(title)}</title></head>
<body style="margin:0;font-family:system-ui,sans-serif;background:#f6f5f2;color:#1d1d1b">
<div style="background:#b42318;color:#fff;padding:12px 16px;font-weight:600;text-align:center">SIMULATION — aucun argent réel n’est débité. Page réservée au développement.</div>
<main style="max-width:420px;margin:24px auto;padding:0 16px">${body}</main></body></html>`;

export function sandboxCheckoutPage(ref: string, amountXof: bigint, description: string, status: string): string {
  if (status !== 'PENDING') return sandboxResultPage(status);
  const btn = (outcome: string, label: string, bg: string) =>
    `<button name="outcome" value="${outcome}" style="display:block;width:100%;margin:8px 0;padding:14px;border:0;border-radius:10px;font-size:16px;font-weight:600;background:${bg};color:#fff">${label}</button>`;
  return shell(
    'Paiement simulé',
    `<h1 style="font-size:22px">Paiement simulé</h1>
<p style="font-size:28px;font-weight:700;margin:8px 0">${esc(formatXof(amountXof))}</p>
<p>${esc(description)}</p><p style="color:#5c5b57;font-size:14px">Référence ${esc(ref)}</p>
<form method="post">
<label for="method" style="display:block;margin:16px 0 4px">Moyen de paiement simulé</label>
<select id="method" name="method" style="width:100%;padding:12px;font-size:16px;border-radius:8px">
<option value="ORANGE_MONEY">Orange Money</option><option value="MTN_MOMO">MTN Mobile Money</option><option value="MOOV_MONEY">Moov Money</option><option value="WAVE">Wave</option><option value="CARD">Carte bancaire</option>
</select>
${btn('SUCCEEDED', 'Simuler un paiement réussi', '#1f7a4d')}
${btn('FAILED', 'Simuler un refus de l’opérateur', '#9a3412')}
${btn('CANCELLED', 'Simuler un abandon', '#57534e')}
</form>`,
  );
}

export function sandboxResultPage(status: string): string {
  const text: Record<string, string> = {
    SUCCEEDED: 'Paiement simulé réussi.',
    FAILED: 'Paiement simulé refusé.',
    CANCELLED: 'Paiement simulé abandonné.',
  };
  return shell('Paiement simulé', `<h1 style="font-size:22px">${esc(text[status] ?? 'Transaction inconnue.')}</h1><p>Retournez dans l’application Ineed : elle affichera le résultat confirmé par le serveur.</p>`);
}

export function paymentReturnPage(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Ineed</title></head>
<body style="font-family:system-ui,sans-serif;max-width:420px;margin:40px auto;padding:0 16px"><h1 style="font-size:22px">Paiement en cours de vérification</h1>
<p>Retournez dans l’application Ineed : le résultat s’affichera dès que le paiement aura été confirmé.</p></body></html>`;
}
