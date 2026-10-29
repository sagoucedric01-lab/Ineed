import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/pro_card_tile.dart';
import '../widgets/request_status.dart';
import 'mission_money_section.dart';

/// C-21 à C-24 : suivi de la mission (étapes, trajet du professionnel, fin d'intervention, annulation).
class MissionScreen extends ConsumerStatefulWidget {
  const MissionScreen({required this.missionId, super.key});

  final String missionId;

  @override
  ConsumerState<MissionScreen> createState() => _MissionScreenState();
}

class _MissionScreenState extends ConsumerState<MissionScreen> {
  Timer? _refresh;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    // Mise à jour régulière (position du professionnel, étapes) en attendant les notifications push.
    _refresh = Timer.periodic(liveRefreshInterval, (_) {
      final status = ref.read(missionProvider(widget.missionId)).value?.status;
      if (status != 'CLOSED' && status != 'CANCELLED') ref.invalidate(missionProvider(widget.missionId));
    });
  }

  @override
  void dispose() {
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _act(Future<Mission> Function() action, [String? done]) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(missionProvider(widget.missionId));
      ref.invalidate(activeMissionsProvider);
      if (done != null) messenger.showSnackBar(SnackBar(content: Text(done)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _cancel(Mission m) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.trackingCancelConfirm),
        content: Text(m.cancelTerms == 'TRAVEL_FEE_DUE' ? l.trackingCancelFeeDue : l.trackingCancelFree),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(common.actionBack)),
          TextButton(onPressed: () => Navigator.pop(context, true), child: Text(l.trackingCancel)),
        ],
      ),
    );
    if (ok == true) await _act(() => ref.read(apiProvider).cancelMission(m.id));
  }

  Future<void> _problem(Mission m) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.completionProblemTitle),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(l.completionProblemBody),
          TextField(controller: controller, maxLines: 3, maxLength: 1000, decoration: InputDecoration(hintText: l.completionProblemHint)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(common.actionCancel)),
          TextButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: Text(common.actionSend)),
        ],
      ),
    );
    controller.dispose();
    if (reason == null) return;
    if (reason.length < 5) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.completionProblemHint)));
      return;
    }
    await _act(() => ref.read(apiProvider).reportProblem(m.id, reason), l.completionProblemSent);
  }

  String _eventLabel(AppLocalizations l, CommonLocalizations common, TimelineEvent e) =>
      e.kind == 'MISSION' ? missionStatusLabel(common, e.status) : requestStatusLabel(l, e.status);

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.trackingTitle)),
      body: ref.watch(missionProvider(widget.missionId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(missionProvider(widget.missionId))),
            ),
            data: (m) {
              final t = m.tracking;
              return ListView(
                padding: const EdgeInsets.all(IneedSpacing.s4),
                children: [
                  Text(l.trackingReference(m.reference), style: text.labelMedium?.copyWith(color: c.textMuted)),
                  Text(missionStatusLabel(common, m.status), style: text.headlineSmall),
                  const SizedBox(height: IneedSpacing.s2),
                  Text('${m.service?.name ?? m.category.name} · ${m.proName}', style: text.titleMedium),
                  if (m.scheduledStartAt != null) Text(formatAbidjanDateTime(m.scheduledStartAt!)),
                  const SizedBox(height: IneedSpacing.s4),
                  MissionMoneySection(mission: m),
                  const SizedBox(height: IneedSpacing.s2),
                  if (m.status == 'EN_ROUTE')
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(IneedSpacing.s4),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Text(l.trackingEnRoute(m.proName), style: text.titleMedium),
                          if (t?.distanceM != null) Text(l.trackingDistance(formatKm(t!.distanceM!))),
                          if (t?.etaMinutes != null) Text(l.trackingEta(t!.etaMinutes!), style: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600)),
                          if (t?.recordedAt != null && t!.stale == false)
                            Text(l.trackingLastUpdate(DateTime.now().difference(t.recordedAt!).inMinutes), style: text.bodySmall?.copyWith(color: c.textMuted)),
                          if (t == null || t.stale) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: IneedBanner(message: l.trackingLocationStale, tone: IneedBannerTone.warning)),
                        ]),
                      ),
                    ),
                  if (m.status == 'ARRIVED') IneedBanner(message: l.trackingArrived(m.proName), tone: IneedBannerTone.success),
                  if (m.status == 'IN_PROGRESS') IneedBanner(message: l.trackingCancelNotAllowed),
                  if (m.status == 'WORK_COMPLETED')
                    Card(
                      child: Padding(
                        padding: const EdgeInsets.all(IneedSpacing.s4),
                        child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                          Text(l.completionTitle, style: text.titleMedium),
                          const SizedBox(height: IneedSpacing.s2),
                          Text(l.completionBody(m.proName)),
                          if (m.report != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text('« ${m.report!} »', style: text.bodySmall)),
                          if (m.autoCloseAt != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(l.completionAutoClose(formatAbidjanDateTime(m.autoCloseAt!)), style: text.bodySmall)),
                          const SizedBox(height: IneedSpacing.s3),
                          IneedButton(label: l.completionConfirm, loading: _busy, onPressed: () => _act(() => ref.read(apiProvider).confirmCompletion(m.id), l.completionClosed)),
                          const SizedBox(height: IneedSpacing.s2),
                          IneedButton(label: l.completionProblem, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : () => _problem(m)),
                        ]),
                      ),
                    ),
                  if (m.status == 'CLOSED') IneedBanner(message: l.completionClosed, tone: IneedBannerTone.success),
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.trackingTimeline, style: text.titleMedium),
                  for (final e in m.timeline)
                    ListTile(
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      leading: Icon(Icons.check_circle_outline, size: 18, color: c.textMuted),
                      title: Text(_eventLabel(l, common, e)),
                      subtitle: Text([formatAbidjanDateTime(e.at), if (e.reason != null) e.reason!].join(' · ')),
                    ),
                  if (m.cancelTerms != null) ...[
                    const SizedBox(height: IneedSpacing.s4),
                    Text(m.cancelTerms == 'TRAVEL_FEE_DUE' ? l.trackingCancelFeeDue : l.trackingCancelFree, style: text.bodySmall?.copyWith(color: c.textMuted)),
                    TextButton(onPressed: _busy ? null : () => _cancel(m), child: Text(l.trackingCancel, style: TextStyle(color: c.danger))),
                  ],
                ],
              );
            },
          ),
    );
  }
}
