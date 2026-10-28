import { describe, expect, it } from 'vitest';
import { formatXof, toXof } from './xof.js';

const NN = ' ';
const NB = ' ';

describe('formatXof', () => {
  it.each([
    [0, `0${NB}F${NB}CFA`],
    [500, `500${NB}F${NB}CFA`],
    [17500, `17${NN}500${NB}F${NB}CFA`],
    [1250000n, `1${NN}250${NN}000${NB}F${NB}CFA`],
  ])('%s -> %s', (amount, expected) => {
    expect(formatXof(amount)).toBe(expected);
  });
});

describe('toXof', () => {
  it('accepte les entiers et les chaînes de chiffres', () => {
    expect(toXof(17500)).toBe(17500n);
    expect(toXof('17500')).toBe(17500n);
  });

  it.each([1.5, -1, Number.MAX_SAFE_INTEGER + 2, '12,5', '-3', '1e3'])('refuse %s', (v) => {
    expect(() => toXof(v as number)).toThrow(RangeError);
  });

  it('refuse un montant au-delà du garde-fou', () => {
    expect(() => toXof(1_000_000_001n)).toThrow(/hors limites/);
  });
});
