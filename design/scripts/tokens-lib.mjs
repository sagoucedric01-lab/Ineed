// Chargement et résolution des tokens de design (source : design/tokens.json).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const DESIGN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadTokens(path = join(DESIGN_DIR, 'tokens.json')) {
  const tokens = JSON.parse(readFileSync(path, 'utf8'));
  for (const [name, theme] of Object.entries(tokens.themes)) {
    for (const [role, ref] of Object.entries(theme)) {
      if (!(ref in tokens.palette)) {
        throw new Error(`Thème ${name} : le rôle "${role}" référence une couleur inconnue "${ref}"`);
      }
    }
  }
  const roles = Object.keys(tokens.themes.light);
  for (const [name, theme] of Object.entries(tokens.themes)) {
    const missing = roles.filter((r) => !(r in theme));
    if (missing.length) throw new Error(`Thème ${name} : rôles manquants ${missing.join(', ')}`);
  }
  return tokens;
}

/** Couleur hexadécimale d'un rôle dans un thème. */
export function resolve(tokens, theme, role) {
  const ref = tokens.themes[theme][role];
  if (ref === undefined) throw new Error(`Rôle inconnu "${role}" dans le thème ${theme}`);
  return tokens.palette[ref];
}

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Luminance relative WCAG 2.x d'une couleur #RRGGBB. */
export function luminance(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`Couleur invalide : ${hex}`);
  const n = parseInt(m[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

export const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
export const camel = (s) => s.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
