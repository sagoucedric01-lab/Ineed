// Fusionne common_fr.arb avec le fichier de chaque application (client, pro) en un ARB unique par application.
// Usage : node scripts/merge-arb.mjs <dossier de sortie>  -> <sortie>/l10n_client/app_fr.arb, <sortie>/l10n_pro/app_fr.arb
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from './tokens-lib.mjs';

const out = process.argv[2];
if (!out) { console.error('Usage : node scripts/merge-arb.mjs <dossier de sortie>'); process.exit(2); }
const read = (f) => JSON.parse(readFileSync(join(DESIGN_DIR, 'copy', f), 'utf8'));
const common = read('common_fr.arb');
for (const app of ['client', 'pro']) {
  const merged = { ...common, ...read(`${app}_fr.arb`), '@@locale': 'fr' };
  delete merged['@@context'];
  mkdirSync(join(out, `l10n_${app}`), { recursive: true });
  writeFileSync(join(out, `l10n_${app}`, 'app_fr.arb'), JSON.stringify(merged, null, 2) + '\n');
}
