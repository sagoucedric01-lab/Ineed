import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/request_status.dart';
import '../widgets/slot_picker.dart';
import 'request_form_screen.dart';

/// C-16 : relecture d'un brouillon avant publication, puis suivi de la demande publiée.
class RequestDetailScreen extends ConsumerStatefulWidget {
  const RequestDetailScreen({required this.requestId, super.key});

  final String requestId;

  @override
  ConsumerState<RequestDetailScreen> createState() => _RequestDetailScreenState();
}

class _RequestDetailScreenState extends ConsumerState<RequestDetailScreen> {
  bool _busy = false;

  Future<void> _run(Future<ServiceRequest> Function() action, String done) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(requestProvider(widget.requestId));
      ref.invalidate(activeRequestsProvider);
      messenger.showSnackBar(SnackBar(content: Text(done)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l.requestCancelConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(common.actionBack)),
          TextButton(onPressed: () => Navigator.pop(context, true), child: Text(l.matchingCancel)),
        ],
      ),
    );
    if (ok == true) await _run(() => ref.read(apiProvider).cancelRequest(widget.requestId), l.requestCancelled);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.requestDetailTitle)),
      body: ref.watch(requestProvider(widget.requestId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(IneedSpacing.s6),
                child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(requestProvider(widget.requestId))),
              ),
            ),
            data: (r) {
              Widget row(String label, String value) => Padding(
                    padding: const EdgeInsets.only(bottom: IneedSpacing.s3),
                    child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      Text(label, style: text.labelMedium?.copyWith(color: c.textMuted)),
                      Text(value, style: text.bodyLarge),
                    ]),
                  );
              final place = r.place;
              final photos = r.media.where((m) => m.kind == 'PHOTO').toList();
              final hasVoice = r.media.any((m) => m.kind == 'VOICE');
              return ListView(
                padding: const EdgeInsets.all(IneedSpacing.s4),
                children: [
                  Row(children: [
                    Expanded(child: Text(r.isDraft ? l.requestReviewTitle : (r.service?.name ?? r.category.name), style: text.titleLarge)),
                    RequestStatusChip(status: r.status),
                  ]),
                  const SizedBox(height: IneedSpacing.s4),
                  if (r.status == 'PUBLISHED') ...[IneedBanner(message: l.requestPublishedPending), const SizedBox(height: IneedSpacing.s4)],
                  row(l.requestReviewService, [r.category.name, if (r.service != null) r.service!.name].join(' · ')),
                  row(l.requestReviewWhen, r.window == null ? l.requestModeUrgent : slotLabel(l, r.window!)),
                  row(
                    l.requestReviewWhere,
                    [
                      [place.label, place.zoneName ?? place.cityName].whereType<String>().join(' · '),
                      if (place.landmark != null) place.landmark!,
                      if (place.street != null) place.street!,
                      if (place.instructions != null) place.instructions!,
                    ].join('\n'),
                  ),
                  row(l.requestReviewDetails, r.description),
                  if (r.budgetXof != null) row(l.requestBudget, formatXof(r.budgetXof!)),
                  if (photos.isNotEmpty)
                    Wrap(spacing: IneedSpacing.s2, runSpacing: IneedSpacing.s2, children: [
                      for (final m in photos)
                        ClipRRect(
                          borderRadius: BorderRadius.circular(IneedRadius.sm),
                          child: SizedBox.square(dimension: 84, child: Image.network(m.url, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.image_outlined))),
                        ),
                    ]),
                  if (hasVoice) ListTile(contentPadding: EdgeInsets.zero, leading: const Icon(Icons.mic_none), title: Text(l.requestVoiceNote)),
                  if (r.isDraft) ...[
                    const SizedBox(height: IneedSpacing.s3),
                    Text(l.requestReviewPrivacy, style: text.bodySmall?.copyWith(color: c.textMuted)),
                    const SizedBox(height: IneedSpacing.s4),
                    IneedButton(label: l.requestPublish, loading: _busy, onPressed: () => _run(() => ref.read(apiProvider).publishRequest(r.id), l.requestPublished)),
                    const SizedBox(height: IneedSpacing.s2),
                    IneedButton(
                      label: l.requestEditDraft,
                      variant: IneedButtonVariant.secondary,
                      onPressed: _busy
                          ? null
                          : () async {
                              final saved = await context.push<ServiceRequest>('/demandes/${r.id}/modifier', extra: RequestFormArgs(mode: r.mode, draft: r));
                              if (saved != null) ref.invalidate(requestProvider(r.id));
                            },
                    ),
                  ],
                  if (!r.isDraft && r.history.isNotEmpty) ...[
                    const SizedBox(height: IneedSpacing.s4),
                    Text(l.requestHistory, style: text.titleMedium),
                    for (final h in r.history)
                      ListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        title: Text(requestStatusLabel(l, h.to)),
                        subtitle: Text([formatAbidjanDateTime(h.at), if (h.reason != null) h.reason!].join(' · ')),
                      ),
                  ],
                  if (r.canCancel) ...[
                    const SizedBox(height: IneedSpacing.s4),
                    TextButton(onPressed: _busy ? null : _cancel, child: Text(l.matchingCancel, style: TextStyle(color: c.danger))),
                  ],
                ],
              );
            },
          ),
    );
  }
}
