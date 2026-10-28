// Tests des outils du système de design : node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRatio, loadTokens, resolve } from './tokens-lib.mjs';
import { frenchTypography, checkFile } from './check-copy.mjs';
import { buildDart, buildCss, dartColor } from './build-tokens.mjs';
import { build } from './build-maquettes.mjs';

test('rapport de contraste WCAG : valeurs de référence', () => {
  assert.equal(contrastRatio('#000000', '#FFFFFF').toFixed(2), '21.00');
  assert.equal(contrastRatio('#FFFFFF', '#FFFFFF').toFixed(2), '1.00');
  assert.equal(contrastRatio('#767676', '#FFFFFF').toFixed(2), '4.54'); // gris AA classique
});

test('les deux thèmes définissent exactement les mêmes rôles', () => {
  const t = loadTokens();
  assert.deepEqual(Object.keys(t.themes.dark).sort(), Object.keys(t.themes.light).sort());
  assert.match(resolve(t, 'light', 'urgent'), /^#[0-9A-F]{6}$/i);
});

test('typographie française', () => {
  assert.equal(frenchTypography("L'adresse : ici ?"), 'L’adresse : ici ?');
  assert.equal(frenchTypography('{count, plural, =1{1 avis} other{{count} avis}}'), '{count, plural, =1{1 avis} other{{count} avis}}');
});

test('le contrôle des textes rejette le texte factice et les paramètres non déclarés', () => {
  const bad = JSON.stringify({ a: 'Lorem ipsum', b: 'Bonjour {name}' }, null, 2);
  const { problems } = checkFile('x.arb', bad);
  assert.ok(problems.some((p) => p.includes('factice')));
  assert.ok(problems.some((p) => p.includes('{name}')));
});

test('le contrôle des textes détecte les clés en double', () => {
  const { problems } = checkFile('x.json', '{\n  "a": "Un",\n  "a": "Deux"\n}');
  assert.ok(problems.some((p) => p.includes('double')));
});

test('génération Dart et CSS', () => {
  const t = loadTokens();
  assert.equal(dartColor('#0b2a5b'), 'Color(0xFF0B2A5B)');
  const dart = buildDart(t);
  assert.match(dart, /static const light = IneedColorScheme\(/);
  assert.match(dart, /static const dark = IneedColorScheme\(/);
  const css = buildCss(t);
  assert.match(css, /--in-urgent: #FF7A1A;/);
  assert.match(css, /:root\[data-theme="dark"\]/);
});

test('les maquettes échouent sur une icône inexistante', () => {
  assert.throws(() => build('{{i:icone-inexistante}}'), /introuvable/);
  assert.match(build('{{c:plomberie}}'), /aria-hidden="true"/);
});
