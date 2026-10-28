// Génère des secrets NEUFS pour un environnement local ou de test (jamais pour la production,
// dont les secrets sont créés et stockés dans le gestionnaire de secrets de l'hébergeur).
// Usage : node tools/generate-dev-secrets.mjs                 -> affiche les variables
//         node tools/generate-dev-secrets.mjs --write <fichier> -> ajoute ou remplace ces variables dans le fichier
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export function generateSecrets() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return {
    JWT_PRIVATE_KEY_B64: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
    DATA_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
    OTP_PEPPER: randomBytes(32).toString('base64url'),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const secrets = generateSecrets();
  const target = process.argv[process.argv.indexOf('--write') + 1];
  if (process.argv.includes('--write') && target) {
    let content = existsSync(target) ? readFileSync(target, 'utf8') : '';
    for (const [k, v] of Object.entries(secrets)) {
      const line = `${k}=${v}`;
      content = new RegExp(`^${k}=.*$`, 'm').test(content) ? content.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${content.replace(/\n?$/, '\n')}${line}\n`;
    }
    writeFileSync(target, content);
    console.log(`Secrets de développement écrits dans ${target}`);
  } else {
    for (const [k, v] of Object.entries(secrets)) console.log(`${k}=${v}`);
  }
}
