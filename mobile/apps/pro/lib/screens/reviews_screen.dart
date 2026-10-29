import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../widgets/async_body.dart';

final proReviewsProvider = FutureProvider.autoDispose<List<PublicReview>>((ref) => ref.read(apiProvider).proOwnReviews());

/// P-22 : avis reçus et réponse publique (une par avis).
class ProReviewsScreen extends ConsumerWidget {
  const ProReviewsScreen({super.key});

  Future<void> _reply(BuildContext context, WidgetRef ref, PublicReview r) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final controller = TextEditingController();
    final text = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.reviewReply),
        content: TextField(controller: controller, minLines: 2, maxLines: 5, maxLength: 1000, decoration: InputDecoration(hintText: l.reviewReplyHint)),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(common.actionCancel)),
          TextButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: Text(common.actionSend)),
        ],
      ),
    );
    controller.dispose();
    if (text == null || text.length < 2) return;
    try {
      await ref.read(apiProvider).replyToReview(r.id, text);
      messenger.showSnackBar(SnackBar(content: Text(l.reviewReplied)));
      ref.invalidate(proReviewsProvider);
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.reviewsTitlePro)),
      body: AsyncBody(
        value: ref.watch(proReviewsProvider),
        onRetry: () => ref.invalidate(proReviewsProvider),
        builder: (list) => list.isEmpty
            ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(l.reviewsEmptyPro, textAlign: TextAlign.center)))
            : ListView(padding: const EdgeInsets.all(IneedSpacing.s4), children: [
                for (final r in list)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(IneedSpacing.s3),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(l.reviewStarsPro('${r.rating}', r.author), style: text.titleSmall),
                        if (r.status == 'PENDING_MODERATION') Text(l.reviewPendingModeration, style: text.bodySmall?.copyWith(color: c.textMuted)),
                        if (r.comment != null) Text(r.comment!),
                        Text(formatAbidjanDateTime(r.createdAt), style: text.bodySmall),
                        if (r.proReply != null)
                          Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(l.reviewYourReply(r.proReply!), style: text.bodySmall))
                        else if (r.status == 'PUBLISHED')
                          Align(alignment: Alignment.centerRight, child: TextButton(onPressed: () => _reply(context, ref, r), child: Text(l.reviewReply))),
                      ]),
                    ),
                  ),
              ]),
      ),
    );
  }
}
