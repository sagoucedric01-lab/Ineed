import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';

/// Vérification du paiement pendant que le client paie chez le prestataire.
const paymentPollInterval = Duration(seconds: 3);

String purposeLabel(AppLocalizations l, String purpose) => switch (purpose) {
      'TRAVEL_FEE' => l.moneyPurposeTravel,
      'WORK' => l.moneyPurposeWork,
      'SUPPLEMENT' => l.moneyPurposeSupplement,
      _ => l.moneyPurposeFull,
    };

/// C-20 / C-20b : devis (ou frais supplémentaires) à accepter ou refuser, paiement de ce qui est dû, reçus.
/// L'application n'affiche « paiement confirmé » que lorsque le serveur l'a vérifié auprès du prestataire.
class MissionMoneySection extends ConsumerStatefulWidget {
  const MissionMoneySection({required this.mission, super.key});

  final Mission mission;

  @override
  ConsumerState<MissionMoneySection> createState() => _MissionMoneySectionState();
}

class _MissionMoneySectionState extends ConsumerState<MissionMoneySection> {
  bool _busy = false;

  /// Une clé par action : renvoyée telle quelle si l'action est retentée après une erreur réseau.
  final Map<String, String> _keys = {};
  String _key(String action) => _keys.putIfAbsent(action, newIdempotencyKey);

  Timer? _poll;
  String? _watching;

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  void _refreshMission() {
    ref.invalidate(missionProvider(widget.mission.id));
    ref.invalidate(activeMissionsProvider);
  }

