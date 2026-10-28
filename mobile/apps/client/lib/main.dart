import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';

import 'app.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  // Paramètres fournis à la compilation : flutter run --flavor dev --dart-define-from-file=config/dev.json
  final env = AppEnvironment.fromDefines();
  late final ProviderContainer container;
  final api = IneedApiClient(
    baseUrl: env.apiBaseUrl,
    tokenStore: SecureTokenStore(),
    onSessionExpired: () => container.read(sessionProvider.notifier).expired(),
  );
  container = ProviderContainer(overrides: [apiProvider.overrideWithValue(api), appKindProvider.overrideWithValue('CLIENT')]);
  runApp(UncontrolledProviderScope(container: container, child: IneedApp(environment: env)));
}
