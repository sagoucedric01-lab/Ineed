import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';

import 'helpers.dart';

void main() {
  testWidgets('premier lancement : présentation, numéro, code, prénom et nom, accueil avec les métiers', (tester) async {
    var me = meJson();
    final server = FakeServer({
      'POST /v1/auth/otp/request': (_) async => jsonResponse(202, challengeJson()),
      'POST /v1/auth/otp/verify': (o) async => (o.data as Map)['code'] == '123456'
          ? jsonResponse(200, {'tokens': {'accessToken': 'A', 'refreshToken': 'R'}, 'user': {'id': 'u1'}, 'isNewUser': true, 'profileComplete': false})
          : errorResponse(400, 'OTP_INVALID', 'Code incorrect.', {'attemptsLeft': 4}),
      'GET /v1/me': (_) async => jsonResponse(200, me),
      'PATCH /v1/me': (o) async {
        final body = o.data as Map;
        me = meJson(firstName: body['firstName'] as String, lastName: body['lastName'] as String);
        return jsonResponse(200, me);
      },
      'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
    });
    final store = InMemoryTokenStore();
    await pumpClientApp(tester, server, store);

    expect(find.text('Décrivez votre problème'), findsOneWidget);
    await tester.tap(find.text('Passer'));
    await tester.pumpAndSettle();

    // Numéro invalide : refusé sans appel au serveur.
    await enterAndSettle(tester, find.byType(TextField), '27 22 44 55 66');
    await tester.tap(find.text('Recevoir le code'));
    await tester.pumpAndSettle();
    expect(find.textContaining('10 chiffres'), findsOneWidget);
    expect(server.count('POST /v1/auth/otp/request'), 0);

    await enterAndSettle(tester, find.byType(TextField), '0712345678');
    expect(tester.widget<TextField>(find.byType(TextField)).controller!.text, '07 12 34 56 78');
    await tester.tap(find.text('Recevoir le code'));
    await tester.pumpAndSettle();
    expect((server.last('POST /v1/auth/otp/request').data as Map)['phone'], '+2250712345678');
    expect(find.text('Saisissez le code'), findsOneWidget);
    expect(find.textContaining('Mode développement'), findsOneWidget);

    await enterAndSettle(tester, find.byType(TextField), '000000');
    expect(find.textContaining('Il vous reste 4 essais'), findsOneWidget);
    await enterAndSettle(tester, find.byType(TextField), '123456');
    expect((server.last('POST /v1/auth/otp/verify').data as Map)['app'], 'CLIENT');
    expect(store.tokens?.refreshToken, 'R');

    expect(find.text('Comment vous appelez-vous\u00A0?'), findsOneWidget);
    await tester.enterText(find.byType(TextField).at(0), 'Awa');
    await tester.enterText(find.byType(TextField).at(1), 'Koné');
    await tester.tap(find.text('Continuer'));
    await tester.pumpAndSettle();

    expect(find.text('Bonjour Awa'), findsOneWidget);
    expect(find.text('Plomberie'), findsOneWidget);
    expect(find.text('Électricité'), findsOneWidget);
  });

  testWidgets('session enregistrée : ouverture directe sur l’accueil', (tester) async {
    final server = FakeServer({
      'GET /v1/me': (o) async => o.headers['authorization'] == 'Bearer A' ? jsonResponse(200, meJson(firstName: 'Awa', lastName: 'Koné')) : errorResponse(401, 'UNAUTHENTICATED', 'Session expirée'),
      'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
    });
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    await pumpClientApp(tester, server, store);
    expect(find.text('Bonjour Awa'), findsOneWidget);
  });

  testWidgets('session refusée par le serveur au démarrage : retour à la présentation', (tester) async {
    final server = FakeServer({
      'GET /v1/me': (_) async => errorResponse(401, 'UNAUTHENTICATED', 'Session expirée'),
      'POST /v1/auth/refresh': (_) async => errorResponse(401, 'UNAUTHENTICATED', 'Session expirée'),
    });
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    await pumpClientApp(tester, server, store);
    expect(find.text('Décrivez votre problème'), findsOneWidget);
    expect(store.tokens, isNull);
  });

  testWidgets('serveur injoignable au démarrage : message et bouton Réessayer', (tester) async {
    var down = true;
    final server = FakeServer({
      'GET /v1/me': (o) async => down ? throw DioException.connectionError(requestOptions: o, reason: 'réseau') : jsonResponse(200, meJson(firstName: 'Awa', lastName: 'Koné')),
      'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
    });
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    await pumpClientApp(tester, server, store);
    expect(find.textContaining('Pas de connexion internet'), findsOneWidget);
    expect(store.tokens, isNotNull);
    down = false;
    await tester.tap(find.text('Réessayer'));
    await tester.pumpAndSettle();
    expect(find.text('Bonjour Awa'), findsOneWidget);
  });

  testWidgets('compte : déconnexion après confirmation', (tester) async {
    final server = FakeServer({
      'GET /v1/me': (_) async => jsonResponse(200, meJson(firstName: 'Awa', lastName: 'Koné')),
      'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
      'POST /v1/auth/logout': (_) async => ResponseBody.fromString('', 204),
    });
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    await pumpClientApp(tester, server, store);
    await tester.tap(find.byIcon(Icons.account_circle_outlined));
    await tester.pumpAndSettle();
    expect(find.text('+225 07 12 34 56 78'), findsOneWidget);
    await tester.tap(find.text('Se déconnecter'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Se déconnecter').last);
    await tester.pumpAndSettle();
    expect(server.count('POST /v1/auth/logout'), 1);
    expect(store.tokens, isNull);
    expect(find.text('Décrivez votre problème'), findsOneWidget);
  });

  testWidgets('suppression du compte : code SMS dédié puis retour à la présentation', (tester) async {
    final server = FakeServer({
      'GET /v1/me': (_) async => jsonResponse(200, meJson(firstName: 'Awa', lastName: 'Koné')),
      'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
      'POST /v1/me/deletion/code': (_) async => jsonResponse(202, challengeJson()),
      'POST /v1/me/deletion': (_) async => ResponseBody.fromString('', 204),
    });
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    await pumpClientApp(tester, server, store);
    await tester.tap(find.byIcon(Icons.account_circle_outlined));
    await tester.pumpAndSettle();
    await tester.scrollUntilVisible(find.text('Supprimer mon compte'), 100);
    await tester.tap(find.text('Supprimer mon compte'));
    await tester.pumpAndSettle();
    expect(find.text('Supprimer votre compte\u00A0?'), findsOneWidget);
    await tester.tap(find.text('Supprimer définitivement'));
    await tester.pumpAndSettle();
    expect(find.text('Confirmez avec le code reçu par SMS'), findsOneWidget);
    await enterAndSettle(tester, find.byType(TextField), '654321');
    expect((server.last('POST /v1/me/deletion').data as Map)['code'], '654321');
    expect(store.tokens, isNull);
    expect(find.text('Décrivez votre problème'), findsOneWidget);
  });
}
