import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/request_status.dart';
import 'request_form_screen.dart';

/// C-05 : accueil (adresse, recherche, intervention immédiate ou programmée, métiers, recherches récentes, demandes en cours).
class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});

  Future<void> _refresh(WidgetRef ref) async {
    ref.invalidate(addressesProvider);
    ref.invalidate(recentSearchesProvider);
    ref.invalidate(activeRequestsProvider);
    ref.invalidate(activeMissionsProvider);
    ref.invalidate(notificationsProvider);
    ref.invalidate(categoriesProvider);
    await ref.read(categoriesProvider.future);
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final session = ref.watch(sessionProvider).value;
    final firstName = session is SignedIn ? session.me.firstName : null;
    final unread = ref.watch(notificationsProvider).value?.unread ?? 0;
    final address = ref.watch(selectedAddressProvider).value;

    return Scaffold(
      appBar: AppBar(
        title: Text(firstName == null ? l.homeGreetingAnonymous : l.homeGreeting(firstName)),
        actions: [
          IconButton(
            tooltip: common.notificationsTitle,
            icon: Badge(isLabelVisible: unread > 0, label: Text('$unread'), child: const Icon(Icons.notifications_outlined)),
            onPressed: () => context.push('/notifications'),
          ),
          IconButton(tooltip: common.profileTitle, icon: const Icon(Icons.account_circle_outlined), onPressed: () => context.push('/compte')),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () => _refresh(ref),
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.homeQuestion, style: text.headlineSmall),
            const SizedBox(height: IneedSpacing.s3),
            ActionChip(
              avatar: Icon(Icons.place_outlined, color: c.action),
              label: Text(address == null ? l.homeNoAddress : [address.title, if (address.zoneName != null && address.title != address.zoneName) address.zoneName].join(' · ')),
              onPressed: () => context.push('/adresses', extra: true),
            ),
            const SizedBox(height: IneedSpacing.s3),
            TextField(
              readOnly: true,
              onTap: () => context.push('/recherche'),
              decoration: InputDecoration(prefixIcon: const Icon(Icons.search), hintText: l.homeSearchHint),
            ),
            const SizedBox(height: IneedSpacing.s4),
            IneedButton(
              label: l.homeUrgentCta,
              icon: Icons.bolt,
              variant: IneedButtonVariant.urgent,
              onPressed: () => context.push('/demandes/nouvelle', extra: const RequestFormArgs(mode: RequestMode.urgent)),
            ),
            const SizedBox(height: IneedSpacing.s2),
            IneedButton(
              label: l.homeScheduleCta,
              icon: Icons.event_outlined,
              variant: IneedButtonVariant.secondary,
              onPressed: () => context.push('/demandes/nouvelle', extra: const RequestFormArgs(mode: RequestMode.scheduled)),
            ),
            const SizedBox(height: IneedSpacing.s6),
            const _OngoingRequests(),
            Text(l.homeCategories, style: text.titleMedium),
            const SizedBox(height: IneedSpacing.s3),
            const _CategoriesGrid(),
            const _RecentSearches(),
          ],
        ),
      ),
    );
  }
}

class _CategoriesGrid extends ConsumerWidget {
  const _CategoriesGrid();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    return ref.watch(categoriesProvider).when(
          loading: () => const Center(child: Padding(padding: EdgeInsets.all(IneedSpacing.s6), child: CircularProgressIndicator())),
          error: (e, _) => IneedBanner(message: l.homeCategoriesError, tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(categoriesProvider)),
          data: (list) => list.isEmpty
              ? Text(l.homeCategoriesEmpty)
              : Wrap(
                  spacing: IneedSpacing.s3,
                  runSpacing: IneedSpacing.s3,
                  children: [
                    for (final cat in list)
                      SizedBox(
                        width: 96,
                        child: InkWell(
                          borderRadius: BorderRadius.circular(IneedRadius.lg),
                          onTap: () => context.push('/metiers/${cat.id}'),
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
                      ),
                  ],
                ),
        );
  }
}

class _RecentSearches extends ConsumerWidget {
  const _RecentSearches();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final recent = ref.watch(recentSearchesProvider).value ?? const [];
    if (recent.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(top: IneedSpacing.s6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(AppLocalizations.of(context).homeRecentSearches, style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: IneedSpacing.s2),
          Wrap(
            spacing: IneedSpacing.s2,
            runSpacing: IneedSpacing.s2,
            children: [
              for (final r in recent)
                ActionChip(avatar: const Icon(Icons.history, size: 18), label: Text(r.query), onPressed: () => context.push('/recherche', extra: r.query)),
            ],
          ),
        ],
      ),
    );
  }
}

class _OngoingRequests extends ConsumerWidget {
  const _OngoingRequests();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final requests = (ref.watch(activeRequestsProvider).value ?? const <RequestSummary>[]).where((r) => r.status != 'ASSIGNED').toList();
    final missions = ref.watch(activeMissionsProvider).value ?? const <MissionSummary>[];
    if (requests.isEmpty && missions.isEmpty) return const SizedBox.shrink();
    return Padding(
      padding: const EdgeInsets.only(bottom: IneedSpacing.s6),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(child: Text(l.homeOngoingMissions, style: Theme.of(context).textTheme.titleMedium)),
              TextButton(onPressed: () => context.push('/demandes'), child: Text(common.actionSeeAll)),
            ],
          ),
          for (final m in missions.take(3))
            Card(
              child: ListTile(
                leading: IneedCategoryIcon(iconKey: m.category.iconKey),
                title: Text(m.service?.name ?? m.category.name),
                subtitle: Text('${m.proName} · ${missionStatusLabel(common, m.status)}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => context.push('/missions/${m.id}'),
              ),
            ),
          for (final r in requests.take(3))
            Card(
              child: ListTile(
                leading: IneedCategoryIcon(iconKey: r.category.iconKey),
                title: Text(r.service?.name ?? r.category.name),
                subtitle: Text(r.description, maxLines: 1, overflow: TextOverflow.ellipsis),
                trailing: RequestStatusChip(status: r.status),
                onTap: () => context.push('/demandes/${r.id}'),
              ),
            ),
        ],
      ),
    );
  }
}
