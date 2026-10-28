/**
 * Montants en francs CFA (XOF). Le XOF n'a pas de subdivision utilisée : tous les montants sont des
 * entiers. Aucun calcul monétaire ne doit passer par des nombres à virgule.
 */
export const XOF_MAX = 1_000_000_000n; // garde-fou : un milliard de F CFA

export type Xof = bigint;

/** Convertit et valide un montant (entier positif ou nul, borné). */
export function toXof(value: bigint | number | string): Xof {
  let v: bigint;
  if (typeof value === 'bigint') v = value;
  else if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new RangeError(`Montant XOF invalide : ${value} (entier attendu)`);
    v = BigInt(value);
  } else {
    if (!/^\d+$/.test(value)) throw new RangeError(`Montant XOF invalide : « ${value} » (chiffres uniquement)`);
    v = BigInt(value);
  }
  if (v < 0n || v > XOF_MAX) throw new RangeError(`Montant XOF hors limites : ${v}`);
  return v;
}

const NARROW_NBSP = ' ';
const NBSP = ' ';

/** Format d'affichage ivoirien : « 17 500 F CFA » (espaces insécables). */
export function formatXof(amount: bigint | number): string {
  const digits = toXof(amount).toString();
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, NARROW_NBSP);
  return `${grouped}${NBSP}F${NBSP}CFA`;
}
