import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// Enregistre l'appareil pour les notifications push une fois l'utilisateur connecté (écran d'accueil).
class PushRegistrar extends ConsumerStatefulWidget {
  const PushRegistrar({required this.child, super.key});

  final Widget child;

  @override
  ConsumerState<PushRegistrar> createState() => _PushRegistrarState();
}

class _PushRegistrarState extends ConsumerState<PushRegistrar> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) registerPushDevice(ref);
    });
  }

  @override
  Widget build(BuildContext context) => widget.child;
}
