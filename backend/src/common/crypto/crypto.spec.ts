import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box.js';
import { base32Decode, base32Encode, hotp, totp, verifyTotp } from './totp.js';
import { hmac, numericCode, safeEqualHex } from './tokens.js';

describe('SecretBox (AES-256-GCM)', () => {
  const box = new SecretBox(randomBytes(32).toString('base64'));
  it('chiffre puis déchiffre', () => {
    const sealed = box.seal('JBSWY3DPEHPK3PXP');
    expect(Buffer.from(sealed).toString('utf8')).not.toContain('JBSWY3DP');
    expect(box.open(sealed)).toBe('JBSWY3DPEHPK3PXP');
  });
  it('détecte toute altération', () => {
    const sealed = box.seal('secret');
    sealed[sealed.length - 1]! ^= 1;
    expect(() => box.open(sealed)).toThrow();
  });
  it('refuse une clé d’une autre taille', () => expect(() => new SecretBox(randomBytes(16).toString('base64'))).toThrow());
});

describe('TOTP (vecteurs de test officiels)', () => {
  // RFC 4226, annexe D : secret ASCII "12345678901234567890"
  const rfcSecret = Buffer.from('12345678901234567890');
  it.each([[0, '755224'], [1, '287082'], [9, '520489']])('HOTP compteur %i = %s', (c, code) => {
    expect(hotp(rfcSecret, c)).toBe(code);
  });
  // RFC 6238, annexe B (SHA-1, 8 chiffres) ramené à 6 chiffres : 94287082 -> 287082 à t=59 s
  it('TOTP à t = 59 s', () => expect(totp(base32Encode(rfcSecret), 59_000)).toBe('287082'));
  it('base32 aller-retour', () => {
    const b = randomBytes(20);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it('tolère un pas de décalage, pas deux', () => {
    const s = base32Encode(rfcSecret);
    const now = 1_700_000_000_000;
    expect(verifyTotp(s, totp(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totp(s, now - 90_000), now)).toBe(false);
    expect(verifyTotp(s, 'abcdef', now)).toBe(false);
  });
});

describe('jetons', () => {
  it('codes à 6 chiffres', () => {
    for (let i = 0; i < 200; i++) expect(numericCode()).toMatch(/^\d{6}$/);
  });
  it('comparaison d’empreintes à temps constant', () => {
    expect(safeEqualHex(hmac('k', 'a'), hmac('k', 'a'))).toBe(true);
    expect(safeEqualHex(hmac('k', 'a'), hmac('k', 'b'))).toBe(false);
    expect(safeEqualHex(hmac('k', 'a'), 'ab')).toBe(false);
  });
});
