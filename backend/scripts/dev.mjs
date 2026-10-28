// Développement : compile en continu avec tsc (qui émet les métadonnées de décorateurs nécessaires à NestJS)
// et relance le processus à chaque modification. Usage : node scripts/dev.mjs main|worker
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const entry = process.argv[2] === 'worker' ? 'dist/worker.js' : 'dist/main.js';
const tsc = spawn('npx', ['tsc', '-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' });
const waitForBuild = setInterval(() => {
  if (!existsSync(entry)) return;
  clearInterval(waitForBuild);
  const envFile = existsSync('.env') ? ['--env-file=.env'] : [];
  const app = spawn(process.execPath, [...envFile, '--enable-source-maps', '--watch', entry], { stdio: 'inherit' });
  app.on('exit', (code) => { tsc.kill(); process.exit(code ?? 0); });
}, 500);
process.on('SIGINT', () => { tsc.kill(); process.exit(0); });
