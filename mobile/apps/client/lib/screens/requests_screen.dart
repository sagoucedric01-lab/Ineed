import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/request_status.dart';

final _historyProvider = FutureProvider.autoDispose<List<RequestSummary>>((ref) => ref.read(apiProvider).requests(scope: 'history'));

/// C-30 : mes demandes, en cours et terminées.
class RequestsScreen extends ConsumerWidget {
  const RequestsScreen({super.key});

  Widget _list(BuildContext context, WidgetRef ref, AsyncValue<List<RequestSummary>> value, String empty, VoidCallback retry) {
    final common = CommonLocalizations.of(context);
    return value.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Center(child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: retry)),
      data: (list) => list.isEmpty
          ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(empty, textAlign: TextAlign.center)))
          : ListView(children: [
              for (final r in list)
                ListTile(
                  leading: IneedCategoryIcon(iconKey: r.category.iconKey),
                  title: Text(r.service?.name ?? r.category.name),
                  subtitle: Text('${formatAbidjanDateTime(r.createdAt)}${r.zoneName == null ? '' : ' · ${r.zoneName}'}'),
                  trailing: RequestStatusChip(status: r.status),
                  onTap: () => context.push('/demandes/${r.id}'),
                ),
            ]),
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(title: Text(l.requestsTitle), bottom: TabBar(tabs: [Tab(text: l.requestsTabActive), Tab(text: l.requestsTabHistory)])),
        body: TabBarView(children: [
          _list(context, ref, ref.watch(activeRequestsProvider), l.historyEmptyOngoing, () => ref.invalidate(activeRequestsProvider)),
          _list(context, ref, ref.watch(_historyProvider), l.requestsEmptyHistory, () => ref.invalidate(_historyProvider)),
        ]),
      ),
    );
  }
}
