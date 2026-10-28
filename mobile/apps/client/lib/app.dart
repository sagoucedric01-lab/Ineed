import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import 'l10n/gen/app_localizations.dart';
import 'router.dart';

class IneedApp extends ConsumerWidget {
  const IneedApp({required this.environment, super.key});

  final AppEnvironment environment;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      onGenerateTitle: (context) => CommonLocalizations.of(context).appNameClient,
      debugShowCheckedModeBanner: false,
      theme: buildIneedTheme(Brightness.light),
      darkTheme: buildIneedTheme(Brightness.dark),
      locale: const Locale('fr'),
      supportedLocales: const [Locale('fr')],
      localizationsDelegates: const [
        CommonLocalizations.delegate,
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ],
      routerConfig: ref.watch(routerProvider(environment)),
    );
  }
}
