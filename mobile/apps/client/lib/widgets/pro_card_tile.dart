import 'package:flutter/material.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

String formatKm(int meters) {
  final km = meters / 1000;
  return km < 10 ? km.toStringAsFixed(1).replaceAll('.', ',') : km.round().toString();
}

/// Carte d'un professionnel dans les résultats de recherche.
class ProCardTile extends StatelessWidget {
  const ProCardTile({required this.pro, required this.onTap, super.key});

  final ProCard pro;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    final initials = pro.businessName.trim().split(RegExp(r'\s+')).take(2).map((w) => w.isEmpty ? '' : w[0].toUpperCase()).join();
    final where = pro.distanceM == null ? l.resultsZoneOnly : l.resultsDistance(formatKm(pro.distanceM!));
    return Card(
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(IneedRadius.md),
        child: Padding(
          padding: const EdgeInsets.all(IneedSpacing.s3),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: c.actionSoft,
                foregroundImage: pro.avatarUrl == null ? null : NetworkImage(pro.avatarUrl!),
                onForegroundImageError: pro.avatarUrl == null ? null : (_, _) {},
                child: Text(initials, style: TextStyle(color: c.onActionSoft)),
              ),
              const SizedBox(width: IneedSpacing.s3),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(pro.businessName, style: text.titleMedium),
                    if (pro.verified)
                      Row(children: [
                        Icon(Icons.verified, size: 16, color: c.success),
                        const SizedBox(width: IneedSpacing.s1),
                        Text(l.resultsVerified, style: text.bodySmall?.copyWith(color: c.success)),
                      ]),
                    const SizedBox(height: IneedSpacing.s1),
                    Text(where, style: text.bodyMedium),
                    if (pro.etaMinutes != null) Text(l.resultsEta(pro.etaMinutes!), style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
                    if (pro.locationPrecision == 'BASE') Text(l.resultsFromBase, style: text.bodySmall?.copyWith(color: c.textMuted)),
                    const SizedBox(height: IneedSpacing.s1),
                    Text(
                      pro.ratingAvg != null ? l.resultsRating(pro.ratingAvg!.toStringAsFixed(1).replaceAll('.', ','), pro.ratingCount) : l.resultsMissions(pro.missionsCompleted),
                      style: text.bodySmall?.copyWith(color: c.textMuted),
                    ),
                    if (pro.indicativePriceXof != null) Text(formatXof(pro.indicativePriceXof!), style: text.bodySmall),
                  ],
                ),
              ),
              if (pro.isOnline)
                Tooltip(message: l.resultsAvailableNow, child: Icon(Icons.circle, size: 12, color: c.success, semanticLabel: l.resultsAvailableNow)),
            ],
          ),
        ),
      ),
    );
  }
}
