import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import '../widgets/otp_code_field.dart';

/// C-30 : suppression du compte, confirmée par un code SMS.
class DeleteAccountScreen extends ConsumerStatefulWidget {
  const DeleteAccountScreen({required this.onDeleted, super.key});

  final VoidCallback onDeleted;

  @override
  ConsumerState<DeleteAccountScreen> createState() => _DeleteAccountScreenState();
}

class _DeleteAccountScreenState extends ConsumerState<DeleteAccountScreen> {
  final _code = TextEditingController();
  OtpChallenge? _challenge;
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _run(Future<void> Function() action) async {
    final l = CommonLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await action();
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _requestCode() => _run(() async {
        final c = await ref.read(apiProvider).requestDeletionCode();
        setState(() => _challenge = c);
      });

  Future<void> _confirm(String code) => _run(() async {
        await ref.read(apiProvider).confirmDeletion(_challenge!.challengeId, code);
        ref.read(sessionProvider.notifier).deleted();
        widget.onDeleted();
      });

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final session = ref.watch(sessionProvider).value;
    final phone = session is SignedIn && session.me.phone != null ? formatPhone(session.me.phone!) : '';
    return Scaffold(
      appBar: AppBar(title: Text(l.profileDeleteAccount)),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            if (_challenge == null) ...[
              Text(l.profileDeleteTitle, style: text.headlineMedium),
              const SizedBox(height: IneedSpacing.s3),
              Text(l.profileDeleteBody, style: text.bodyLarge),
            ] else ...[
              Text(l.profileDeleteCodeTitle, style: text.titleLarge),
              const SizedBox(height: IneedSpacing.s2),
              Text(l.profileDeleteCodeSubtitle(phone), style: text.bodyLarge),
              const SizedBox(height: IneedSpacing.s4),
              OtpCodeField(controller: _code, label: l.authOtpCodeLabel, enabled: !_busy, onCompleted: _confirm),
              if (_challenge!.devMode) ...[const SizedBox(height: IneedSpacing.s4), IneedBanner(message: l.authDevModeBanner, tone: IneedBannerTone.warning)],
            ],
            if (_error != null) ...[const SizedBox(height: IneedSpacing.s4), IneedBanner(message: _error!, tone: IneedBannerTone.danger)],
            const SizedBox(height: IneedSpacing.s6),
            if (_challenge == null)
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: context.ineedColors.danger, foregroundColor: context.ineedColors.onDanger),
                onPressed: _busy ? null : _requestCode,
                child: Text(l.profileDeleteConfirm),
              ),
            TextButton(onPressed: () => Navigator.of(context).maybePop(), child: Text(l.actionCancel)),
          ],
        ),
      ),
    );
  }
}
