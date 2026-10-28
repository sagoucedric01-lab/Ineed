import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';

/// Client API de l'application. Doit être fourni au démarrage (`ProviderScope(overrides: [...])`).
final apiProvider = Provider<IneedApiClient>((ref) => throw UnimplementedError('apiProvider doit être fourni au démarrage'));

/// Application courante, envoyée au serveur à la connexion : « CLIENT » ou « PRO ».
final appKindProvider = Provider<String>((ref) => throw UnimplementedError('appKindProvider doit être fourni au démarrage'));

sealed class SessionState {
  const SessionState();
}

class SignedOut extends SessionState {
  const SignedOut({this.expired = false});

  /// Vrai si la session a été fermée par le serveur (expiration, appareil déconnecté à distance).
  final bool expired;
}

class SignedIn extends SessionState {
  const SignedIn(this.me);
  final Me me;
}

/// État de session de l'application. `build()` restaure la session enregistrée au démarrage.
class SessionNotifier extends AsyncNotifier<SessionState> {
  IneedApiClient get _api => ref.read(apiProvider);

  @override
  Future<SessionState> build() async {
    if (await _api.tokenStore.read() == null) return const SignedOut();
    try {
      return SignedIn(await _api.me());
    } on ServerFailure catch (f) {
      if (f.status == 401 || f.status == 403) {
        await _api.tokenStore.clear();
        return const SignedOut(expired: true);
      }
      rethrow;
    }
  }

  /// Après une connexion réussie : charge le profil.
  Future<void> signedIn() async {
    state = AsyncData(SignedIn(await _api.me()));
  }

  Future<void> reloadMe() async {
    state = AsyncData(SignedIn(await _api.me()));
  }

  void updateMe(Me me) => state = AsyncData(SignedIn(me));

  Future<void> logout() async {
    await _api.logout();
    state = const AsyncData(SignedOut());
  }

  /// Appelé par le client API quand le serveur refuse définitivement la session.
  void expired() => state = const AsyncData(SignedOut(expired: true));

  void deleted() => state = const AsyncData(SignedOut());
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, SessionState>(SessionNotifier.new);
