// Génère les tokens pour Flutter (Dart) et le web (CSS + preset Tailwind) à partir de tokens.json.
// Usage : node scripts/build-tokens.mjs          -> écrit les fichiers
//         node scripts/build-tokens.mjs --check  -> échoue si les fichiers générés ne sont pas à jour (CI)
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { loadTokens, resolve, kebab, camel, DESIGN_DIR } from './tokens-lib.mjs';

const HEADER = 'GÉNÉRÉ AUTOMATIQUEMENT depuis design/tokens.json — ne pas modifier à la main.';

export function dartColor(hex) {
  return `Color(0xFF${hex.slice(1).toUpperCase()})`;
}

export function buildDart(t) {
  const roles = Object.keys(t.themes.light);
  const L = [];
  L.push(`// ${HEADER}`, `// Version des tokens : ${t.version}`, '', "import 'package:flutter/painting.dart';", '');
  L.push('/// Palette brute. Utiliser de préférence les rôles de [IneedColorScheme].', 'abstract final class IneedPalette {');
  for (const [name, hex] of Object.entries(t.palette)) L.push(`  static const ${camel(name)} = ${dartColor(hex)};`);
  L.push('}', '');
  L.push('/// Couleurs par rôle, pour un thème donné.', 'final class IneedColorScheme {');
  L.push(`  const IneedColorScheme({${roles.map((r) => `required this.${r}`).join(', ')}});`, '');
  for (const r of roles) L.push(`  final Color ${r};`);
  for (const theme of Object.keys(t.themes)) {
    L.push('', `  static const ${theme} = IneedColorScheme(`);
    for (const r of roles) L.push(`    ${r}: ${dartColor(resolve(t, theme, r))},`);
    L.push('  );');
  }
  L.push('}', '');
  L.push('/// Échelle typographique (tailles et interlignes en pixels logiques).', 'final class IneedTextStyleSpec {');
  L.push('  const IneedTextStyleSpec(this.family, this.size, this.lineHeight, this.weight, this.letterSpacing);');
  L.push('  final String family;', '  final double size;', '  final double lineHeight;', '  final int weight;', '  final double letterSpacing;');
  L.push('  double get height => lineHeight / size;', '}', '');
  L.push('abstract final class IneedTypography {');
  for (const [role, fams] of Object.entries(t.typography.fontFamilies)) L.push(`  static const ${role}Family = '${fams[0]}';`);
  for (const [name, s] of Object.entries(t.typography.scale)) {
    L.push(`  static const ${name} = IneedTextStyleSpec(${s.family}Family, ${s.size}, ${s.lineHeight}, ${s.weight}, ${s.letterSpacing});`);
  }
  L.push('}', '');
  const numClass = (cls, obj, prefix) => {
    L.push(`abstract final class ${cls} {`);
    for (const [k, v] of Object.entries(obj)) L.push(`  static const double ${/^[0-9]/.test(k) ? prefix + k : camel(k)} = ${v};`);
    L.push('}', '');
  };
  numClass('IneedSpacing', t.spacing, 's');
  numClass('IneedRadius', t.radius, 'r');
  numClass('IneedSizing', t.sizing, 'x');
  L.push('abstract final class IneedMotion {');
  for (const k of ['fast', 'base', 'slow']) L.push(`  static const ${k} = Duration(milliseconds: ${t.motion[k]});`);
  L.push('}', '');
  return L.join('\n');
}

export function buildCss(t) {
  const roles = Object.keys(t.themes.light);
  const vars = (theme, indent) => roles.map((r) => `${indent}--in-${kebab(r)}: ${resolve(t, theme, r)};`).join('\n');
  const L = [`/* ${HEADER} Version ${t.version} */`, ':root {'];
  for (const [name, hex] of Object.entries(t.palette)) L.push(`  --in-${name}: ${hex};`);
  L.push(vars('light', '  '));
  for (const [role, fams] of Object.entries(t.typography.fontFamilies)) {
    L.push(`  --in-font-${role}: ${fams.map((f) => (f.includes(' ') ? `"${f}"` : f)).join(', ')};`);
  }
  for (const [k, v] of Object.entries(t.spacing)) L.push(`  --in-space-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(t.radius)) L.push(`  --in-radius-${k}: ${v}px;`);
  for (const [k, v] of Object.entries(t.elevation)) L.push(`  --in-shadow-${k}: ${v};`);
  L.push(`  --in-ease: ${t.motion.easing};`, '}');
  L.push('@media (prefers-color-scheme: dark) {', '  :root:not([data-theme="light"]) {', vars('dark', '    '), '    color-scheme: dark;', '  }', '}');
  L.push(':root[data-theme="dark"] {', vars('dark', '  '), '  color-scheme: dark;', '}', '');
  return L.join('\n');
}

export function buildTailwindPreset(t) {
  const colors = Object.fromEntries(Object.keys(t.themes.light).map((r) => [kebab(r), `var(--in-${kebab(r)})`]));
  const fontSize = Object.fromEntries(
    Object.entries(t.typography.scale).map(([k, s]) => [kebab(k), [`${s.size / 16}rem`, { lineHeight: `${s.lineHeight / 16}rem`, fontWeight: String(s.weight), letterSpacing: `${s.letterSpacing}px` }]]),
  );
  const preset = {
    theme: {
      extend: {
        colors,
        fontFamily: { display: 'var(--in-font-display)', body: 'var(--in-font-body)' },
        fontSize,
        borderRadius: Object.fromEntries(Object.keys(t.radius).map((k) => [k === 'pill' ? 'pill' : `in-${k}`, `var(--in-radius-${k})`])),
        boxShadow: Object.fromEntries(Object.keys(t.elevation).map((k) => [`in-${k}`, `var(--in-shadow-${k})`])),
      },
    },
  };
  return `// ${HEADER}\n// À utiliser avec tokens.css (variables CSS, thèmes clair et sombre).\nmodule.exports = ${JSON.stringify(preset, null, 2)};\n`;
}

export function outputs(t) {
  return {
    'generated/flutter/ineed_tokens.dart': buildDart(t),
    'generated/web/tokens.css': buildCss(t),
    'generated/web/tailwind-preset.cjs': buildTailwindPreset(t),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const t = loadTokens();
  let stale = 0;
  for (const [rel, content] of Object.entries(outputs(t))) {
    const path = join(DESIGN_DIR, rel);
    if (check) {
      const same = existsSync(path) && readFileSync(path, 'utf8') === content;
      if (!same) { stale++; console.error(`Pas à jour : ${rel}`); }
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
      console.log(`Écrit : ${relative(process.cwd(), path)}`);
    }
  }
  if (check) {
    console.log(stale ? `${stale} fichier(s) à régénérer : node design/scripts/build-tokens.mjs` : 'Fichiers générés à jour.');
    process.exit(stale ? 1 : 0);
  }
}
