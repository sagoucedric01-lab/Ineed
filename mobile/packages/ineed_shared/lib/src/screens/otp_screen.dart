import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import '../widgets/otp_code_field.dart';

/// C-03 / P-01 : saisie du code reçu par SMS, renvoi, ouverture de la session.
class OtpScreen extends ConsumerStatefulWidget {
  const OtpScreen({required this.phone, required this.challenge, required this.onLoggedIn, super.key});

  final String phone;
  final OtpChallenge challenge;
  final void Function(LoginResult result) onLoggedIn;

  @override
  ConsumerState<OtpScreen> createState() => _OtpScreenState();
}

class _OtpScreenState extends ConsumerState<OtpScreen> {
  final _code = TextEditingController();
  late OtpChallenge _challenge = widget.challenge;
  Timer? _ticker;
  int _secondsLeft = 0;
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _startCountdown();
  }

  void _startCountdown() {
    _ticker?.cancel();
    void tick() {
      final left = _challenge.resendAvailableAt.difference(DateTime.now()).inSeconds;
      setState(() => _secondsLeft = left > 0 ? left : 0);
      if (left <= 0) _ticker?.cancel();
    }
    _secondsLeft = _challenge.resendAvailableAt.difference(DateTime.now()).inSeconds.clamp(0, 600);
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) => tick());
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _code.dispose();
    super.dispose();
  }

  Future<void> _verify(String code) async {
    if (_busy) return;
    final l = CommonLocalizations.of(context);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final result = await ref.read(apiProvider).verifyLoginCode(
            challengeId: _challenge.challengeId,
            code: code,
            app: ref.read(appKindProvider),
            deviceLabel: defaultTargetPlatform == TargetPlatform.iOS ? 'iPhone' : 'Android',
          );
      await ref.read(sessionProvider.notifier).signedIn();
      if (mounted) widget.onLoggedIn(result);
    } on Object catch (e) {
      if (!mounted) return;
      _code.clear();
      setState(() => _error = failureMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _resend() async {
    final l = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => _error = null);
    try {
      _challenge = await ref.read(apiProvider).requestLoginCode(widget.phone);
      _code.clear();
      _startCountdown();
      messenger.showSnackBar(SnackBar(content: Text(l.authOtpSent)));
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(l, e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          children: [
            Text(l.authOtpTitle, style: text.headlineMedium),
            const SizedBox(height: IneedSpacing.s2),
            Text(l.authOtpSubtitle(formatPhone(widget.phone)), style: text.bodyLarge?.copyWith(color: c.textMuted)),
            const SizedBox(height: IneedSpacing.s6),
            OtpCodeField(controller: _code, label: l.authOtpCodeLabel, enabled: !_busy, errorText: _error, onCompleted: _verify),
            const SizedBox(height: IneedSpacing.s4),
            if (_busy)
              Text(l.authOtpVerifying, style: text.bodyMedium)
            else if (_secondsLeft > 0)
              Text(l.authOtpResendIn(_secondsLeft), style: text.bodyMedium?.copyWith(color: c.textMuted))
            else
              Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _resend, child: Text(l.authOtpResend))),
            TextButton(onPressed: () => Navigator.of(context).maybePop(), child: Text(l.authChangeNumber)),
            if (_challenge.devMode) ...[
              const SizedBox(height: IneedSpacing.s6),
              IneedBanner(message: l.authDevModeBanner, tone: IneedBannerTone.warning),
            ],
          ],
        ),
      ),
    );
  }
}
