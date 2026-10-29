import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../location.dart';
import '../providers.dart';
import '../trip_tracker.dart';

/// P-13 à P-16 : mission du professionnel (adresse précise, étapes, partage de position pendant le trajet).
class ProMissionScreen extends ConsumerStatefulWidget {
  const ProMissionScreen({required this.missionId, super.key});

  final String missionId;

  @override
  ConsumerState<ProMissionScreen> createState() => _ProMissionScreenState();
}

class _ProMissionScreenState extends ConsumerState<ProMissionScreen> {
  TripTracker? _tracker;
  bool _busy = false;

  @override
  void dispose() {
    _tracker?.stop();
    super.dispose();
  }

  /// Le partage de position ne fonctionne que pendant le trajet.
  void _syncTracker(Mission m) {
    if (m.status == 'EN_ROUTE' && _tracker == null) {
      _tracker = TripTracker(api: ref.read(apiProvider), missionId: m.id, position: ref.read(positionFinderProvider))..start();
    } else if (m.status != 'EN_ROUTE' && _tracker != null) {
      _tracker!.stop();
      _tracker = null;
    }
  }

  Future<void> _act(Future<Mission> Function() action, [String? done]) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await action();
      if (done != null) messenger.showSnackBar(SnackBar(content: Text(done)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      ref.invalidate(proMissionProvider(widget.missionId));
      ref.invalidate(proMissionsProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _ask(String title, String body, String label, {String? hint, int minLength = 0}) async {
    final common = CommonLocalizations.of(context);
    final controller = TextEditingController();
    final result = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(title),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(body),
          TextField(controller: controller, maxLines: 3, maxLength: 1000, decoration: InputDecoration(hintText: hint)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(common.actionCancel)),
          TextButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: Text(label)),
        ],
      ),
    );
    controller.dispose();
    if (result != null && result.length < minLength) return '';
    return result;
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final api = ref.read(apiProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.missionsTitle)),
      body: ref.watch(proMissionProvider(widget.missionId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(proMissionProvider(widget.missionId)))),
            data: (m) {
              WidgetsBinding.instance.addPostFrameCallback((_) {
                if (!mounted) return;
                final before = _tracker;
                _syncTracker(m);
                if (!identical(before, _tracker)) setState(() {});
              });
              final p = m.place;
              Widget step(String label, String path, {IneedButtonVariant variant = IneedButtonVariant.primary}) =>
                  IneedButton(label: label, variant: variant, loading: _busy, onPressed: () => _act(() => api.missionStep(m.id, path)));
              return ListView(
                padding: const EdgeInsets.all(IneedSpacing.s4),
                children: [
                  Text(common.missionReferenceLabel(m.reference), style: text.labelMedium?.copyWith(color: c.textMuted)),
                  Text(missionStatusLabel(common, m.status), style: text.headlineSmall),
                  Text(m.service?.name ?? m.category.name, style: text.titleMedium),
                  if (m.clientFirstName != null) Text(l.missionClientName(m.clientFirstName!)),
                  if (m.scheduledStartAt != null) Text(formatAbidjanDateTime(m.scheduledStartAt!)),
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.missionClientAddress, style: text.labelMedium),
                  Text([p.label, p.zoneName ?? p.cityName].whereType<String>().join(' · '), style: text.bodyLarge),
                  if (p.landmark != null) Text(p.landmark!),
                  if (p.street != null) Text(p.street!),
                  if (p.instructions != null) Text(p.instructions!, style: text.bodySmall),
                  const SizedBox(height: IneedSpacing.s3),
                  Text(m.description, style: text.bodyMedium?.copyWith(color: c.textMuted)),
                  const SizedBox(height: IneedSpacing.s6),
                  if (m.waitsForQuoteOrPayment) ...[
                    IneedBanner(message: m.status == 'AWAITING_QUOTE' || m.status == 'QUOTE_PENDING_APPROVAL' ? l.missionStepStartBlockedQuote : l.missionStepStartBlockedPayment),
                    const SizedBox(height: IneedSpacing.s2),
                    Text(l.missionNextStepPending, style: text.bodySmall?.copyWith(color: c.textMuted)),
                  ],
                  if (m.status == 'PAYMENT_CONFIRMED') ...[
                    step(l.missionStepDepart, 'depart'),
                    Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(l.missionStepDepartHelp, style: text.bodySmall)),
                  ],
                  if (m.status == 'EN_ROUTE') ...[
                    IneedBanner(message: _tracker?.locationAvailable == false ? l.missionLocationOff : l.missionSharingLocation, tone: _tracker?.locationAvailable == false ? IneedBannerTone.warning : IneedBannerTone.info),
                    const SizedBox(height: IneedSpacing.s3),
                    step(l.missionStepArrived, 'arrive'),
                  ],
                  if (m.status == 'ARRIVED' && m.pricingModel != PricingModel.travelPlusDiagnosis) step(l.missionStepStart, 'start'),
                  if (m.status == 'IN_PROGRESS')
                    IneedButton(
                      label: l.missionStepFinish,
                      loading: _busy,
                      onPressed: () async {
                        final report = await _ask(l.missionStepFinish, l.missionFinishConfirm, l.missionStepFinish, hint: l.missionReportHint);
                        if (report != null) await _act(() => api.completeMission(m.id, report: report));
                      },
                    ),
                  if (m.status == 'WORK_COMPLETED') IneedBanner(message: l.missionWaitingClientConfirmation),
                  if (const {'AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'PAYMENT_CONFIRMED', 'EN_ROUTE', 'ARRIVED'}.contains(m.status)) ...[
                    const SizedBox(height: IneedSpacing.s6),
                    TextButton(
                      onPressed: _busy
                          ? null
                          : () async {
                              final reason = await _ask(l.missionCancel, l.missionCancelWarning, l.missionCancel, hint: l.missionCancelReason, minLength: 5);
                              if (reason == null) return;
                              if (reason.isEmpty) {
                                if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.missionCancelReasonRequired)));
                                return;
                              }
                              await _act(() => api.withdrawFromMission(m.id, reason), l.missionCancelled);
                            },
                      child: Text(l.missionCancel, style: TextStyle(color: c.danger)),
                    ),
                  ],
                ],
              );
            },
          ),
    );
  }
}
