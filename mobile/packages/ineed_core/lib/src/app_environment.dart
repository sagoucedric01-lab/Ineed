/// Environnement d'exécution, fixé à la compilation :
/// `flutter run --dart-define-from-file=config/dev.json` (voir apps/*/config).
enum AppEnvironmentName { dev, staging, prod }

class AppEnvironment {
  const AppEnvironment({required this.name, required this.apiBaseUrl, this.mapTileUrl});

  /// Lit les valeurs passées par `--dart-define` / `--dart-define-from-file`.
  /// Une valeur absente ou invalide lève une [StateError] dès le démarrage plutôt qu'une panne plus tard.
  factory AppEnvironment.fromDefines() => AppEnvironment.parse(
        name: const String.fromEnvironment('INEED_ENV'),
        apiBaseUrl: const String.fromEnvironment('INEED_API_URL'),
        mapTileUrl: const String.fromEnvironment('INEED_MAP_TILE_URL'),
      );

  factory AppEnvironment.parse({required String name, required String apiBaseUrl, String mapTileUrl = ''}) {
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
    final tiles = mapTileUrl.trim();
    if (tiles.isNotEmpty && (!tiles.startsWith('https://') || !tiles.contains('{z}') || !tiles.contains('{x}') || !tiles.contains('{y}'))) {
      throw StateError('INEED_MAP_TILE_URL doit être une adresse HTTPS contenant {z}, {x} et {y}.');
    }
    // Les tuiles publiques d'OpenStreetMap ne sont pas prévues pour un usage commercial à grande échelle :
    // la production doit utiliser un fournisseur de cartes sous contrat.
    if (env == AppEnvironmentName.prod && tiles.contains('tile.openstreetmap.org')) {
      throw StateError('INEED_MAP_TILE_URL : les tuiles publiques OpenStreetMap sont réservées au développement.');
    }
    return AppEnvironment(name: env, apiBaseUrl: uri, mapTileUrl: tiles.isEmpty ? null : tiles);
  }

  final AppEnvironmentName name;
  final Uri apiBaseUrl;

  /// Modèle d'URL des tuiles de carte (`https://…/{z}/{x}/{y}.png`). Absent : la carte n'est pas affichée et
  /// l'adresse se saisit par la position du téléphone, la commune et un repère.
  final String? mapTileUrl;

  bool get isProduction => name == AppEnvironmentName.prod;
}
