import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

/// Saisie d'un code à 6 chiffres (remplissage automatique du SMS proposé par le système).
/// [onCompleted] est appelé dès le 6ᵉ chiffre.
class OtpCodeField extends StatelessWidget {
  const OtpCodeField({required this.controller, required this.label, required this.onCompleted, this.enabled = true, this.errorText, super.key});

  final TextEditingController controller;
  final String label;
  final ValueChanged<String> onCompleted;
  final bool enabled;
  final String? errorText;

  @override
  Widget build(BuildContext context) {
    return TextField(
      controller: controller,
      enabled: enabled,
      autofocus: true,
      keyboardType: TextInputType.number,
      textInputAction: TextInputAction.done,
      autofillHints: const [AutofillHints.oneTimeCode],
      inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(6)],
      textAlign: TextAlign.center,
      style: Theme.of(context).textTheme.headlineMedium?.copyWith(letterSpacing: 12),
      decoration: InputDecoration(labelText: label, errorText: errorText, counterText: ''),
      onChanged: (v) {
        if (v.length == 6) onCompleted(v);
      },
    );
  }
}
