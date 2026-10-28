import 'package:flutter/material.dart';

import '../theme.dart';
import '../tokens/ineed_tokens.dart';

enum IneedButtonVariant {
  /// Action principale de l'écran (bleu action).
  primary,

  /// Réservé à l'urgence (orange, texte bleu nuit).
  urgent,

  /// Action secondaire (contour).
  secondary,
}

/// Bouton pleine largeur, 52 px de haut. `onPressed: null` le désactive ; `loading` empêche les doubles envois.
class IneedButton extends StatelessWidget {
  const IneedButton({
    required this.label,
    required this.onPressed,
    this.variant = IneedButtonVariant.primary,
    this.icon,
    this.loading = false,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final IneedButtonVariant variant;
  final IconData? icon;
  final bool loading;

  @override
  Widget build(BuildContext context) {
    final c = context.ineedColors;
    final handler = loading ? null : onPressed;
    final child = loading
        ? SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.5, color: variant == IneedButtonVariant.secondary ? c.text : null))
        : Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (icon != null) ...[Icon(icon, size: IneedSizing.iconSm), const SizedBox(width: IneedSpacing.s2)],
              Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
            ],
          );
    final button = switch (variant) {
      IneedButtonVariant.primary => FilledButton(onPressed: handler, child: child),
      IneedButtonVariant.urgent => FilledButton(
          onPressed: handler,
          style: FilledButton.styleFrom(backgroundColor: c.urgent, foregroundColor: c.onUrgent),
          child: child,
        ),
      IneedButtonVariant.secondary => OutlinedButton(onPressed: handler, child: child),
    };
    return Semantics(button: true, enabled: handler != null, label: loading ? label : null, child: SizedBox(width: double.infinity, child: button));
  }
}
