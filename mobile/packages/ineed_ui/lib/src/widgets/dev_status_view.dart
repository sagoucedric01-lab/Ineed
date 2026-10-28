import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens/ineed_tokens.dart';
import 'ineed_banner.dart';
import 'ineed_button.dart';
import 'ineed_logo.dart';

enum DevStatusState { checking, ok, degraded, unreachable }

/// Écran technique de la phase 3 : marque, environnement et état de la connexion à l'API.
/// Purement visuel : l'application fournit les textes traduits et l'action « Réessayer ».
class DevStatusView extends StatelessWidget {
  const DevStatusView({
    required this.appName,
    required this.title,
    required this.body,
    required this.state,
    required this.message,
    required this.retryLabel,
    required this.onRetry,
    this.environmentLabel,
    this.pro = false,
    super.key,
  });

  final String appName;
  final String title;
  final String body;
  final DevStatusState state;
  final String message;
  final String retryLabel;
  final VoidCallback onRetry;
  final String? environmentLabel;
  final bool pro;

  @override
  Widget build(BuildContext context) {
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s6),
          children: [
            const SizedBox(height: IneedSpacing.s8),
            Center(child: IneedLogo(size: 88, pro: pro)),
            const SizedBox(height: IneedSpacing.s4),
            Text(appName, textAlign: TextAlign.center, style: text.headlineMedium),
            if (environmentLabel != null) ...[
              const SizedBox(height: IneedSpacing.s2),
              Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: IneedSpacing.s3, vertical: IneedSpacing.s1),
                  decoration: BoxDecoration(color: c.warningSoft, borderRadius: BorderRadius.circular(IneedRadius.pill)),
                  child: Text(environmentLabel!, style: text.bodySmall?.copyWith(color: c.onWarningSoft, fontWeight: FontWeight.w600)),
                ),
              ),
            ],
            const SizedBox(height: IneedSpacing.s8),
            Text(title, style: text.titleMedium),
            const SizedBox(height: IneedSpacing.s2),
            Text(body, style: text.bodyMedium?.copyWith(color: c.textMuted)),
            const SizedBox(height: IneedSpacing.s6),
            if (state == DevStatusState.checking)
              Row(
                children: [
                  const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5)),
                  const SizedBox(width: IneedSpacing.s3),
                  Expanded(child: Text(message, style: text.bodyMedium)),
                ],
              )
            else
              IneedBanner(
                message: message,
                tone: switch (state) {
                  DevStatusState.ok => IneedBannerTone.success,
                  DevStatusState.degraded => IneedBannerTone.warning,
                  _ => IneedBannerTone.danger,
                },
              ),
            const SizedBox(height: IneedSpacing.s6),
            IneedButton(
              label: retryLabel,
              variant: IneedButtonVariant.secondary,
              loading: state == DevStatusState.checking,
              onPressed: onRetry,
            ),
          ],
        ),
      ),
    );
  }
}
