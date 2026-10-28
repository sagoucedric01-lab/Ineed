import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';

final _sessionsProvider = FutureProvider.autoDispose<List<DeviceSession>>((ref) => ref.read(apiProvider).sessions());

/// Appareils connectés : déconnexion à distance d'un appareil perdu ou inconnu.
class DevicesScreen extends ConsumerWidget {
  const DevicesScreen({super.key});

  String _appLabel(CommonLocalizations l, String app) => switch (app) {
        'PRO' => l.sessionAppPro,
        'ADMIN' => l.sessionAppAdmin,
        _ => l.sessionAppClient,
      };

  Future<void> _revoke(BuildContext context, WidgetRef ref, DeviceSession s) async {
    final l = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiProvider).revokeSession(s.id);
      ref.invalidate(_sessionsProvider);
      messenger.showSnackBar(SnackBar(content: Text(l.profileDevicesRevoked)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(l, e))));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = CommonLocalizations.of(context);
    final sessions = ref.watch(_sessionsProvider);
    return Scaffold(
      appBar: AppBar(title: Text(l.profileDevicesTitle)),
      body: sessions.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => Padding(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          child: IneedBanner(message: failureMessage(l, e), tone: IneedBannerTone.danger, actionLabel: l.actionRetry, onAction: () => ref.invalidate(_sessionsProvider)),
        ),
        data: (list) => ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.profileDevicesHelp, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: context.ineedColors.textMuted)),
            const SizedBox(height: IneedSpacing.s3),
            for (final s in list)
              ListTile(
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.smartphone_outlined),
                title: Text('${s.deviceLabel ?? l.profileDevicesUnknown} · ${_appLabel(l, s.app)}'),
                subtitle: Text(s.current ? l.profileDevicesCurrent : l.profileDevicesLastUsed(formatAbidjanDateTime(s.lastUsedAt))),
                trailing: s.current ? null : TextButton(onPressed: () => _revoke(context, ref, s), child: Text(l.profileDevicesRevoke)),
              ),
          ],
        ),
      ),
    );
  }
}
