import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

/// P-09 : suivi du dossier envoyé (en vérification, refusé ou compte suspendu).
class StatusScreen extends ConsumerStatefulWidget {
  const StatusScreen({super.key});

  @override
  ConsumerState<StatusScreen> createState() => _StatusScreenState();
}

class _StatusScreenState extends ConsumerState<StatusScreen> {
  bool _refreshing = false;

  Future<void> _refresh() async {
    setState(() => _refreshing = true);
    try {
      // Si le statut a changé, la redirection ouvre l'écran correspondant (dossier à compléter, tableau de bord).
      await ref.read(sessionProvider.notifier).reloadMe();
      ref.invalidate(proProfileProvider);
    } finally {
      if (mounted) setState(() => _refreshing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(l.dossierTitle),
        actions: [IconButton(tooltip: CommonLocalizations.of(context).profileTitle, icon: const Icon(Icons.person_outline), onPressed: () => context.push('/compte'))],
      ),
      body: AsyncBody(
        value: ref.watch(proProfileProvider),
        onRetry: () => ref.invalidate(proProfileProvider),
        builder: (p) {
          final note = p?.lastDecisionNote;
          final (icon, color, title, body) = switch (p?.verificationStatus) {
            'REJECTED' => (Icons.cancel_outlined, c.danger, l.verificationRejectedTitle, note == null ? null : l.verificationRejectedBody(note)),
            'SUSPENDED' => (Icons.pause_circle_outline, c.danger, l.verificationSuspendedTitle, note == null ? null : l.verificationSuspendedBody(note)),
            _ => (Icons.hourglass_top, c.action, l.verificationSubmittedTitle, l.verificationSubmittedBody),
          };
          return ListView(
            padding: const EdgeInsets.all(IneedSpacing.s6),
            children: [
              Icon(icon, size: 64, color: color),
              const SizedBox(height: IneedSpacing.s4),
              Text(title, style: text.headlineSmall, textAlign: TextAlign.center),
              if (body != null) ...[
                const SizedBox(height: IneedSpacing.s3),
                Text(body, style: text.bodyLarge, textAlign: TextAlign.center),
              ],
              const SizedBox(height: IneedSpacing.s6),
              Text(l.statusRefreshHelp, style: text.bodySmall?.copyWith(color: c.textMuted), textAlign: TextAlign.center),
              const SizedBox(height: IneedSpacing.s3),
              OutlinedButton.icon(
                onPressed: _refreshing ? null : _refresh,
                icon: const Icon(Icons.refresh),
                label: Text(CommonLocalizations.of(context).actionRefresh),
              ),
            ],
          );
        },
      ),
    );
  }
}
