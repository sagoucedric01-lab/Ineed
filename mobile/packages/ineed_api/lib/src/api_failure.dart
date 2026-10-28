/// Échecs d'appel à l'API, typés pour que l'interface affiche le bon message (textes dans les ARB).
sealed class ApiFailure implements Exception {
  const ApiFailure();
}

/// Pas de réseau, DNS, connexion refusée : l'utilisateur doit vérifier sa connexion.
class NetworkFailure extends ApiFailure {
  const NetworkFailure();
  @override
  String toString() => 'NetworkFailure';
}

/// Le serveur n'a pas répondu dans le délai.
class TimeoutFailure extends ApiFailure {
  const TimeoutFailure();
  @override
  String toString() => 'TimeoutFailure';
}

/// Le serveur a répondu avec une erreur au format `{ error: { code, message, requestId } }`.
/// [message] est déjà rédigé en français par le serveur.
class ServerFailure extends ApiFailure {
  const ServerFailure({required this.status, required this.code, required this.message, this.requestId});
  final int status;
  final String code;
  final String message;
  final String? requestId;
  @override
  String toString() => 'ServerFailure($status, $code, requestId: $requestId)';
}

/// Réponse illisible (proxy, page HTML, JSON inattendu).
class UnexpectedResponseFailure extends ApiFailure {
  const UnexpectedResponseFailure(this.status);
  final int? status;
  @override
  String toString() => 'UnexpectedResponseFailure($status)';
}
