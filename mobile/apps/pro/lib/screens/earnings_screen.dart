import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../widgets/async_body.dart';

/// Montant signé (une correction peut rendre un solde négatif).
String _xof(int v) => v < 0 ? '−${formatXof(-v)}' : formatXof(v);

final earningsProvider = FutureProvider.autoDispose<Earnings>((ref) => ref.read(apiProvider).earnings());

/// P-20 : revenus d'après le grand livre (montant dû par mission, après commission et remboursements).
class EarningsScreen extends ConsumerWidget {
  const EarningsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.earningsTitle)),
      body: AsyncBody(
        value: ref.watch(earningsProvider),
        onRetry: () => ref.invalidate(earningsProvider),
        builder: (e) => ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.earningsTotal(_xof(e.totalDueXof)), style: text.titleLarge),
            Text(l.earningsHeld(_xof(e.heldXof))),
            Text(l.earningsAvailable(_xof(e.availableXof))),
            const SizedBox(height: IneedSpacing.s3),
            IneedBanner(message: l.earningsPayoutNote),
            const SizedBox(height: IneedSpacing.s4),
            if (e.missions.isEmpty) Text(l.earningsEmpty, style: text.bodyMedium?.copyWith(color: c.textMuted)),
            for (final m in e.missions)
              ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(CommonLocalizations.of(context).missionReferenceLabel(m.reference)),
                subtitle: Text(l.earningsMissionLine(_xof(m.grossXof), _xof(m.commissionXof), _xof(m.netXof))),
                trailing: Text(m.available ? l.earningsMissionAvailable : l.earningsMissionHeld, style: text.labelMedium),
              ),
          ],
        ),
      ),
    );
  }
}
