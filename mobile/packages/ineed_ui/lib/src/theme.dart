import 'package:flutter/material.dart';

import 'tokens/ineed_tokens.dart';

/// Couleurs de rôle Ineed accessibles depuis le thème : `Theme.of(context).extension<IneedColors>()!.scheme`.
class IneedColors extends ThemeExtension<IneedColors> {
  const IneedColors(this.scheme);
  final IneedColorScheme scheme;

  @override
  IneedColors copyWith({IneedColorScheme? scheme}) => IneedColors(scheme ?? this.scheme);

  @override
  IneedColors lerp(ThemeExtension<IneedColors>? other, double t) => t < 0.5 || other is! IneedColors ? this : other;
}

extension IneedThemeContext on BuildContext {
  IneedColorScheme get ineedColors => Theme.of(this).extension<IneedColors>()!.scheme;
}

/// Convertit une spécification de token en style. Les polices variables sont pilotées par l'axe `wght`.
TextStyle ineedTextStyle(IneedTextStyleSpec spec, {Color? color}) => TextStyle(
      fontFamily: spec.family,
      package: 'ineed_ui',
      fontSize: spec.size,
      height: spec.height,
      letterSpacing: spec.letterSpacing,
      fontWeight: FontWeight.values[(spec.weight ~/ 100 - 1).clamp(0, 8)],
      fontVariations: [FontVariation.weight(spec.weight.toDouble())],
      color: color,
    );

ThemeData buildIneedTheme(Brightness brightness) {
  final c = brightness == Brightness.light ? IneedColorScheme.light : IneedColorScheme.dark;
  final shape = RoundedRectangleBorder(borderRadius: BorderRadius.circular(IneedRadius.md));
  const buttonSize = Size.fromHeight(IneedSizing.buttonHeight);
  final textTheme = TextTheme(
    headlineMedium: ineedTextStyle(IneedTypography.display, color: c.text),
    titleLarge: ineedTextStyle(IneedTypography.titleL, color: c.text),
    titleMedium: ineedTextStyle(IneedTypography.titleM, color: c.text),
    bodyLarge: ineedTextStyle(IneedTypography.bodyL, color: c.text),
    bodyMedium: ineedTextStyle(IneedTypography.bodyM, color: c.text),
    labelLarge: ineedTextStyle(IneedTypography.button),
    labelMedium: ineedTextStyle(IneedTypography.label, color: c.text),
    bodySmall: ineedTextStyle(IneedTypography.caption, color: c.textMuted),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: ColorScheme(
      brightness: brightness,
      primary: c.action,
      onPrimary: c.onAction,
      secondary: c.urgent,
      onSecondary: c.onUrgent,
      error: c.danger,
      onError: c.onDanger,
      surface: c.surface,
      onSurface: c.text,
      onSurfaceVariant: c.textMuted,
      surfaceContainerHighest: c.surfaceMuted,
      outline: c.borderStrong,
      outlineVariant: c.border,
    ),
    scaffoldBackgroundColor: c.background,
    textTheme: textTheme,
    extensions: [IneedColors(c)],
    materialTapTargetSize: MaterialTapTargetSize.padded,
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(minimumSize: buttonSize, shape: shape, textStyle: textTheme.labelLarge),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: buttonSize,
        shape: shape,
        foregroundColor: c.text,
        side: BorderSide(color: c.borderStrong, width: 1.5),
        textStyle: textTheme.labelLarge,
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: c.surface,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(IneedRadius.md), borderSide: BorderSide(color: c.borderStrong, width: 1.5)),
      enabledBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(IneedRadius.md), borderSide: BorderSide(color: c.borderStrong, width: 1.5)),
      focusedBorder: OutlineInputBorder(borderRadius: BorderRadius.circular(IneedRadius.md), borderSide: BorderSide(color: c.focus, width: 2)),
    ),
  );
}
