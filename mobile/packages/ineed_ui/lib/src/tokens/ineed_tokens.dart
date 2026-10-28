// GÉNÉRÉ AUTOMATIQUEMENT depuis design/tokens.json — ne pas modifier à la main.
// Version des tokens : 0.2.0

import 'package:flutter/painting.dart';

/// Palette brute. Utiliser de préférence les rôles de [IneedColorScheme].
abstract final class IneedPalette {
  static const navy950 = Color(0xFF071C3F);
  static const navy900 = Color(0xFF0B2A5B);
  static const navy800 = Color(0xFF123A7A);
  static const blue700 = Color(0xFF1749CC);
  static const blue600 = Color(0xFF1F5EFF);
  static const blue400 = Color(0xFF6F95FF);
  static const blue100 = Color(0xFFE3EBFF);
  static const blue50 = Color(0xFFF0F4FF);
  static const orange700 = Color(0xFFA34500);
  static const orange500 = Color(0xFFFF7A1A);
  static const orange300 = Color(0xFFFFB27A);
  static const orange100 = Color(0xFFFFEBDC);
  static const green700 = Color(0xFF0B7A3B);
  static const green400 = Color(0xFF4CC97F);
  static const green100 = Color(0xFFDDF5E6);
  static const red700 = Color(0xFFB42318);
  static const red400 = Color(0xFFF97066);
  static const red100 = Color(0xFFFDE6E4);
  static const amber700 = Color(0xFF9A4A00);
  static const amber400 = Color(0xFFF5B13D);
  static const amber100 = Color(0xFFFFF1DB);
  static const neutral0 = Color(0xFFFFFFFF);
  static const neutral50 = Color(0xFFF5F7FB);
  static const neutral100 = Color(0xFFEBEFF6);
  static const neutral200 = Color(0xFFD9E0EB);
  static const neutral300 = Color(0xFFB9C3D3);
  static const neutral400 = Color(0xFF8C98AD);
  static const neutral500 = Color(0xFF5F6B82);
  static const neutral600 = Color(0xFF475268);
  static const neutral700 = Color(0xFF343D50);
  static const neutral800 = Color(0xFF1F2738);
  static const neutral850 = Color(0xFF172033);
  static const neutral900 = Color(0xFF101828);
  static const neutral950 = Color(0xFF0A101C);
}

/// Couleurs par rôle, pour un thème donné.
final class IneedColorScheme {
  const IneedColorScheme({required this.background, required this.surface, required this.surfaceMuted, required this.border, required this.borderStrong, required this.text, required this.textMuted, required this.textSubtle, required this.primary, required this.onPrimary, required this.action, required this.actionPressed, required this.onAction, required this.actionSoft, required this.onActionSoft, required this.urgent, required this.onUrgent, required this.urgentSoft, required this.onUrgentSoft, required this.success, required this.onSuccess, required this.successSoft, required this.onSuccessSoft, required this.danger, required this.onDanger, required this.dangerSoft, required this.onDangerSoft, required this.warningSoft, required this.onWarningSoft, required this.rating, required this.focus, required this.skeleton});

  final Color background;
  final Color surface;
  final Color surfaceMuted;
  final Color border;
  final Color borderStrong;
  final Color text;
  final Color textMuted;
  final Color textSubtle;
  final Color primary;
  final Color onPrimary;
  final Color action;
  final Color actionPressed;
  final Color onAction;
  final Color actionSoft;
  final Color onActionSoft;
  final Color urgent;
  final Color onUrgent;
  final Color urgentSoft;
  final Color onUrgentSoft;
  final Color success;
  final Color onSuccess;
  final Color successSoft;
  final Color onSuccessSoft;
  final Color danger;
  final Color onDanger;
  final Color dangerSoft;
  final Color onDangerSoft;
  final Color warningSoft;
  final Color onWarningSoft;
  final Color rating;
  final Color focus;
  final Color skeleton;

