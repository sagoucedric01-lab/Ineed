import 'package:ineed_api/ineed_api.dart';

import '../l10n/gen/common_localizations.dart';

/// Message à afficher pour une erreur. Les messages du serveur sont déjà rédigés en français ;
/// quelques codes ont un texte plus précis côté application.
String failureMessage(CommonLocalizations l, Object error) {
  return switch (error) {
    NetworkFailure() => l.errorNetwork,
    TimeoutFailure() => l.errorTimeout,
    UnexpectedResponseFailure() => l.errorServer,
    ServerFailure(code: 'OTP_INVALID', :final attemptsLeft) when attemptsLeft != null => l.authOtpWrong(attemptsLeft),
    ServerFailure(code: 'OTP_EXPIRED') || ServerFailure(code: 'OTP_NOT_FOUND') => l.authOtpExpired,
    ServerFailure(code: 'UNAUTHENTICATED') || ServerFailure(code: 'TOKEN_EXPIRED') => l.errorSessionExpired,
    ServerFailure(:final status) when status >= 500 => l.errorServer,
    ServerFailure(:final message) => message,
    _ => l.errorServer,
  };
}

/// Relance automatique des chargements (Riverpod) : uniquement après une coupure réseau ou un délai dépassé,
/// trois fois au plus, avec un délai croissant. Une erreur du serveur (refus, élément absent) n'est jamais relancée.
Duration? ineedRetry(int retryCount, Object error) {
  if (retryCount >= 3) return null;
  if (error is! NetworkFailure && error is! TimeoutFailure) return null;
  return Duration(seconds: 2 << retryCount);
}
