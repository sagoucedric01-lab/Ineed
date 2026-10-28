import 'package:flutter/material.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

String requestStatusLabel(AppLocalizations l, String status) => switch (status) {
      'DRAFT' => l.requestStatusDraft,
      'PUBLISHED' => l.requestStatusPublished,
      'MATCHING' => l.requestStatusMatching,
      'OFFERS_RECEIVED' => l.requestStatusOffersReceived,
      'NO_PROVIDER_FOUND' => l.requestStatusNoProvider,
      'PROVISIONALLY_RESERVED' => l.requestStatusReserved,
      'AWAITING_CLIENT_CONFIRMATION' => l.requestStatusAwaitingConfirmation,
      'ASSIGNED' => l.requestStatusAssigned,
      'EXPIRED' => l.requestStatusExpired,
      _ => l.requestStatusCancelled,
    };

class RequestStatusChip extends StatelessWidget {
  const RequestStatusChip({required this.status, super.key});

  final String status;

  @override
  Widget build(BuildContext context) {
    final c = context.ineedColors;
    final (bg, fg) = switch (status) {
      'DRAFT' => (c.surfaceMuted, c.textMuted),
      'CANCELLED' || 'EXPIRED' || 'NO_PROVIDER_FOUND' => (c.dangerSoft, c.onDangerSoft),
      'ASSIGNED' => (c.successSoft, c.onSuccessSoft),
      _ => (c.actionSoft, c.onActionSoft),
    };
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: IneedSpacing.s2, vertical: IneedSpacing.s1),
      decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(IneedRadius.sm)),
      child: Text(requestStatusLabel(AppLocalizations.of(context), status), style: Theme.of(context).textTheme.labelMedium?.copyWith(color: fg)),
    );
  }
}
