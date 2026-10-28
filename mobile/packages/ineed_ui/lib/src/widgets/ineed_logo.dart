import 'package:flutter/widgets.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Symbole Ineed (« i » au repère de localisation). [pro] affiche la variante Ineed Pro.
class IneedLogo extends StatelessWidget {
  const IneedLogo({this.size = 72, this.pro = false, super.key});

  final double size;
  final bool pro;

  @override
  Widget build(BuildContext context) => SvgPicture.asset(
        pro ? 'assets/brand/symbole-pro.svg' : 'assets/brand/symbole.svg',
        package: 'ineed_ui',
        width: size,
        height: size,
        semanticsLabel: pro ? 'Ineed Pro' : 'Ineed',
      );
}
