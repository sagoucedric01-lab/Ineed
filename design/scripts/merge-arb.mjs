// Répartit les textes de design/copy vers le mobile :
//   common_fr.arb -> mobile/packages/ineed_shared/lib/l10n/common_fr.arb (classe CommonLocalizations)
//   client_fr.arb -> mobile/apps/client/lib/l10n/app_fr.arb, pro_fr.arb -> mobile/apps/pro/lib/l10n/app_fr.arb
// Usage : node scripts/merge-arb.mjs          -> écrit les fichiers
//         node scripts/merge-arb.mjs --check  -> échoue si ces fichiers ne sont pas à jour (CI)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DESIGN_DIR } from './tokens-lib.mjs';

const MOBILE = join(DESIGN_DIR, '..', 'mobile');
const read = (f) => JSON.parse(readFileSync(join(DESIGN_DIR, 'copy', f), 'utf8'));

export function arbFor(source) {
  const data = { ...read(source), '@@locale': 'fr' };
  delete data['@@context'];
  return JSON.stringify(data, null, 2) + '\n';
}

export const TARGETS = {
  [join(MOBILE, 'packages', 'ineed_shared', 'lib', 'l10n', 'common_fr.arb')]: 'common_fr.arb',
  [join(MOBILE, 'apps', 'client', 'lib', 'l10n', 'app_fr.arb')]: 'client_fr.arb',
  [join(MOBILE, 'apps', 'pro', 'lib', 'l10n', 'app_fr.arb')]: 'pro_fr.arb',
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  let stale = 0;
  for (const [path, source] of Object.entries(TARGETS)) {
    const content = arbFor(source);
    if (check) {
      if (!existsSync(path) || readFileSync(path, 'utf8') !== content) { stale++; console.error(`Pas à jour : ${path}`); }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`Écrit : ${path}`);
    }
  }
  if (check) { console.log(stale ? 'Textes mobiles à régénérer : node design/scripts/merge-arb.mjs' : 'Textes mobiles à jour.'); process.exit(stale ? 1 : 0); }
}
