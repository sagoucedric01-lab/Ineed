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
  const ServerFailure({required this.status, required this.code, required this.message, this.requestId, this.details});
  final int status;
  final String code;
  final String message;
  final String? requestId;
  final Object? details;

  Map<String, Object?> get _detailsMap => details is Map<String, Object?> ? details! as Map<String, Object?> : const {};

  /// Essais restants après un code SMS erroné (OTP_INVALID).
  int? get attemptsLeft => _detailsMap['attemptsLeft'] as int?;

  /// Délai à respecter avant de réessayer (RATE_LIMITED, OTP_RESEND_TOO_SOON, ACCOUNT_LOCKED).
  int? get retryAfterSeconds => _detailsMap['retryAfterSeconds'] as int?;

  /// Éléments manquants d'un dossier professionnel (PROFILE_INCOMPLETE).
  List<String> get missing => (_detailsMap['missing'] as List<Object?>?)?.whereType<String>().toList() ?? const [];
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
