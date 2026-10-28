// Vérifie les contrastes WCAG déclarés dans tokens.json pour chaque thème.
// Code de sortie 1 si une paire est sous son seuil.
import { loadTokens, resolve, contrastRatio } from './tokens-lib.mjs';

const tokens = loadTokens();
let failures = 0;
for (const theme of Object.keys(tokens.themes)) {
  console.log(`\nThème ${theme}`);
  for (const [fg, bg, min] of tokens.contrast.pairs) {
    const ratio = contrastRatio(resolve(tokens, theme, fg), resolve(tokens, theme, bg));
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(`  ${ok ? 'OK  ' : 'ÉCHEC'} ${fg.padEnd(14)} sur ${bg.padEnd(14)} ${ratio.toFixed(2).padStart(5)} (min ${min})`);
  }
}
console.log(failures ? `\n${failures} paire(s) en échec` : '\nToutes les paires respectent leur seuil.');
process.exit(failures ? 1 : 0);
