import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_pro/dev_status_screen.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import 'helpers.dart';

Widget host(Future<Readiness> Function() check) => MaterialApp(
      theme: buildIneedTheme(Brightness.light),
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: const [CommonLocalizations.delegate, GlobalMaterialLocalizations.delegate, GlobalWidgetsLocalizations.delegate, GlobalCupertinoLocalizations.delegate],
      home: DevStatusScreen(environment: devEnv, checkApi: check),
    );

void main() {
  testWidgets('écran technique : API joignable', (tester) async {
    await tester.pumpWidget(host(() async => const Readiness(ok: true, unavailable: [])));
    await tester.pumpAndSettle();
    expect(find.text('API joignable : tous les services répondent.'), findsOneWidget);
  });

  testWidgets('écran technique : API injoignable puis Réessayer', (tester) async {
    var calls = 0;
    await tester.pumpWidget(host(() async {
      calls++;
      if (calls == 1) throw const NetworkFailure();
      return const Readiness(ok: false, unavailable: [ApiDependency.storage]);
    }));
    await tester.pumpAndSettle();
    expect(find.textContaining('Impossible de joindre l’API'), findsOneWidget);
    await tester.tap(find.text('Réessayer'));
    await tester.pumpAndSettle();
    expect(find.textContaining('stockage des fichiers'), findsOneWidget);
  });
}
