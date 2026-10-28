/// Montants en francs CFA (XOF) : toujours des entiers, jamais de nombres à virgule.
/// Format identique à celui du backend (`formatXof`) : « 17 500 F CFA ».
const _narrowNbsp = ' ';
const _nbsp = ' ';

String formatXof(int amount) {
  if (amount < 0) throw RangeError.value(amount, 'amount', 'Un montant XOF ne peut pas être négatif');
  final digits = amount.toString();
  final buffer = StringBuffer();
  for (var i = 0; i < digits.length; i++) {
    if (i > 0 && (digits.length - i) % 3 == 0) buffer.write(_narrowNbsp);
    buffer.write(digits[i]);
  }
  return '$buffer${_nbsp}F${_nbsp}CFA';
}
