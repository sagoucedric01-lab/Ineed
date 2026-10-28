import { describe, expect, it } from 'vitest';
import { mp4DurationSeconds } from './audio-duration.js';

const box = (type: string, body: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(8 + body.length);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
};

function m4a(seconds: number, version: 0 | 1 = 0): Buffer {
  const mvhd = Buffer.alloc(version === 1 ? 32 : 24);
  mvhd.writeUInt8(version, 0);
  if (version === 1) {
    mvhd.writeUInt32BE(1000, 20);
    mvhd.writeBigUInt64BE(BigInt(seconds * 1000), 24);
  } else {
    mvhd.writeUInt32BE(44100, 12);
    mvhd.writeUInt32BE(seconds * 44100, 16);
  }
  return Buffer.concat([box('ftyp', Buffer.from('M4A \0\0\0\0M4A isom')), box('moov', box('mvhd', mvhd)), box('mdat', Buffer.alloc(16))]);
}

describe('durée d’une note vocale', () => {
  it('lit la durée dans l’en-tête (versions 0 et 1)', () => {
    expect(mp4DurationSeconds(m4a(42))).toBe(42);
    expect(mp4DurationSeconds(m4a(300, 1))).toBe(300);
  });

  it('renvoie null pour un fichier sans en-tête ou tronqué', () => {
    expect(mp4DurationSeconds(Buffer.from('pas un fichier audio'))).toBeNull();
    expect(mp4DurationSeconds(m4a(10).subarray(0, 30))).toBeNull();
  });
});
