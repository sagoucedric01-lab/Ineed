// Assemble maquettes/src.html en une page autonome maquettes/index.html :
// {{tokens}} -> generated/web/tokens.css ; {{i:nom}} -> icons/ui/nom.svg ; {{c:nom}} -> icons/categories/nom.svg ;
// {{b:nom}} -> brand/nom.svg. Échoue si une référence est introuvable.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from './tokens-lib.mjs';

const DIRS = { i: 'icons/ui', c: 'icons/categories', b: 'brand' };

export function inlineSvg(kind, name) {
  const path = join(DESIGN_DIR, DIRS[kind], `${name}.svg`);
  if (!existsSync(path)) throw new Error(`Référence introuvable : {{${kind}:${name}}} (${path})`);
  let svg = readFileSync(path, 'utf8').trim();
  if (kind !== 'b') {
    // Icônes d'interface : décoratives (le texte voisin porte le sens).
    svg = svg.replace(/ role="img" aria-label="[^"]*"/, ' aria-hidden="true"');
  }
  return svg;
}

export function build(src) {
  const tokens = readFileSync(join(DESIGN_DIR, 'generated/web/tokens.css'), 'utf8');
  return src
    .replace('{{tokens}}', tokens)
    .replace(/\{\{([icb]):([a-z0-9-]+)\}\}/g, (_, kind, name) => inlineSvg(kind, name));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = build(readFileSync(join(DESIGN_DIR, 'maquettes/src.html'), 'utf8'));
  const left = out.match(/\{\{[^}]+\}\}/g);
  if (left) throw new Error(`Références non résolues : ${left.join(', ')}`);
  writeFileSync(join(DESIGN_DIR, 'maquettes/index.html'), out);
  console.log(`Écrit : maquettes/index.html (${(out.length / 1024).toFixed(0)} Ko)`);
}
