import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_shared/l10n/gen/common_localizations_fr.dart';
import 'package:ineed_shared/src/widgets/phone_formatter.dart';

void main() {
  test('numéro saisi regroupé par deux chiffres, 10 chiffres au plus', () {
    final f = CiPhoneFormatter();
    String format(String s) => f.formatEditUpdate(TextEditingValue.empty, TextEditingValue(text: s)).text;
    expect(format('0712345678'), '07 12 34 56 78');
    expect(format('07-12'), '07 12');
    expect(format('071234567899'), '07 12 34 56 78');
  });

  test('type d’image reconnu d’après le contenu, pas d’après le nom', () {
    expect(imageMimeType(Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0])), 'image/jpeg');
    expect(imageMimeType(Uint8List.fromList([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0])), 'image/png');
    expect(imageMimeType(Uint8List.fromList('RIFF\x00\x00\x00\x00WEBPVP8 '.codeUnits)), 'image/webp');
    expect(imageMimeType(Uint8List.fromList('%PDF-1.4'.codeUnits)), isNull);
  });

  test('messages d’erreur en français selon la cause', () {
    final l = CommonLocalizationsFr();
    expect(failureMessage(l, const NetworkFailure()), l.errorNetwork);
    expect(failureMessage(l, const ServerFailure(status: 503, code: 'X', message: 'interne')), l.errorServer);
    expect(failureMessage(l, const ServerFailure(status: 409, code: 'ACCOUNT_HAS_ACTIVE_ACTIVITY', message: 'Une demande est en cours.')), 'Une demande est en cours.');
  });
}