  Future<void> _run(String action, Future<void> Function(String key) call, {String? done}) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await call(_key(action));
      _keys.remove(action);
      if (done != null) messenger.showSnackBar(SnackBar(content: Text(done)));
      _refreshMission();
    } on ServerFailure catch (e) {
      // Refus définitif (devis remplacé ou expiré…) : la prochaine tentative est une nouvelle action.
      _keys.remove(action);
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
      _refreshMission();
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reject(Quote q) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final controller = TextEditingController();
    final reason = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l.moneyQuoteRejectTitle),
        content: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(l.moneyQuoteRejectBody),
          TextField(controller: controller, maxLength: 500, decoration: InputDecoration(hintText: l.moneyQuoteRejectHint)),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: Text(common.actionBack)),
          TextButton(onPressed: () => Navigator.pop(context, controller.text.trim()), child: Text(l.moneyQuoteReject)),
        ],
      ),
    );
    controller.dispose();
    if (reason == null) return;
    await _run('reject:${q.id}', (k) => ref.read(apiProvider).rejectQuote(widget.mission.id, q.id, idempotencyKey: k, reason: reason.isEmpty ? null : reason), done: l.moneyQuoteRejected);
  }

  Future<void> _openCheckout(Payment p) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final url = p.checkoutUrl;
    final opened = url != null && await ref.read(checkoutLauncherProvider)(ref.read(apiProvider).resolve(url));
    if (!opened) {
      messenger.showSnackBar(SnackBar(content: Text(l.moneyCheckoutOpenFailed)));
      return;
    }
    _watch(p.id);
  }

  Future<void> _pay() async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      final p = await ref.read(apiProvider).payMission(widget.mission.id, idempotencyKey: _key('pay'));
      _keys.remove('pay');
      _refreshMission();
      if (!mounted) return;
      await _openCheckout(p);
    } on Object catch (e) {
      if (e is ServerFailure) _keys.remove('pay');
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
      if (e is ServerFailure && e.code == 'NOTHING_DUE') _refreshMission();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
    if (!mounted) return;
    messenger.hideCurrentSnackBar();
    if (_watching != null) messenger.showSnackBar(SnackBar(content: Text(l.moneyPaymentChecking)));
  }

  /// Interroge le serveur, qui vérifie le paiement auprès du prestataire, jusqu'à une issue définitive.
  void _watch(String paymentId) {
    _poll?.cancel();
    _watching = paymentId;
    _poll = Timer.periodic(paymentPollInterval, (_) => _check(paymentId, quiet: true));
  }

  Future<void> _check(String paymentId, {bool quiet = false}) async {
    final l = AppLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    try {
      final p = await ref.read(apiProvider).payment(paymentId);
      if (!mounted) return;
      if (p.isPending) {
        if (!quiet) messenger.showSnackBar(SnackBar(content: Text(l.moneyPaymentChecking)));
        return;
      }
      _poll?.cancel();
      _watching = null;
      messenger.showSnackBar(SnackBar(
        content: Text(p.isSucceeded ? l.moneyPaymentConfirmed(formatXof(p.amountXof)) : (p.failureMessage == null ? l.moneyPaymentFailedGeneric : l.moneyPaymentFailed(p.failureMessage!))),
      ));
      _refreshMission();
    } on Object catch (e) {
      if (!quiet && mounted) messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final m = widget.mission;
    final money = m.money;
    if (money == null) return m.status == 'AWAITING_QUOTE' ? IneedBanner(message: l.moneyQuoteWaiting) : const SizedBox.shrink();
    final quote = money.openQuote;
    final due = money.due;
    final pending = money.pendingPayment;
    final succeeded = money.payments.where((p) => p.isSucceeded).toList();
    final sandbox = money.payments.any((p) => p.isSandbox);
    final failed = money.payments.lastOrNull;
    return Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
      if (m.status == 'AWAITING_QUOTE' && quote == null) IneedBanner(message: l.moneyQuoteWaiting),
      if (quote != null)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(IneedSpacing.s4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(quote.isSupplement ? l.moneySupplementTitle : l.moneyQuoteTitle('${quote.version}'), style: text.titleMedium),
              Text(l.moneyQuoteValidUntil(formatAbidjanDateTime(quote.validUntil)), style: text.bodySmall?.copyWith(color: c.textMuted)),
              const SizedBox(height: IneedSpacing.s2),
              for (final line in quote.lines)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Expanded(
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(line.quantity > 1 ? '${line.label} × ${line.quantity}' : line.label),
                        if (line.justification != null) Text(line.justification!, style: text.bodySmall?.copyWith(color: c.textMuted)),
                      ]),
                    ),
                    Text(formatXof(line.amountXof)),
                  ]),
                ),
              const Divider(),
              Text(l.moneyQuoteTotal(formatXof(quote.totalXof)), style: text.titleMedium, textAlign: TextAlign.end),
              if (quote.estimatedDurationMin != null) Text(l.moneyQuoteDuration('${quote.estimatedDurationMin}'), style: text.bodySmall),
              if (quote.conditions != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(quote.conditions!, style: text.bodySmall)),
              const SizedBox(height: IneedSpacing.s3),
              IneedButton(
                label: quote.isSupplement ? l.moneySupplementAccept : l.moneyQuoteAccept,
                loading: _busy,
                onPressed: () => _run('accept:${quote.id}', (k) => ref.read(apiProvider).acceptQuote(m.id, quote.id, idempotencyKey: k),
                    done: quote.isSupplement ? l.moneySupplementAccepted : l.moneyQuoteAccepted),
              ),
              const SizedBox(height: IneedSpacing.s2),
              IneedButton(label: l.moneyQuoteReject, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : () => _reject(quote)),
            ]),
          ),
        ),
      if (due != null && quote == null)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(IneedSpacing.s4),
            child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
              Text(l.moneyDueTitle(formatXof(due.amountXof)), style: text.titleMedium),
              Text(due.label, style: text.bodySmall?.copyWith(color: c.textMuted)),
              const SizedBox(height: IneedSpacing.s2),
              Text(l.moneyEscrowNote, style: text.bodySmall),
              if (failed != null && (failed.status == 'FAILED' || failed.status == 'CANCELLED') && pending == null)
                Padding(
                  padding: const EdgeInsets.only(top: IneedSpacing.s2),
                  child: IneedBanner(message: failed.failureMessage == null ? l.moneyPaymentFailedGeneric : l.moneyPaymentFailed(failed.failureMessage!), tone: IneedBannerTone.warning),
                ),
              if (pending != null) ...[
                Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: IneedBanner(message: l.moneyPaymentChecking)),
                const SizedBox(height: IneedSpacing.s3),
                IneedButton(label: l.moneyOpenCheckout, loading: _busy, onPressed: () => _openCheckout(pending)),
                const SizedBox(height: IneedSpacing.s2),
                IneedButton(label: l.moneyCheckPayment, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : () => _check(pending.id)),
              ] else ...[
                const SizedBox(height: IneedSpacing.s3),
                IneedButton(label: l.moneyPay(formatXof(due.amountXof)), loading: _busy, onPressed: _pay),
              ],
            ]),
          ),
        ),
      if (sandbox) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: IneedBanner(message: l.moneySandbox, tone: IneedBannerTone.warning)),
      if (succeeded.isNotEmpty) ...[
        const SizedBox(height: IneedSpacing.s4),
        Text(l.moneyPaymentsTitle, style: text.titleMedium),
        for (final p in succeeded)
          ListTile(
            contentPadding: EdgeInsets.zero,
            title: Text(l.moneyPaidLine(purposeLabel(l, p.purpose), formatXof(p.amountXof), formatAbidjanDateTime(p.confirmedAt!))),
            subtitle: p.refunds.isEmpty
                ? null
                : Text([
                    for (final r in p.refunds) r.status == 'SUCCEEDED' ? l.moneyRefunded(formatXof(r.amountXof)) : l.moneyRefundPending(formatXof(r.amountXof)),
                  ].join('\n')),
            trailing: TextButton(onPressed: () => context.push('/paiements/${p.id}/recu'), child: Text(l.moneyReceipt)),
          ),
      ],
    ]);
  }
}
