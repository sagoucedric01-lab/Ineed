// Rendu PNG avec Chromium (Playwright) :
//  - icônes d'application 1024 px et avant-plan Android 432 px -> brand/png/
//  - chaque écran des maquettes (clair et sombre) -> maquettes/png/
// Usage : node scripts/render.mjs
import { readFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { DESIGN_DIR } from './tokens-lib.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const wrap = (body) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>${body}</body></html>`;

const browser = await chromium.launch();
try {
  // 1. Icônes
  const brandOut = join(DESIGN_DIR, 'brand/png');
  mkdirSync(brandOut, { recursive: true });
  const fonts = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@800&display=swap">';
  for (const [file, size] of [['icone-app-client', 1024], ['icone-app-pro', 1024], ['icone-android-avant-plan', 432], ['symbole', 512]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const svg = readFileSync(join(DESIGN_DIR, 'brand', `${file}.svg`), 'utf8').replace(/<svg /, `<svg style="display:block;width:${size}px;height:${size}px" `);
    await page.setContent(wrap(`${fonts}<style>body{margin:0;background:transparent}</style>${svg}`), { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(brandOut, `${file}-${size}.png`), omitBackground: true });
    await page.close();
    console.log(`brand/png/${file}-${size}.png`);
  }

  // 2. Écrans
  const html = readFileSync(join(DESIGN_DIR, 'maquettes/index.html'), 'utf8');
  const shotsOut = join(DESIGN_DIR, 'maquettes/png');
  rmSync(shotsOut, { recursive: true, force: true });
  mkdirSync(shotsOut, { recursive: true });
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    await page.setContent(wrap(html), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    const ids = await page.$$eval('figure[id]', (els) => els.map((e) => e.id));
    for (const id of ids) {
      const target = await page.$(`figure#${id} .phone, figure#${id} .admin`);
      await target.screenshot({ path: join(shotsOut, `${id}-${scheme === 'light' ? 'clair' : 'sombre'}.png`) });
    }
    if (scheme === 'light') {
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) console.warn('ATTENTION : défilement horizontal de la page à 1280 px');
    }
    await page.close();
  }
  // Contrôle à largeur de téléphone : la page ne doit pas défiler horizontalement.
  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.setContent(wrap(html), { waitUntil: 'networkidle' });
  const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  console.log(`Débordement horizontal à 390 px : ${mobileOverflow} px`);
  await mobile.close();
  console.log(`${readdirSync(shotsOut).length} captures d'écran dans maquettes/png/`);
} finally {
  await browser.close();
}
