import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Chiffrement authentifié AES-256-GCM des secrets stockés en base (graines TOTP, numéros de reversement).
 * Format : version (1 octet) | IV (12) | tag (16) | texte chiffré.
 */
const VERSION = 1;

export class SecretBox {
  private readonly key: Buffer;

  constructor(keyB64: string) {
    this.key = Buffer.from(keyB64, 'base64');
    if (this.key.length !== 32) throw new Error('La clé de chiffrement doit faire 32 octets');
  }

  seal(plaintext: string): Uint8Array<ArrayBuffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return new Uint8Array(Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]));
  }

  open(sealed: Uint8Array): string {
    const buf = Buffer.from(sealed);
    if (buf[0] !== VERSION) throw new Error('Format de secret chiffré inconnu');
    const decipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(1, 13));
    decipher.setAuthTag(buf.subarray(13, 29));
    return Buffer.concat([decipher.update(buf.subarray(29)), decipher.final()]).toString('utf8');
  }
}
