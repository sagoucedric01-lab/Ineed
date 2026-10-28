// Affiche, pour chaque paquet npm, la dernière version stable publiée avant une date limite
// (par défaut : il y a 14 jours). Politique du projet : pas de dépendance publiée depuis moins de deux semaines.
// Usage : node tools/pick-versions.mjs paquet1 paquet2 ... [--before=AAAA-MM-JJ]
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const beforeArg = args.find((a) => a.startsWith('--before='));
const cutoff = beforeArg ? new Date(beforeArg.slice(9)) : new Date(Date.now() - 14 * 864e5);
const out = {};
for (const pkg of args.filter((a) => !a.startsWith('--'))) {
  const times = JSON.parse(execFileSync('npm', ['view', pkg, 'time', '--json'], { encoding: 'utf8' }));
  const candidates = Object.entries(times)
    .filter(([v, d]) => /^\d+\.\d+\.\d+$/.test(v) && new Date(d) < cutoff)
    .sort((a, b) => new Date(a[1]) - new Date(b[1]));
  out[pkg] = candidates.at(-1)?.[0] ?? null;
}
console.log(JSON.stringify(out, null, 2));
