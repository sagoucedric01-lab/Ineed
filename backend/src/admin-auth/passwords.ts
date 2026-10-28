import { hash, verify } from '@node-rs/argon2';

/** Paramètres argon2id recommandés par l'OWASP (19 Mio, 2 itérations, 1 fil). */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

/** Empreinte factice : vérifiée quand l'e-mail est inconnu, pour que la réponse prenne le même temps. */
let dummy: Promise<string> | undefined;
export function dummyHash(): Promise<string> {
  dummy ??= hashPassword('mot-de-passe-factice-pour-egaliser-les-temps');
  return dummy;
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`au moins ${MIN_PASSWORD_LENGTH} caractères`);
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) problems.push('des lettres et des chiffres');
  return problems;
}
