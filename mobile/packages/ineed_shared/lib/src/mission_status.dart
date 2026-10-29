import '../l10n/gen/common_localizations.dart';

/// Libellé d'un statut de mission, identique dans les deux applications.
String missionStatusLabel(CommonLocalizations l, String status) => switch (status) {
      'AWAITING_QUOTE' => l.missionStatusAwaitingQuote,
      'QUOTE_PENDING_APPROVAL' => l.missionStatusQuotePending,
      'CONFIRMED' => l.missionStatusConfirmed,
      'PAYMENT_PENDING' => l.missionStatusPaymentPending,
      'PAYMENT_CONFIRMED' => l.missionStatusPaymentConfirmed,
      'EN_ROUTE' => l.missionStatusEnRoute,
      'ARRIVED' => l.missionStatusArrived,
      'IN_PROGRESS' => l.missionStatusInProgress,
      'WORK_COMPLETED' => l.missionStatusWorkCompleted,
      'CLOSED' => l.missionStatusClosed,
      'DISPUTED' => l.missionStatusDisputed,
      _ => l.missionStatusCancelled,
    };
