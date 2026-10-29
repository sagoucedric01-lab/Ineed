import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

final missionReviewProvider = FutureProvider.autoDispose.family<MissionReviewState, String>((ref, id) => ref.read(apiProvider).missionReview(id));

/// Échanges autour d'une mission : message au professionnel, avis après clôture, réclamation.
class MissionEngagement extends ConsumerWidget {
  const MissionEngagement({required this.mission, super.key});

  final Mission mission;

  Future<void> _openChat(BuildContext context, WidgetRef ref) async {
    final common = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final conv = await ref.read(apiProvider).openConversation(mission.requestId, proId: mission.proId);
      if (context.mounted) await context.push('/messages/${conv.id}');
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final m = mission;
    final closed = m.status == 'CLOSED';
    final review = closed ? ref.watch(missionReviewProvider(m.id)).value : null;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (closed && review != null) ...[
        if (review.review != null)
          Card(
            child: ListTile(
              title: Text(l.reviewMine('${review.review!.rating}')),
              subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                if (review.review!.comment != null) Text(review.review!.comment!),
                if (review.review!.status != 'PUBLISHED') Text(l.reviewPending, style: text.bodySmall),
                if (review.review!.proReply != null) Text(l.reviewProReply(review.review!.proReply!), style: text.bodySmall),
              ]),
            ),
          )
        else if (review.canReview)
          IneedButton(
            label: l.reviewGive,
            icon: Icons.star_outline,
            onPressed: () async {
              await context.push('/missions/${m.id}/avis', extra: m.proName);
              ref.invalidate(missionReviewProvider(m.id));
            },
          ),
        const SizedBox(height: IneedSpacing.s2),
      ],
      OutlinedButton.icon(onPressed: () => _openChat(context, ref), icon: const Icon(Icons.chat_bubble_outline), label: Text(common.chatOpen)),
      if (m.status != 'CANCELLED')
        TextButton.icon(
          onPressed: () => context.push('/reclamations/nouvelle', extra: <String, String?>{'missionId': m.id, 'missionReference': m.reference}),
          icon: const Icon(Icons.report_problem_outlined),
          label: Text(common.complaintNew),
        ),
    ]);
  }
}
