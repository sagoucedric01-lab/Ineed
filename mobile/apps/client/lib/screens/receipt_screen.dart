import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

final receiptProvider = FutureProvider.autoDispose.family<Receipt, String>((ref, id) => ref.read(apiProvider).receipt(id));

/// C-25 : reçu d'un paiement confirmé par le serveur.
class ReceiptScreen extends ConsumerWidget {
  const ReceiptScreen({required this.paymentId, super.key});

  final String paymentId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.receiptTitle)),
      body: ref.watch(receiptProvider(paymentId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(receiptProvider(paymentId))),
            ),
            data: (r) => ListView(
              padding: const EdgeInsets.all(IneedSpacing.s4),
              children: [
                if (r.isSandbox) IneedBanner(message: r.notice, tone: IneedBannerTone.warning),
                const SizedBox(height: IneedSpacing.s2),
                Text(l.receiptNumber(r.receiptNumber), style: text.titleMedium),
                Text(l.receiptDate(formatAbidjanDateTime(r.issuedAt))),
                Text(l.receiptMission(r.missionReference)),
                Text(l.receiptPro(r.proName)),
                if (r.payerPhone != null) Text(l.receiptPhone(r.payerPhone!)),
                const SizedBox(height: IneedSpacing.s4),
                Text(r.purpose, style: text.titleSmall),
                for (final line in r.lines)
                  Row(children: [Expanded(child: Text(line.quantity > 1 ? '${line.label} × ${line.quantity}' : line.label)), Text(formatXof(line.amountXof))]),
                const Divider(),
                Row(children: [Expanded(child: Text(l.receiptTotal, style: text.titleMedium)), Text(formatXof(r.amountXof), style: text.titleMedium)]),
                for (final refund in r.refunds) Text(l.receiptRefund(formatXof(refund)), style: text.bodySmall),
                const SizedBox(height: IneedSpacing.s3),
                if (r.method != null) Text(l.receiptMethod(r.method!)),
                if (r.transactionReference != null) Text(l.receiptTransaction(r.transactionReference!)),
                const SizedBox(height: IneedSpacing.s4),
                if (!r.isSandbox) Text(r.notice, style: text.bodySmall?.copyWith(color: c.textMuted)),
              ],
            ),
          ),
    );
  }
}
