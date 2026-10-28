import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

/// P-10 : tableau de bord d'un professionnel validé. Les demandes arrivent en phase 6 (mise en relation).
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  bool _saving = false;

  Future<void> _setOnline(bool on) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).setAvailability(isOnline: on);
      ref.invalidate(proProfileProvider);
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(CommonLocalizations.of(context).appNamePro),
        actions: [IconButton(tooltip: CommonLocalizations.of(context).profileTitle, icon: const Icon(Icons.person_outline), onPressed: () => context.push('/compte'))],
      ),
      body: AsyncBody(
        value: ref.watch(proProfileProvider),
        onRetry: () => ref.invalidate(proProfileProvider),
        builder: (p) {
          final online = p?.isOnline ?? false;
          return ListView(
            padding: const EdgeInsets.all(IneedSpacing.s4),
            children: [
              Text(l.dashboardApprovedTitle, style: text.titleLarge),
              const SizedBox(height: IneedSpacing.s4),
              Card(
                color: online ? c.successSoft : null,
                child: SwitchListTile(
                  value: online,
                  onChanged: _saving || p == null ? null : _setOnline,
                  title: Text(l.dashboardAvailable),
                  subtitle: Text(online ? l.dashboardAvailableOn : l.dashboardAvailableOff),
                ),
              ),
              const SizedBox(height: IneedSpacing.s6),
              Text(l.dashboardIncoming, style: text.titleMedium),
              const SizedBox(height: IneedSpacing.s2),
              Text(l.dashboardIncomingEmpty, style: text.bodyMedium?.copyWith(color: c.textMuted)),
            ],
          );
        },
      ),
    );
  }
}
