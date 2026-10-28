/// État des dépendances de l'API (réponse de GET /health/ready).
enum ApiDependency { database, redis, storage }

class Readiness {
  const Readiness({required this.ok, required this.unavailable});

  /// Lève une [FormatException] si la réponse n'a pas la forme attendue.
  factory Readiness.fromJson(Object? json) {
    if (json is! Map<String, Object?>) throw const FormatException('Rapport de santé invalide');
    final checks = json['checks'];
    final status = json['status'];
    if (checks is! Map<String, Object?> || (status != 'ok' && status != 'error')) {
      throw const FormatException('Rapport de santé invalide');
    }
    final down = <ApiDependency>[
      for (final d in ApiDependency.values)
        if ((checks[d.name] as Map<String, Object?>?)?['status'] != 'ok') d,
    ];
    return Readiness(ok: status == 'ok', unavailable: down);
  }

  final bool ok;
  final List<ApiDependency> unavailable;
}
