/// Environnement d'exécution, fixé à la compilation :
/// `flutter run --dart-define-from-file=config/dev.json` (voir apps/*/config).
enum AppEnvironmentName { dev, staging, prod }

class AppEnvironment {
  const AppEnvironment({required this.name, required this.apiBaseUrl});

  /// Lit les valeurs passées par `--dart-define` / `--dart-define-from-file`.
  /// Une valeur absente ou invalide lève une [StateError] dès le démarrage plutôt qu'une panne plus tard.
  factory AppEnvironment.fromDefines() => AppEnvironment.parse(
        name: const String.fromEnvironment('INEED_ENV'),
        apiBaseUrl: const String.fromEnvironment('INEED_API_URL'),
      );

  factory AppEnvironment.parse({required String name, required String apiBaseUrl}) {
    final env = AppEnvironmentName.values.where((e) => e.name == name).firstOrNull;
    if (env == null) {
      throw StateError('INEED_ENV doit valoir dev, staging ou prod (reçu : « $name »). '
          'Lancez avec --dart-define-from-file=config/dev.json.');
    }
    final uri = Uri.tryParse(apiBaseUrl);
    if (uri == null || !uri.hasScheme || uri.host.isEmpty) {
      throw StateError('INEED_API_URL invalide : « $apiBaseUrl ».');
    }
    if (env == AppEnvironmentName.prod && uri.scheme != 'https') {
      throw StateError('INEED_API_URL doit utiliser HTTPS en production.');
    }
    return AppEnvironment(name: env, apiBaseUrl: uri);
  }

  final AppEnvironmentName name;
  final Uri apiBaseUrl;

  bool get isProduction => name == AppEnvironmentName.prod;
}
