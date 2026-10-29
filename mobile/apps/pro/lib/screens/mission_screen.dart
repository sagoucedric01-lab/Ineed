import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../location.dart';
import '../providers.dart';
import '../trip_tracker.dart';
import '../widgets/open_chat.dart';

/// P-13 à P-16 : mission du professionnel (adresse précise, étapes, partage de position pendant le trajet).
class ProMissionScreen extends ConsumerStatefulWidget {
  const ProMissionScreen({required this.missionId, super.key});

  final String missionId;

  @override
  ConsumerState<ProMissionScreen> createState() => _ProMissionScreenState();
}

/// Statuts où la mission avance par une action du client (devis, paiement) : l'écran se rafraîchit seul.
const _waitingOnClient = {'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING', 'IN_PROGRESS', 'WORK_COMPLETED'};
const missionRefreshInterval = Duration(seconds: 10);

class _ProMissionScreenState extends ConsumerState<ProMissionScreen> {
  TripTracker? _tracker;
  bool _busy = false;
  Timer? _refresh;

  @override
  void initState() {
    super.initState();
    _refresh = Timer.periodic(missionRefreshInterval, (_) {
      final status = ref.read(proMissionProvider(widget.missionId)).value?.status;
      if (_waitingOnClient.contains(status)) ref.invalidate(proMissionProvider(widget.missionId));
    });
  }

  @override
  void dispose() {
    _tracker?.stop();
    _refresh?.cancel();
    super.dispose();
  }

  Future<void> _editQuote({bool supplement = false}) async {
    await context.push('/missions/${widget.missionId}/devis${supplement ? '?supplement=1' : ''}');
    ref.invalidate(proMissionProvider(widget.missionId));
  }

  String _quoteStatus(AppLocalizations l, Quote q) => switch (q.status) {
        'SUBMITTED' => l.quoteStatusSubmitted('${q.version}'),
        'ACCEPTED' => l.quoteStatusAccepted('${q.version}'),
        'REJECTED' => l.quoteStatusRejected('${q.version}'),
        'EXPIRED' => l.quoteStatusExpired('${q.version}'),
        _ => l.quoteStatusWithdrawn('${q.version}'),
      };

  List<Widget> _money(Mission m, AppLocalizations l, TextTheme text, IneedColorScheme c) {
    final money = m.money;
    final latest = money?.quotes.where((q) => q.status != 'SUPERSEDED').lastOrNull;
    final open = money?.openQuote;
    final due = money?.due;
    final sandbox = money?.payments.any((p) => p.isSandbox) ?? false;
    final out = <Widget>[];
    void gap() => out.add(const SizedBox(height: IneedSpacing.s2));
    if (m.status == 'AWAITING_QUOTE') {
      out.add(IneedBanner(message: m.pricingModel == PricingModel.travelPlusDiagnosis ? l.missionAwaitingQuoteOnSite : l.missionAwaitingQuotePro));
      gap();
    }
    if (latest != null && (m.status == 'AWAITING_QUOTE' || m.status == 'QUOTE_PENDING_APPROVAL' || latest.isSupplement)) {
      out.add(Text(_quoteStatus(l, latest), style: text.bodyMedium));
      if (latest.rejectionReason != null) out.add(Text(l.quoteRejectReason(latest.rejectionReason!), style: text.bodySmall?.copyWith(color: c.textMuted)));
      out.add(Text(formatXof(latest.totalXof), style: text.titleMedium));
      gap();
    }
    if (m.status == 'AWAITING_QUOTE' || m.status == 'QUOTE_PENDING_APPROVAL') {
      out.add(IneedButton(label: (money?.quotes.isEmpty ?? true) ? l.quoteWrite : l.quoteNewVersion, onPressed: _busy ? null : _editQuote));
      if (open != null) {
        out.add(TextButton(onPressed: _busy ? null : () => _act(() async {
              await ref.read(apiProvider).withdrawQuote(m.id, open.id);
              return ref.read(apiProvider).proMission(m.id);
            }, l.quoteWithdrawn), child: Text(l.quoteWithdraw)));
      }
      gap();
    }
    if (m.status == 'PAYMENT_PENDING' || m.status == 'CONFIRMED') {
      out.add(IneedBanner(message: due == null ? l.missionStepStartBlockedPayment : l.paymentWaitingClient(formatXof(due.amountXof))));
      gap();
    }
    if (m.status == 'PAYMENT_CONFIRMED') {
      out.add(IneedBanner(message: l.paymentConfirmedPro, tone: IneedBannerTone.success));
      gap();
    }
    if (m.status == 'IN_PROGRESS') {
      if (due != null) {
        out.add(IneedBanner(message: l.supplementWaitingPayment(formatXof(due.amountXof)), tone: IneedBannerTone.warning));
        gap();
      }
      if (open == null) out.add(IneedButton(label: l.quoteSupplement, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : () => _editQuote(supplement: true)));
      gap();
    }
    if (money != null && money.paidXof > 0) {
      out.add(Text(l.moneyPaidPro(formatXof(money.paidXof))));
      if (money.commissionXof != null) out.add(Text(l.moneyCommissionPro(formatXof(money.commissionXof!)), style: text.bodySmall));
      if (money.netXof != null && money.netXof! >= 0) out.add(Text(l.moneyNetPro(formatXof(money.netXof!)), style: text.titleSmall));
      gap();
    }
    if (sandbox) {
      out.add(IneedBanner(message: l.moneySandboxPro, tone: IneedBannerTone.warning));
      gap();
    }
    return out;
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
                  ..._money(m, l, text, c),
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
                  const SizedBox(height: IneedSpacing.s4),
                  OpenChatButton(requestId: m.requestId),
                  if (m.status != 'CANCELLED')
                    TextButton.icon(
                      onPressed: () => context.push('/reclamations/nouvelle', extra: <String, String?>{'missionId': m.id, 'missionReference': m.reference}),
                      icon: const Icon(Icons.report_problem_outlined),
                      label: Text(common.complaintNew),
                    ),
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
