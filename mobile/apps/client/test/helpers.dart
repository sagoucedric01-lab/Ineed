import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_client/app.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';

final devEnv = AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://api.test');

Map<String, Object?> meJson({String? firstName, String? lastName}) => {
      'id': 'u1',
      'phone': '+2250712345678',
      'firstName': firstName,
      'lastName': lastName,
      'avatarUrl': null,
      'roles': ['CLIENT'],
      'profileComplete': firstName != null && lastName != null,
      'proStatus': null,
      'createdAt': '2026-10-28T10:00:00Z',
    };

final categoriesJson = [
  {'id': 'c1', 'slug': 'plomberie', 'name': 'Plomberie', 'iconKey': 'plomberie', 'skills': <Object>[]},
  {'id': 'c2', 'slug': 'electricite', 'name': 'Électricité', 'iconKey': 'electricite', 'skills': <Object>[]},
];

Map<String, Object?> challengeJson() => {
      'challengeId': 'ch1',
      'expiresAt': DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String(),
      'resendAvailableAt': DateTime.now().add(const Duration(seconds: 60)).toUtc().toIso8601String(),
      'devMode': true,
    };

/// Démarre l'application client complète sur un faux serveur.
Future<ProviderContainer> pumpClientApp(WidgetTester tester, FakeServer server, TokenStore store, {List<Override> overrides = const [], bool tallScreen = false, List<FakeWebSocketChannel>? realtime}) async {
  if (tallScreen) {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2;
    addTearDown(tester.view.reset);
  }
  late final ProviderContainer container;
  final api = IneedApiClient(baseUrl: devEnv.apiBaseUrl, tokenStore: store, adapter: server, uploadAdapter: server, onSessionExpired: () => container.read(sessionProvider.notifier).expired());
  // Pas de relance automatique dans les tests : chaque requête est explicite.
  container = ProviderContainer(retry: (_, _) => null, overrides: [
    apiProvider.overrideWithValue(api),
    appKindProvider.overrideWithValue('CLIENT'),
    // Canal temps réel factice : les tests y poussent les événements du serveur.
    realtimeChannelFactoryProvider.overrideWithValue((_) {
      final c = FakeWebSocketChannel();
      realtime?.add(c);
      return c;
    }),
    ...overrides,
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: IneedApp(environment: devEnv)));
  await tester.pumpAndSettle();
  return container;
}

Future<void> enterAndSettle(WidgetTester tester, Finder field, String text) async {
  await tester.enterText(field, text);
  await tester.pumpAndSettle();
}
