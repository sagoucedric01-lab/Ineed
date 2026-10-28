// Fusionne common_fr.arb avec le fichier de chaque application (client, pro) en un ARB unique par application.
// Usage : node scripts/merge-arb.mjs            -> écrit mobile/apps/<app>/lib/l10n/app_fr.arb
//         node scripts/merge-arb.mjs --check    -> échoue si ces fichiers ne sont pas à jour (CI)
//         node scripts/merge-arb.mjs <dossier>  -> écrit <dossier>/l10n_<app>/app_fr.arb (validation isolée)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from './tokens-lib.mjs';

const read = (f) => JSON.parse(readFileSync(join(DESIGN_DIR, 'copy', f), 'utf8'));

export function mergedArb(app) {
  const merged = { ...read('common_fr.arb'), ...read(`${app}_fr.arb`), '@@locale': 'fr' };
  delete merged['@@context'];
  return JSON.stringify(merged, null, 2) + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const check = arg === '--check';
  let stale = 0;
  for (const app of ['client', 'pro']) {
    const dir = arg && !check ? join(arg, `l10n_${app}`) : join(DESIGN_DIR, '..', 'mobile', 'apps', app, 'lib', 'l10n');
    const path = join(dir, 'app_fr.arb');
    const content = mergedArb(app);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) { stale++; console.error(`Pas à jour : ${path}`); }
    } else {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, content);
      console.log(`Écrit : ${path}`);
    }
  }
  if (check) { console.log(stale ? 'Textes mobiles à régénérer : node design/scripts/merge-arb.mjs' : 'Textes mobiles à jour.'); process.exit(stale ? 1 : 0); }
}
