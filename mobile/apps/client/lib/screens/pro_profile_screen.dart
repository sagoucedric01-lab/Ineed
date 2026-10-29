import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

final _profileProvider = FutureProvider.autoDispose.family<PublicProProfile, String>((ref, id) => ref.read(apiProvider).publicProProfile(id));

/// C-11 : profil public d'un professionnel validé.
class ProProfileScreen extends ConsumerWidget {
  const ProProfileScreen({required this.proId, super.key});

  final String proId;

  String _weekday(BuildContext context, int d) {
    final names = MaterialLocalizations.of(context).narrowWeekdays; // dimanche en premier
    return names[d % 7];
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(),
      body: ref.watch(_profileProvider(proId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(
              child: Padding(
                padding: const EdgeInsets.all(IneedSpacing.s6),
                child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(_profileProvider(proId))),
              ),
            ),
            data: (p) => ListView(
              padding: const EdgeInsets.all(IneedSpacing.s4),
              children: [
                Center(
                  child: CircleAvatar(
                    radius: 44,
                    backgroundColor: c.actionSoft,
                    foregroundImage: p.avatarUrl == null ? null : NetworkImage(p.avatarUrl!),
                    onForegroundImageError: p.avatarUrl == null ? null : (_, _) {},
                    child: Icon(Icons.person, size: 40, color: c.onActionSoft),
                  ),
                ),
                const SizedBox(height: IneedSpacing.s3),
                Center(child: Text(p.businessName, style: text.headlineSmall, textAlign: TextAlign.center)),
                if (p.verified)
                  Center(
                    child: Row(mainAxisSize: MainAxisSize.min, children: [
                      Icon(Icons.verified, size: 18, color: c.success),
                      const SizedBox(width: IneedSpacing.s1),
                      Text(l.resultsVerified, style: TextStyle(color: c.success)),
                    ]),
                  ),
                const SizedBox(height: IneedSpacing.s2),
                Center(child: Text(p.categories.map((x) => x.name).join(' · '))),
                Center(
                  child: Text(
                    p.ratingAvg != null ? l.resultsRating(p.ratingAvg!.toStringAsFixed(1).replaceAll('.', ','), p.ratingCount) : l.resultsMissions(p.missionsCompleted),
                    style: text.bodySmall?.copyWith(color: c.textMuted),
                  ),
                ),
                if (p.indicativePriceXof != null) Center(child: Text(l.proProfileIndicativePrice(formatXof(p.indicativePriceXof!)))),
                if (p.bio != null || p.yearsExperience != null) ...[
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.proProfileAbout, style: text.titleMedium),
                  if (p.yearsExperience != null) Text(l.proProfileExperience(p.yearsExperience!)),
                  if (p.bio != null) Text(p.bio!),
                ],
                if (p.skills.isNotEmpty) ...[
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.proProfileSkills, style: text.titleMedium),
                  Wrap(spacing: IneedSpacing.s2, children: [for (final s in p.skills) Chip(label: Text(s))]),
                ],
                if (p.zones.isNotEmpty) ...[
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.proProfileZones, style: text.titleMedium),
                  Text(p.zones.join(', ')),
                ],
                if (p.weeklyHours.isNotEmpty) ...[
                  const SizedBox(height: IneedSpacing.s4),
                  Text(l.proProfileHours, style: text.titleMedium),
                  for (final h in p.weeklyHours) Text('${_weekday(context, h.weekday)}  ${h.start} – ${h.end}'),
                ],
                const SizedBox(height: IneedSpacing.s4),
                Text(l.proProfileReviews, style: text.titleMedium),
                Text(l.proProfileReviewsHelp, style: text.bodySmall?.copyWith(color: c.textMuted)),
                if (p.reviews.isEmpty) Text(l.reviewsNone),
                for (final r in p.reviews)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    title: Text('${'★' * r.rating}${'☆' * (5 - r.rating)}  ${r.author}', style: TextStyle(color: c.text)),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (r.comment != null) Text(r.comment!),
                      if (r.proReply != null) Text(l.reviewProReply(r.proReply!), style: text.bodySmall?.copyWith(color: c.textMuted)),
                      Text(formatAbidjanDateTime(r.createdAt), style: text.bodySmall),
                    ]),
                  ),
              ],
            ),
          ),
    );
  }
}
