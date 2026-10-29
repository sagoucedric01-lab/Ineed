import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';

import '../session/session.dart';

/// Ouverture du canal WebSocket ; remplaçable dans les tests (null : canal par défaut).
final realtimeChannelFactoryProvider = Provider<ChannelFactory?>((ref) => null);

/// Canal temps réel de la session (messages et accusés de lecture). Démarré par les écrans qui l'utilisent.
final realtimeProvider = Provider<RealtimeClient>((ref) {
  final api = ref.watch(apiProvider);
  final client = RealtimeClient(apiBaseUrl: api.resolve('/'), accessToken: api.currentAccessToken, connect: ref.watch(realtimeChannelFactoryProvider));
  ref.onDispose(client.close);
  return client;
});

final conversationsProvider = FutureProvider.autoDispose<List<Conversation>>((ref) => ref.read(apiProvider).conversations());

final conversationProvider = FutureProvider.autoDispose.family<Conversation, String>((ref, id) => ref.read(apiProvider).conversation(id));

final messagesProvider = FutureProvider.autoDispose.family<MessagesPage, String>((ref, id) => ref.read(apiProvider).messages(id));

final unreadMessagesProvider = FutureProvider.autoDispose<int>((ref) => ref.read(apiProvider).unreadMessages());

final complaintsProvider = FutureProvider.autoDispose<List<ComplaintSummary>>((ref) => ref.read(apiProvider).complaints());

final complaintProvider = FutureProvider.autoDispose.family<Complaint, String>((ref, id) => ref.read(apiProvider).complaint(id));

/// Jeton de notifications push de l'appareil et sa plateforme (ANDROID ou IOS).
typedef PushToken = ({String token, String platform});

/// Source du jeton push. Par défaut : aucun, tant que le projet Firebase (google-services.json,
/// GoogleService-Info.plist, clé APNs) n'est pas configuré dans les applications — voir le rapport de phase 8.
final pushTokenSourceProvider = Provider<Future<PushToken?> Function()>((ref) => () async => null);

/// Enregistre l'appareil pour les notifications push s'il dispose d'un jeton. Sans effet sinon.
Future<void> registerPushDevice(WidgetRef ref, {String? appVersion}) async {
  final api = ref.read(apiProvider);
  final token = await ref.read(pushTokenSourceProvider)();
  if (token == null) return;
  try {
    await api.registerDevice(pushToken: token.token, platform: token.platform, appVersion: appVersion);
  } on Object {
    // Nouvel essai au prochain démarrage.
  }
}
