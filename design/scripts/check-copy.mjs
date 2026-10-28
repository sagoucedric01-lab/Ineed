// Contrôle des textes (ARB Flutter + JSON admin/notifications).
// - JSON valide, pas de clé en double
// - pas de texte factice (lorem ipsum, TODO, XXX…)
// - typographie française : apostrophe typographique, espace insécable avant « ; : ! ? »
// - clés partagées non redéfinies dans les fichiers d'application
// Usage : node scripts/check-copy.mjs [--fix]   (--fix corrige la typographie)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DESIGN_DIR } from './tokens-lib.mjs';

const COPY_DIR = join(DESIGN_DIR, 'copy');
const FORBIDDEN = /\b(lorem|ipsum|todo|fixme|xxx|tbd|placeholder|foo|bar)\b/i;
const fix = process.argv.includes('--fix');

/** Retourne la liste des chaînes visibles (hors métadonnées) d'un objet JSON, avec leur chemin. */
function strings(obj, path = []) {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    if (k.startsWith('@') || k.startsWith('$')) continue;
    if (typeof v === 'string') out.push([[...path, k].join('.'), v]);
    else if (v && typeof v === 'object') out.push(...strings(v, [...path, k]));
  }
  return out;
}

/** Corrige la typographie française d'un texte, en épargnant la syntaxe ICU ({x, plural, …}). */
export function frenchTypography(s) {
  return s
    .replace(/'/g, '’')
    .replace(/ ([;:!?])/g, ' $1')
    .replace(/« /g, '« ')
    .replace(/ »/g, ' »');
}

export function checkFile(name, raw) {
  const problems = [];
  const keys = [...raw.matchAll(/^\s*"([^"]+)"\s*:/gm)].map((m) => m[1]);
  // Les clés imbriquées peuvent se répéter d'un objet à l'autre : on ne vérifie que le premier niveau.
  const topLevel = [...raw.matchAll(/^ {2}"([^"]+)"\s*:/gm)].map((m) => m[1]);
  const dup = topLevel.filter((k, i) => topLevel.indexOf(k) !== i);
  if (dup.length) problems.push(`clés en double : ${[...new Set(dup)].join(', ')}`);
  let data;
  try { data = JSON.parse(raw); } catch (e) { return { problems: [`JSON invalide : ${e.message}`], keys }; }
  for (const [path, s] of strings(data)) {
    if (FORBIDDEN.test(s)) problems.push(`${path} : texte factice ou provisoire « ${s} »`);
    if (s.trim() !== s || s.length === 0) problems.push(`${path} : espaces superflus ou texte vide`);
    if (s !== frenchTypography(s)) problems.push(`${path} : typographie (apostrophe droite ou espace avant ; : ! ?)`);
  }
  if (name.endsWith('.arb')) {
    for (const [k, v] of Object.entries(data)) {
      if (k.startsWith('@') || typeof v !== 'string') continue;
      // Placeholders simples hors ICU : {name}
      const simple = [...v.replace(/\{[a-zA-Z]+, (plural|select)[\s\S]*$/, '').matchAll(/\{([a-zA-Z]+)\}/g)].map((m) => m[1]);
      const declared = Object.keys(data[`@${k}`]?.placeholders ?? {});
      for (const p of simple) if (!declared.includes(p)) problems.push(`${k} : paramètre {${p}} non déclaré dans @${k}`);
    }
  }
  return { problems, data };
}

if (import.meta.url !== `file://${process.argv[1]}`) { /* importé par les tests */ } else main();
function main() {
const files = readdirSync(COPY_DIR).filter((f) => /\.(arb|json)$/.test(f)).sort();
let total = 0;
const arbKeys = {};
for (const f of files) {
  const path = join(COPY_DIR, f);
  let raw = readFileSync(path, 'utf8');
  if (fix) {
    const data = JSON.parse(raw);
    const walk = (o) => { for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('@') || k.startsWith('$')) continue;
      if (typeof v === 'string') o[k] = frenchTypography(v); else if (v && typeof v === 'object') walk(v);
    } };
    walk(data);
    raw = JSON.stringify(data, null, 2) + '\n';
    writeFileSync(path, raw);
  }
  const { problems, data } = checkFile(f, raw);
  if (f.endsWith('.arb') && data) arbKeys[f] = Object.keys(data).filter((k) => !k.startsWith('@'));
  const count = data ? strings(data).length : 0;
  console.log(`${problems.length ? 'ÉCHEC' : 'OK  '} ${f} (${count} textes)`);
  for (const p of problems) console.log(`      - ${p}`);
  total += problems.length;
}
const common = new Set(arbKeys['common_fr.arb'] ?? []);
for (const app of ['client_fr.arb', 'pro_fr.arb']) {
  const overlap = (arbKeys[app] ?? []).filter((k) => common.has(k));
  if (overlap.length) { total++; console.log(`ÉCHEC ${app} redéfinit des clés communes : ${overlap.join(', ')}`); }
}
console.log(total ? `\n${total} problème(s).` : '\nTous les textes sont conformes.');
process.exit(total ? 1 : 0);
}
