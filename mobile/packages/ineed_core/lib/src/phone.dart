/// Numéros ivoiriens : 10 chiffres depuis 2021 ; mobiles commençant par 01 (Moov), 05 (MTN) ou 07 (Orange).
/// La validation de référence est faite par le serveur ; ce contrôle évite seulement les erreurs de saisie évidentes.
final _mobile = RegExp(r'^0[157]\d{8}$');

/// Retourne le numéro au format E.164 (+2250712345678), ou `null` s'il n'est pas un mobile ivoirien valide.
String? normalizeCiMobile(String input) {
  var digits = input.replaceAll(RegExp(r'[\s.\-()]'), '');
  if (digits.startsWith('+225')) {
    digits = digits.substring(4);
  } else if (digits.startsWith('00225')) {
    digits = digits.substring(5);
  }
  return _mobile.hasMatch(digits) ? '+225$digits' : null;
}

/// « +225 07 12 34 56 78 » ; les numéros non ivoiriens sont rendus tels quels.
String formatPhone(String e164) {
  if (!e164.startsWith('+225') || e164.length != 14) return e164;
  final national = e164.substring(4);
  final pairs = [for (var i = 0; i < national.length; i += 2) national.substring(i, i + 2)];
  return '+225 ${pairs.join(' ')}';
}
