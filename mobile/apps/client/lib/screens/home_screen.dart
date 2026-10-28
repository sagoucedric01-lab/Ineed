import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';

final _categoriesProvider = FutureProvider.autoDispose<List<Category>>((ref) => ref.read(apiProvider).categories());

/// Accueil provisoire (phase 4) : compte prêt et aperçu des métiers. La recherche et la création
/// de demandes arrivent en phase 5 ; aucune tuile n'est cliquable tant qu'elle ne mène nulle part.
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final session = ref.watch(sessionProvider).value;
    final firstName = session is SignedIn ? session.me.firstName : null;
    final categories = ref.watch(_categoriesProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(firstName == null ? l.homeGreetingAnonymous : l.homeGreeting(firstName)),
        actions: [IconButton(tooltip: common.profileTitle, icon: const Icon(Icons.account_circle_outlined), onPressed: () => context.push('/compte'))],
      ),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(_categoriesProvider.future),
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.homeComingSoonTitle, style: text.titleLarge),
            const SizedBox(height: IneedSpacing.s2),
            Text(l.homeComingSoonBody, style: text.bodyMedium?.copyWith(color: c.textMuted)),
            const SizedBox(height: IneedSpacing.s4),
            categories.when(
              loading: () => const Center(child: Padding(padding: EdgeInsets.all(IneedSpacing.s6), child: CircularProgressIndicator())),
              error: (e, _) => IneedBanner(message: l.homeCategoriesError, tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(_categoriesProvider)),
              data: (list) => list.isEmpty
                  ? Text(l.homeCategoriesEmpty)
                  : Wrap(
                      spacing: IneedSpacing.s3,
                      runSpacing: IneedSpacing.s3,
                      children: [
                        for (final cat in list)
                          SizedBox(
                            width: 96,
                            child: Column(
                              children: [
                                Container(
                                  width: 56,
                                  height: 56,
                                  decoration: BoxDecoration(color: c.surface, border: Border.all(color: c.border), borderRadius: BorderRadius.circular(IneedRadius.lg)),
                                  alignment: Alignment.center,
                                  child: IneedCategoryIcon(iconKey: cat.iconKey, color: c.onActionSoft),
                                ),
                                const SizedBox(height: IneedSpacing.s1),
                                Text(cat.name, style: text.bodySmall, textAlign: TextAlign.center, maxLines: 2),
                              ],
                            ),
                          ),
                      ],
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
