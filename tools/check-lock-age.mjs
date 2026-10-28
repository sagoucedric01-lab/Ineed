// Politique de versions : vérifie que chaque paquet de pnpm-lock.yaml (dépendances indirectes comprises)
// a été publié depuis au moins 14 jours, hors exceptions de sécurité déclarées dans pnpm-workspace.yaml.
// Usage : node tools/check-lock-age.mjs
import { readFileSync } from 'node:fs';

const MIN_AGE_MS = 14 * 86_400_000;
const lock = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
const workspace = readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8');
const excludeBlock = workspace.split(/^minimumReleaseAgeExclude:\s*$/m)[1]?.split(/^\S/m)[0] ?? '';
const excluded = [...excludeBlock.matchAll(/^\s+- '?([^'\n]+?)'?\s*$/gm)].map((m) => m[1]);
const isExcluded = (name) => excluded.some((p) => (p.endsWith('/*') ? name.startsWith(p.slice(0, -1)) : name === p));

const section = lock.split(/^packages:\s*$/m)[1]?.split(/^snapshots:\s*$/m)[0] ?? '';
const entries = [...section.matchAll(/^ {2}'?(@?[^@\s']+)@([^:'(\s]+)'?:/gm)].map((m) => ({ name: m[1], version: m[2] }));
const cutoff = Date.now() - MIN_AGE_MS;
const problems = [];
let i = 0;
async function worker() {
  while (i < entries.length) {
    const { name, version } = entries[i++];
    if (isExcluded(name)) continue;
    const res = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { headers: { accept: 'application/vnd.npm.install-v1+json; q=1.0, application/json' } });
    if (!res.ok) { problems.push(`${name}@${version} : registre HTTP ${res.status}`); continue; }
    const doc = await res.json();
    const published = doc.time?.[version];
    if (!published) {
      // Le format abrégé ne contient pas les dates : document complet.
      const full = await (await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`)).json();
      const t = full.time?.[version];
      if (!t) problems.push(`${name}@${version} : date de publication inconnue`);
      else if (Date.parse(t) > cutoff) problems.push(`${name}@${version} publié le ${t.slice(0, 10)}`);
      continue;
    }
    if (Date.parse(published) > cutoff) problems.push(`${name}@${version} publié le ${published.slice(0, 10)}`);
  }
}
await Promise.all(Array.from({ length: 16 }, worker));
console.log(`${entries.length} paquets vérifiés (exceptions : ${excluded.join(', ')}).`);
for (const p of problems.sort()) console.log(`::error::${p}`);
process.exit(problems.length ? 1 : 0);