  static const light = IneedColorScheme(
    background: Color(0xFFF5F7FB),
    surface: Color(0xFFFFFFFF),
    surfaceMuted: Color(0xFFEBEFF6),
    border: Color(0xFFD9E0EB),
    borderStrong: Color(0xFFB9C3D3),
    text: Color(0xFF101828),
    textMuted: Color(0xFF475268),
    textSubtle: Color(0xFF5F6B82),
    primary: Color(0xFF0B2A5B),
    onPrimary: Color(0xFFFFFFFF),
    action: Color(0xFF1F5EFF),
    actionPressed: Color(0xFF1749CC),
    onAction: Color(0xFFFFFFFF),
    actionSoft: Color(0xFFF0F4FF),
    onActionSoft: Color(0xFF1749CC),
    urgent: Color(0xFFFF7A1A),
    onUrgent: Color(0xFF071C3F),
    urgentSoft: Color(0xFFFFEBDC),
    onUrgentSoft: Color(0xFFA34500),
    success: Color(0xFF0B7A3B),
    onSuccess: Color(0xFFFFFFFF),
    successSoft: Color(0xFFDDF5E6),
    onSuccessSoft: Color(0xFF0B7A3B),
    danger: Color(0xFFB42318),
    onDanger: Color(0xFFFFFFFF),
    dangerSoft: Color(0xFFFDE6E4),
    onDangerSoft: Color(0xFFB42318),
    warningSoft: Color(0xFFFFF1DB),
    onWarningSoft: Color(0xFF9A4A00),
    rating: Color(0xFFF5B13D),
    focus: Color(0xFF1F5EFF),
    skeleton: Color(0xFFEBEFF6),
  );

  static const dark = IneedColorScheme(
    background: Color(0xFF0A101C),
    surface: Color(0xFF172033),
    surfaceMuted: Color(0xFF1F2738),
    border: Color(0xFF343D50),
    borderStrong: Color(0xFF475268),
    text: Color(0xFFF5F7FB),
    textMuted: Color(0xFFB9C3D3),
    textSubtle: Color(0xFF8C98AD),
    primary: Color(0xFF123A7A),
    onPrimary: Color(0xFFFFFFFF),
    action: Color(0xFF6F95FF),
    actionPressed: Color(0xFFE3EBFF),
    onAction: Color(0xFF071C3F),
    actionSoft: Color(0xFF0B2A5B),
    onActionSoft: Color(0xFFE3EBFF),
    urgent: Color(0xFFFF7A1A),
    onUrgent: Color(0xFF071C3F),
    urgentSoft: Color(0xFF1F2738),
    onUrgentSoft: Color(0xFFFFB27A),
    success: Color(0xFF4CC97F),
    onSuccess: Color(0xFF071C3F),
    successSoft: Color(0xFF1F2738),
    onSuccessSoft: Color(0xFF4CC97F),
    danger: Color(0xFFF97066),
    onDanger: Color(0xFF071C3F),
    dangerSoft: Color(0xFF1F2738),
    onDangerSoft: Color(0xFFF97066),
    warningSoft: Color(0xFF1F2738),
    onWarningSoft: Color(0xFFF5B13D),
    rating: Color(0xFFF5B13D),
    focus: Color(0xFF6F95FF),
    skeleton: Color(0xFF1F2738),
  );
}

/// Échelle typographique (tailles et interlignes en pixels logiques).
final class IneedTextStyleSpec {
  const IneedTextStyleSpec(this.family, this.size, this.lineHeight, this.weight, this.letterSpacing);
  final String family;
  final double size;
  final double lineHeight;
  final int weight;
  final double letterSpacing;
  double get height => lineHeight / size;
}

abstract final class IneedTypography {
  static const displayFamily = 'Plus Jakarta Sans';
  static const bodyFamily = 'Inter';
  static const display = IneedTextStyleSpec(displayFamily, 28, 34, 800, -0.4);
  static const titleL = IneedTextStyleSpec(displayFamily, 22, 28, 700, -0.2);
  static const titleM = IneedTextStyleSpec(displayFamily, 18, 24, 700, 0);
  static const bodyL = IneedTextStyleSpec(bodyFamily, 16, 24, 400, 0);
  static const bodyM = IneedTextStyleSpec(bodyFamily, 14, 20, 400, 0);
  static const label = IneedTextStyleSpec(bodyFamily, 14, 20, 600, 0.1);
  static const button = IneedTextStyleSpec(bodyFamily, 16, 20, 600, 0.1);
  static const caption = IneedTextStyleSpec(bodyFamily, 12, 16, 500, 0.2);
  static const amount = IneedTextStyleSpec(displayFamily, 24, 30, 800, -0.2);
}

abstract final class IneedSpacing {
  static const double s0 = 0;
  static const double s1 = 4;
  static const double s2 = 8;
  static const double s3 = 12;
  static const double s4 = 16;
  static const double s5 = 20;
  static const double s6 = 24;
  static const double s8 = 32;
  static const double s10 = 40;
  static const double s12 = 48;
}

abstract final class IneedRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double pill = 999;
}

abstract final class IneedSizing {
  static const double touchTargetMin = 48;
  static const double buttonHeight = 52;
  static const double inputHeight = 52;
  static const double iconSm = 20;
  static const double iconMd = 24;
  static const double avatarMd = 48;
  static const double avatarLg = 72;
  static const double screenGutter = 16;
}

abstract final class IneedMotion {
  static const fast = Duration(milliseconds: 120);
  static const base = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 320);
}
