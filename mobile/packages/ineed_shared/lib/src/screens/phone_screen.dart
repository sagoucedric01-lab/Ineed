import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import '../widgets/phone_formatter.dart';

/// C-02 / P-01 : saisie du numéro de téléphone, envoi du code.
class PhoneScreen extends ConsumerStatefulWidget {
  const PhoneScreen({required this.onCodeSent, super.key});

  /// Appelé avec le numéro au format E.164 et le défi créé par le serveur.
  final void Function(String phone, OtpChallenge challenge) onCodeSent;

  @override
  ConsumerState<PhoneScreen> createState() => _PhoneScreenState();
}

class _PhoneScreenState extends ConsumerState<PhoneScreen> {
  final _controller = TextEditingController();
  bool _busy = false;
  String? _fieldError;
  String? _error;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final l = CommonLocalizations.of(context);
    final phone = normalizeCiMobile(_controller.text);
    if (phone == null) {
      setState(() => _fieldError = l.authPhoneInvalid);
      return;
    }
    setState(() {
      _busy = true;
      _fieldError = null;
      _error = null;
    });
    try {
      final challenge = await ref.read(apiProvider).requestLoginCode(phone);
      if (mounted) widget.onCodeSent(phone, challenge);
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.authPhoneTitle, style: text.headlineMedium),
            const SizedBox(height: IneedSpacing.s2),
            Text(l.authPhoneSubtitle, style: text.bodyLarge?.copyWith(color: context.ineedColors.textMuted)),
            const SizedBox(height: IneedSpacing.s6),
            TextField(
              controller: _controller,
              autofocus: true,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumberNational],
              inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[\d ]')), CiPhoneFormatter()],
              decoration: InputDecoration(labelText: l.authPhoneLabel, hintText: l.authPhoneHint, prefixText: '+225  ', errorText: _fieldError, errorMaxLines: 3),
              onSubmitted: (_) => _submit(),
            ),
            if (_error != null) ...[const SizedBox(height: IneedSpacing.s4), IneedBanner(message: _error!, tone: IneedBannerTone.danger)],
            const SizedBox(height: IneedSpacing.s6),
            Text(l.authTermsNotice, style: text.bodySmall),
            const SizedBox(height: IneedSpacing.s4),
            IneedButton(label: l.authSendCode, loading: _busy, onPressed: _submit),
          ],
        ),
      ),
    );
  }
}
