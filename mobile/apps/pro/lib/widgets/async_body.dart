import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

/// Contenu chargé depuis le serveur : indicateur d'attente, message d'erreur avec « Réessayer », ou le contenu.
class AsyncBody<T> extends StatelessWidget {
  const AsyncBody({required this.value, required this.onRetry, required this.builder, super.key});

  final AsyncValue<T> value;
  final VoidCallback onRetry;
  final Widget Function(T data) builder;

  @override
  Widget build(BuildContext context) {
    return switch (value) {
      AsyncData(:final value) => builder(value),
      AsyncError(:final error) => Center(
          child: Padding(
            padding: const EdgeInsets.all(IneedSpacing.s6),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(failureMessage(CommonLocalizations.of(context), error), textAlign: TextAlign.center),
                const SizedBox(height: IneedSpacing.s4),
                OutlinedButton(onPressed: onRetry, child: Text(CommonLocalizations.of(context).actionRetry)),
              ],
            ),
          ),
        ),
      _ => const Center(child: CircularProgressIndicator()),
    };
  }
}
