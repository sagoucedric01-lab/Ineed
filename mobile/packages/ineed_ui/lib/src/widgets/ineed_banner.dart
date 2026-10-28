import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens/ineed_tokens.dart';

enum IneedBannerTone { info, success, warning, danger }

/// Message contextuel (information, succès, avertissement, erreur), avec action facultative.
class IneedBanner extends StatelessWidget {
  const IneedBanner({required this.message, this.tone = IneedBannerTone.info, this.actionLabel, this.onAction, super.key});

  final String message;
  final IneedBannerTone tone;
  final String? actionLabel;
  final VoidCallback? onAction;

  @override
  Widget build(BuildContext context) {
    final c = context.ineedColors;
    final (Color bg, Color fg, IconData icon) = switch (tone) {
      IneedBannerTone.info => (c.actionSoft, c.onActionSoft, Icons.info_outline),
      IneedBannerTone.success => (c.successSoft, c.onSuccessSoft, Icons.check_circle_outline),
      IneedBannerTone.warning => (c.warningSoft, c.onWarningSoft, Icons.warning_amber_outlined),
      IneedBannerTone.danger => (c.dangerSoft, c.onDangerSoft, Icons.error_outline),
    };
    return Semantics(
      liveRegion: true,
      child: Container(
        padding: const EdgeInsets.all(IneedSpacing.s3),
        decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(IneedRadius.md)),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(icon, color: fg, size: IneedSizing.iconSm),
            const SizedBox(width: IneedSpacing.s2),
            Expanded(child: Text(message, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: fg))),
            if (actionLabel != null && onAction != null)
              TextButton(onPressed: onAction, style: TextButton.styleFrom(foregroundColor: fg), child: Text(actionLabel!)),
          ],
        ),
      ),
    );
  }
}
