import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';

String reportReasonLabel(CommonLocalizations l, ReportReason r) => switch (r) {
      ReportReason.spam => l.reportReasonSpam,
      ReportReason.harassment => l.reportReasonHarassment,
      ReportReason.fraud => l.reportReasonFraud,
      ReportReason.offPlatformPayment => l.reportReasonOffPlatform,
      ReportReason.inappropriate => l.reportReasonInappropriate,
      ReportReason.other => l.reportReasonOther,
    };

/// Choix du motif puis envoi du signalement à la modération.
Future<void> showReportDialog(BuildContext context, WidgetRef ref, {required String targetType, required String targetId, String? title}) async {
  final l = CommonLocalizations.of(context);
  final messenger = ScaffoldMessenger.of(context);
  final reason = await showDialog<ReportReason>(
    context: context,
    builder: (context) => SimpleDialog(
      title: Text(title ?? l.reportTitle),
      children: [for (final r in ReportReason.values) SimpleDialogOption(onPressed: () => Navigator.pop(context, r), child: Text(reportReasonLabel(l, r)))],
    ),
  );
  if (reason == null) return;
  try {
    await ref.read(apiProvider).report(targetType: targetType, targetId: targetId, reason: reason);
    messenger.showSnackBar(SnackBar(content: Text(l.reportSent)));
  } on Object catch (e) {
    messenger.showSnackBar(SnackBar(content: Text(failureMessage(l, e))));
  }
}
