import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';

class _LineFields {
  _LineFields(this.kind, {String label = '', int quantity = 1, int? unitPrice})
      : label = TextEditingController(text: label),
        quantity = TextEditingController(text: '$quantity'),
        unitPrice = TextEditingController(text: unitPrice == null ? '' : '$unitPrice'),
        justification = TextEditingController();
  QuoteLineKind kind;
  final TextEditingController label;
  final TextEditingController quantity;
  final TextEditingController unitPrice;
  final TextEditingController justification;

  int get qty => int.tryParse(quantity.text) ?? 0;
  int get price => int.tryParse(unitPrice.text) ?? 0;

  void dispose() {
    label.dispose();
    quantity.dispose();
    unitPrice.dispose();
    justification.dispose();
  }
}

/// P-17 : rédaction d'un devis (ou d'une nouvelle version), ou de frais supplémentaires pendant les travaux.
class QuoteEditorScreen extends ConsumerStatefulWidget {
  const QuoteEditorScreen({required this.missionId, this.supplement = false, super.key});

  final String missionId;
  final bool supplement;

  @override
  ConsumerState<QuoteEditorScreen> createState() => _QuoteEditorScreenState();
}

class _QuoteEditorScreenState extends ConsumerState<QuoteEditorScreen> {
  late final List<_LineFields> _lines = widget.supplement
      ? [_LineFields(QuoteLineKind.material)]
      : [_LineFields(QuoteLineKind.travel, label: 'Déplacement'), _LineFields(QuoteLineKind.labor, label: 'Main-d’œuvre')];
  final _conditions = TextEditingController();
  final _duration = TextEditingController();
  int _validHours = 48;
  bool _sending = false;
  String? _error;

  /// Clé conservée tant que l'envoi n'a pas abouti : un nouvel essai après une coupure ne crée pas deux versions.
  String? _key;

  @override
  void dispose() {
    for (final l in _lines) {
      l.dispose();
    }
    _conditions.dispose();
    _duration.dispose();
    super.dispose();
  }

  int get _total => _lines.fold(0, (s, l) => s + l.qty * l.price);

  String? _validate(AppLocalizations l) {
    if (_lines.any((x) => x.label.text.trim().length < 2)) return l.quoteErrorLabel;
    if (widget.supplement && _lines.any((x) => x.justification.text.trim().isEmpty)) return l.quoteErrorJustification;
    if (_total <= 0) return l.quoteErrorTotal;
    if (_total % 5 != 0) return l.quoteErrorMultiple;
    return null;
  }

  Future<void> _send() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final error = _validate(l);
    setState(() => _error = error);
    if (error != null) return;
    final draft = QuoteDraft(
      lines: [
        for (final x in _lines)
          QuoteLine(kind: x.kind, label: x.label.text.trim(), quantity: x.qty, unitPriceXof: x.price, justification: widget.supplement ? x.justification.text : null),
      ],
      validForHours: _validHours,
      conditions: _conditions.text,
      estimatedDurationMin: int.tryParse(_duration.text),
    );
    setState(() => _sending = true);
    final messenger = ScaffoldMessenger.of(context);
    try {
      _key ??= newIdempotencyKey();
      await ref.read(apiProvider).submitQuote(widget.missionId, draft, idempotencyKey: _key!);
      ref.invalidate(proMissionProvider(widget.missionId));
      messenger.showSnackBar(SnackBar(content: Text(l.quoteSent)));
      if (mounted) context.pop();
    } on Object catch (e) {
      if (e is ServerFailure) _key = null;
      if (mounted) setState(() => _error = failureMessage(common, e));
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  String _kindLabel(AppLocalizations l, QuoteLineKind k) => switch (k) {
        QuoteLineKind.travel => l.quoteKindTravel,
        QuoteLineKind.labor => l.quoteKindLabor,
        QuoteLineKind.material => l.quoteKindMaterial,
        QuoteLineKind.other => l.quoteKindOther,
      };

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final digits = [FilteringTextInputFormatter.digitsOnly];
    return Scaffold(
      appBar: AppBar(title: Text(widget.supplement ? l.quoteEditorSupplementTitle : l.quoteEditorTitle)),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          Text(widget.supplement ? l.quoteEditorSupplementHelp : l.quoteEditorHelp, style: text.bodySmall?.copyWith(color: c.textMuted)),
          const SizedBox(height: IneedSpacing.s3),
          for (final (i, line) in _lines.indexed)
            Card(
              child: Padding(
                padding: const EdgeInsets.all(IneedSpacing.s3),
                child: Column(children: [
                  Row(children: [
                    Expanded(
                      child: DropdownButtonFormField<QuoteLineKind>(
                        initialValue: line.kind,
                        decoration: InputDecoration(labelText: l.quoteLineKind),
                        items: [for (final k in QuoteLineKind.values) DropdownMenuItem(value: k, child: Text(_kindLabel(l, k)))],
                        onChanged: (k) => setState(() => line.kind = k ?? line.kind),
                      ),
                    ),
                    if (_lines.length > 1)
                      IconButton(
                        tooltip: l.quoteRemoveLine,
                        icon: const Icon(Icons.delete_outline),
                        onPressed: () => setState(() => _lines.removeAt(i).dispose()),
                      ),
                  ]),
                  TextField(controller: line.label, maxLength: 120, decoration: InputDecoration(labelText: l.quoteLineLabel), onChanged: (_) => setState(() {})),
                  Row(children: [
                    SizedBox(
                      width: 100,
                      child: TextField(controller: line.quantity, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.quoteLineQuantity), onChanged: (_) => setState(() {})),
                    ),
                    const SizedBox(width: IneedSpacing.s3),
                    Expanded(
                      child: TextField(controller: line.unitPrice, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.quoteLineUnitPrice), onChanged: (_) => setState(() {})),
                    ),
                  ]),
                  if (widget.supplement) TextField(controller: line.justification, maxLength: 500, decoration: InputDecoration(labelText: l.quoteLineJustification)),
                ]),
              ),
            ),
          if (_lines.length < 30)
            TextButton.icon(onPressed: () => setState(() => _lines.add(_LineFields(QuoteLineKind.other))), icon: const Icon(Icons.add), label: Text(l.quoteAddLine)),
          const SizedBox(height: IneedSpacing.s3),
          Text(l.quoteTotal(formatXof(_total)), style: text.titleLarge),
          const SizedBox(height: IneedSpacing.s3),
          DropdownButtonFormField<int>(
            initialValue: _validHours,
            decoration: InputDecoration(labelText: l.quoteValidity),
            items: [for (final h in const [24, 48, 72]) DropdownMenuItem(value: h, child: Text(l.quoteValidityHours('$h')))],
            onChanged: (h) => setState(() => _validHours = h ?? 48),
          ),
          if (!widget.supplement) ...[
            TextField(controller: _conditions, maxLines: 3, maxLength: 2000, decoration: InputDecoration(labelText: l.quoteConditions)),
            TextField(controller: _duration, keyboardType: TextInputType.number, inputFormatters: digits, decoration: InputDecoration(labelText: l.quoteDuration)),
          ],
          if (_error != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: IneedBanner(message: _error!, tone: IneedBannerTone.danger)),
          const SizedBox(height: IneedSpacing.s4),
          IneedButton(label: l.quoteSend, loading: _sending, onPressed: _send),
        ],
      ),
    );
  }
}
