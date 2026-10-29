import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../providers.dart';

/// C-31 : notifications reçues (aussi envoyées en push quand l'appareil est enregistré) ; un appui ouvre l'écran concerné.
class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final common = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final page = ref.watch(notificationsProvider);
    return Scaffold(
      appBar: AppBar(
        title: Text(common.notificationsTitle),
        actions: [
          if ((page.value?.unread ?? 0) > 0)
            TextButton(
              onPressed: () async {
                await ref.read(apiProvider).markNotificationsRead();
                ref.invalidate(notificationsProvider);
              },
              child: Text(common.notificationsMarkAllRead),
            ),
        ],
      ),
      body: page.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Center(child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(notificationsProvider))),
        data: (p) => p.items.isEmpty
            ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(common.notificationsEmpty, textAlign: TextAlign.center)))
            : ListView(children: [
                for (final n in p.items)
                  ListTile(
                    leading: Icon(n.read ? Icons.notifications_none : Icons.notifications_active, color: n.read ? c.textMuted : c.action),
                    title: Text(n.title, style: TextStyle(fontWeight: n.read ? FontWeight.normal : FontWeight.w600)),
                    subtitle: Text('${n.body}\n${formatAbidjanDateTime(n.createdAt)}'),
                    isThreeLine: true,
                    onTap: notificationRoute(n.data) == null ? null : () => context.push(notificationRoute(n.data)!),
                  ),
              ]),
      ),
    );
  }
}
