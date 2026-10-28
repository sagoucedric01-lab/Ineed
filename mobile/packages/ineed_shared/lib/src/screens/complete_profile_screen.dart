import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';

/// Même règle que le serveur : lettres (accents compris), espaces, tirets, apostrophes, points.
final _namePattern = RegExp(r"^\p{L}[\p{L}\p{M}' .’-]*$", unicode: true);

/// C-04 : prénom et nom (aussi utilisé pour les modifier depuis le compte).
class CompleteProfileScreen extends ConsumerStatefulWidget {
  const CompleteProfileScreen({required this.onDone, super.key});

  final VoidCallback onDone;

  @override
  ConsumerState<CompleteProfileScreen> createState() => _CompleteProfileScreenState();
}

class _CompleteProfileScreenState extends ConsumerState<CompleteProfileScreen> {
  final _first = TextEditingController();
  final _last = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    final s = ref.read(sessionProvider).value;
    if (s is SignedIn) {
      _first.text = s.me.firstName ?? '';
      _last.text = s.me.lastName ?? '';
    }
  }

  @override
  void dispose() {
    _first.dispose();
    _last.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final l = CommonLocalizations.of(context);
    final first = _first.text.trim();
    final last = _last.text.trim();
    if (first.isEmpty || last.isEmpty) return setState(() => _error = l.profileNameRequired);
    if (!_namePattern.hasMatch(first) || !_namePattern.hasMatch(last)) return setState(() => _error = l.profileNameInvalid);
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final me = await ref.read(apiProvider).updateNames(first, last);
      ref.read(sessionProvider.notifier).updateMe(me);
      if (mounted) widget.onDone();
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
            Text(l.profileCompleteTitle, style: text.headlineMedium),
            const SizedBox(height: IneedSpacing.s2),
            Text(l.profileCompleteSubtitle, style: text.bodyLarge?.copyWith(color: context.ineedColors.textMuted)),
            const SizedBox(height: IneedSpacing.s6),
            TextField(
              controller: _first,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.givenName],
              decoration: InputDecoration(labelText: l.profileFirstName),
              textInputAction: TextInputAction.next,
            ),
            const SizedBox(height: IneedSpacing.s4),
            TextField(
              controller: _last,
              textCapitalization: TextCapitalization.words,
              autofillHints: const [AutofillHints.familyName],
              decoration: InputDecoration(labelText: l.profileLastName),
              onSubmitted: (_) => _save(),
            ),
            if (_error != null) ...[const SizedBox(height: IneedSpacing.s4), IneedBanner(message: _error!, tone: IneedBannerTone.danger)],
            const SizedBox(height: IneedSpacing.s6),
            IneedButton(label: l.actionContinue, loading: _busy, onPressed: _save),
          ],
        ),
      ),
    );
  }
}
