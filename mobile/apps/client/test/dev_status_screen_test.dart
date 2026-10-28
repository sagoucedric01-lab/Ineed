import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_client/app.dart';
import 'package:ineed_core/ineed_core.dart';

final devEnv = AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://10.0.2.2:3000');
final prodEnv = AppEnvironment.parse(name: 'prod', apiBaseUrl: 'https://api.ineed.example');

void main() {
  testWidgets('affiche « API joignable » quand tous les services répondent', (tester) async {
    await tester.pumpWidget(IneedApp(environment: devEnv, checkApi: () async => const Readiness(ok: true, unavailable: [])));
    await tester.pumpAndSettle();
    expect(find.text('API joignable\u00A0: tous les services répondent.'), findsOneWidget);
    expect(find.text('Environnement\u00A0: développement'), findsOneWidget);
  });

  testWidgets('nomme le service indisponible (API dégradée)', (tester) async {
    await tester.pumpWidget(IneedApp(
      environment: devEnv,
      checkApi: () async => const Readiness(ok: false, unavailable: [ApiDependency.storage]),
    ));
    await tester.pumpAndSettle();
    expect(find.text('API joignable, mais un service est indisponible : stockage des fichiers.'), findsOneWidget);
  });

  testWidgets('API injoignable puis « Réessayer » relance la vérification', (tester) async {
    var calls = 0;
    await tester.pumpWidget(IneedApp(
      environment: devEnv,
      checkApi: () async {
        calls++;
        if (calls == 1) throw const NetworkFailure();
        return const Readiness(ok: true, unavailable: []);
      },
    ));
    await tester.pumpAndSettle();
    expect(find.text('Impossible de joindre l’API à l’adresse http://10.0.2.2:3000.'), findsOneWidget);
    await tester.tap(find.text('Réessayer'));
    await tester.pumpAndSettle();
    expect(calls, 2);
    expect(find.text('API joignable\u00A0: tous les services répondent.'), findsOneWidget);
  });

  testWidgets('pas de double vérification pendant un chargement', (tester) async {
    final pending = Completer<Readiness>();
    var calls = 0;
    await tester.pumpWidget(IneedApp(environment: devEnv, checkApi: () { calls++; return pending.future; }));
    await tester.pump();
    await tester.tap(find.byType(OutlinedButton), warnIfMissed: false);
    await tester.pump();
    expect(calls, 1);
    pending.complete(const Readiness(ok: true, unavailable: []));
    await tester.pumpAndSettle();
  });

  testWidgets('aucun badge d’environnement en production', (tester) async {
    await tester.pumpWidget(IneedApp(environment: prodEnv, checkApi: () async => const Readiness(ok: true, unavailable: [])));
    await tester.pumpAndSettle();
    expect(find.textContaining('Environnement'), findsNothing);
  });
}
