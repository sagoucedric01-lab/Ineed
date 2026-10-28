import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Icône d'un métier d'après sa clé (`categories.icon_key` en base). Clé inconnue : icône « autres ».
class IneedCategoryIcon extends StatelessWidget {
  const IneedCategoryIcon({required this.iconKey, this.size = 28, this.color, super.key});

  static const known = {
    'plomberie', 'electricite', 'menuiserie', 'serrurerie', 'mecanique-auto', 'climatisation',
    'peinture', 'maconnerie', 'maintenance', 'electromenager', 'carrelage', 'autres',
  };

  final String iconKey;
  final double size;
  final Color? color;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
        'assets/categories/${known.contains(iconKey) ? iconKey : 'autres'}.svg',
        package: 'ineed_ui',
        width: size,
        height: size,
        colorFilter: ColorFilter.mode(color ?? const Color(0xFF0B2A5B), BlendMode.srcIn),
        excludeFromSemantics: true,
      );
}
