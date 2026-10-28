import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** Jeton opaque (jeton de rafraîchissement, etc.) : 32 octets aléatoires en base64url. */
export function opaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Empreinte stockée en base à la place du jeton lui-même. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Code numérique à 6 chiffres, tiré uniformément. */
export function numericCode(digits = 6): string {
  return String(randomInt(0, 10 ** digits)).padStart(digits, '0');
}

export function hmac(secret: string, value: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}
