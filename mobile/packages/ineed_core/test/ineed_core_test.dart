import 'package:ineed_core/ineed_core.dart';
import 'package:test/test.dart';

void main() {
  group('formatXof (identique au backend)', () {
    test('groupe les milliers avec des espaces insécables', () {
      expect(formatXof(0), '0 F CFA');
      expect(formatXof(17500), '17 500 F CFA');
      expect(formatXof(1250000), '1 250 000 F CFA');
    });
    test('refuse un montant négatif', () => expect(() => formatXof(-1), throwsRangeError));
  });

  group('normalizeCiMobile', () {
    for (final input in ['07 12 34 56 78', '0712345678', '+225 07 12 34 56 78', '00225-07-12-34-56-78']) {
      test('« $input »', () => expect(normalizeCiMobile(input), '+2250712345678'));
    }
    test('accepte 01 et 05', () {
      expect(normalizeCiMobile('01 02 03 04 05'), '+2250102030405');
      expect(normalizeCiMobile('05 06 07 08 09'), '+2250506070809');
    });
    for (final input in ['12345', '07 12 34', '0712345678901', '27 22 44 55 66', 'abc']) {
      test('refuse « $input »', () => expect(normalizeCiMobile(input), isNull));
    }
  });

  test('formatPhone', () => expect(formatPhone('+2250712345678'), '+225 07 12 34 56 78'));

  test('formatAbidjanDateTime (identique au backend)', () {
    expect(formatAbidjanDateTime(DateTime.utc(2026, 10, 28, 10, 23)), '28/10/2026 à 10:23');
    expect(formatAbidjanDateTime(DateTime.parse('2026-07-01T23:59:00Z')), '01/07/2026 à 23:59');
  });

  group('AppEnvironment.parse', () {
    test('accepte une configuration de développement', () {
      final env = AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://10.0.2.2:3000');
      expect(env.name, AppEnvironmentName.dev);
      expect(env.isProduction, isFalse);
    });
    test('refuse un environnement inconnu ou vide', () {
      expect(() => AppEnvironment.parse(name: '', apiBaseUrl: 'http://x'), throwsStateError);
      expect(() => AppEnvironment.parse(name: 'production', apiBaseUrl: 'https://x'), throwsStateError);
    });
    test('exige HTTPS en production', () {
      expect(() => AppEnvironment.parse(name: 'prod', apiBaseUrl: 'http://api.ineed.ci'), throwsStateError);
      expect(AppEnvironment.parse(name: 'prod', apiBaseUrl: 'https://api.ineed.ci').isProduction, isTrue);
    });
    test('fond de carte : adresse HTTPS avec {z}/{x}/{y} ; tuiles publiques OSM interdites en production', () {
      const osm = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      expect(AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://x', mapTileUrl: osm).mapTileUrl, osm);
      expect(AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://x').mapTileUrl, isNull);
      expect(() => AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://x', mapTileUrl: 'http://tiles/{z}/{x}/{y}'), throwsStateError);
      expect(() => AppEnvironment.parse(name: 'prod', apiBaseUrl: 'https://x', mapTileUrl: osm), throwsStateError);
    });
    test('refuse une URL invalide', () => expect(() => AppEnvironment.parse(name: 'dev', apiBaseUrl: 'pas une url'), throwsStateError));
  });
}
