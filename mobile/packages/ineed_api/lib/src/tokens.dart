/// Jetons de session. Le jeton de rafraîchissement ne doit être conservé que dans un stockage chiffré
/// (Keychain iOS / Keystore Android) : voir `SecureTokenStore` dans le paquet ineed_shared.
class StoredTokens {
  const StoredTokens({required this.accessToken, required this.refreshToken});

  factory StoredTokens.fromJson(Map<String, Object?> json) =>
      StoredTokens(accessToken: json['accessToken']! as String, refreshToken: json['refreshToken']! as String);

  final String accessToken;
  final String refreshToken;
}

abstract interface class TokenStore {
  Future<StoredTokens?> read();
  Future<void> write(StoredTokens tokens);
  Future<void> clear();
}

/// Stockage en mémoire (tests).
class InMemoryTokenStore implements TokenStore {
  StoredTokens? tokens;

  @override
  Future<StoredTokens?> read() async => tokens;

  @override
  Future<void> write(StoredTokens t) async => tokens = t;

  @override
  Future<void> clear() async => tokens = null;
}
