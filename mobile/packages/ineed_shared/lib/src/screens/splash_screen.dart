import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';

/// Démarrage : restauration de la session ; en cas d'échec réseau, propose de réessayer.
class SplashScreen extends ConsumerWidget {
  const SplashScreen({this.pro = false, super.key});

  /// Logo de l'application Ineed Pro.
  final bool pro;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider);
    final l = CommonLocalizations.of(context);
    return Scaffold(
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(IneedSpacing.s6),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              IneedLogo(size: 96, pro: pro),
              const SizedBox(height: IneedSpacing.s6),
              if (session.hasError && !session.hasValue) ...[
                IneedBanner(message: failureMessage(l, session.error!), tone: IneedBannerTone.danger),
                const SizedBox(height: IneedSpacing.s4),
                IneedButton(label: l.actionRetry, variant: IneedButtonVariant.secondary, onPressed: () => ref.invalidate(sessionProvider)),
              ] else
                const CircularProgressIndicator(),
            ],
          ),
        ),
      ),
    );
  }
}
