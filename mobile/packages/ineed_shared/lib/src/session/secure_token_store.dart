import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:ineed_api/ineed_api.dart';

/// Jetons de session dans le stockage chiffré du système (Keychain iOS, Keystore Android).
class SecureTokenStore implements TokenStore {
  SecureTokenStore({FlutterSecureStorage? storage, this.key = 'ineed.session'}) : _storage = storage ?? const FlutterSecureStorage();

  final FlutterSecureStorage _storage;
  final String key;

  @override
  Future<StoredTokens?> read() async {
    final raw = await _storage.read(key: key);
    if (raw == null) return null;
    try {
      return StoredTokens.fromJson(jsonDecode(raw) as Map<String, Object?>);
    } on Object {
      await clear();
      return null;
    }
  }

  @override
  Future<void> write(StoredTokens t) =>
      _storage.write(key: key, value: jsonEncode({'accessToken': t.accessToken, 'refreshToken': t.refreshToken}));

  @override
  Future<void> clear() => _storage.delete(key: key);
}
