import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import 'dev_status_screen.dart';
import 'l10n/gen/app_localizations.dart';

class IneedApp extends StatelessWidget {
  const IneedApp({required this.environment, required this.checkApi, super.key});

  final AppEnvironment environment;
  final Future<Readiness> Function() checkApi;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      onGenerateTitle: (context) => AppLocalizations.of(context).appNameClient,
      debugShowCheckedModeBanner: false,
      theme: buildIneedTheme(Brightness.light),
      darkTheme: buildIneedTheme(Brightness.dark),
      locale: const Locale('fr'),
      supportedLocales: AppLocalizations.supportedLocales,
      localizationsDelegates: const [
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      home: DevStatusScreen(environment: environment, checkApi: checkApi),
    );
  }
}
