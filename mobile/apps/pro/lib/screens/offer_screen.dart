import 'dart:async';

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
import '../widgets/open_chat.dart';

final _offerProvider = FutureProvider.autoDispose.family<ProOffer, String>((ref, id) => ref.read(apiProvider).proOffer(id));

String _two(int v) => v.toString().padLeft(2, '0');
String _hm(DateTime d) => '${_two(d.toUtc().hour)}:${_two(d.toUtc().minute)}';
String _km(int m) => (m / 1000).toStringAsFixed(1).replaceAll('.', ',');

/// P-11 / P-12 : demande reçue. Urgence : accepter ou refuser ; programmé : proposer un horaire (et un prix).
class OfferScreen extends ConsumerStatefulWidget {
  const OfferScreen({required this.offerId, super.key});

  final String offerId;

  @override
  ConsumerState<OfferScreen> createState() => _OfferScreenState();
}

class _OfferScreenState extends ConsumerState<OfferScreen> {
  Timer? _clock;
  bool _busy = false;
  String? _message;
  DateTime? _start;
  final _price = TextEditingController();
  final _travel = TextEditingController();
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    // Compte à rebours de la réponse.
    _clock = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _clock?.cancel();
    _price.dispose();
    _travel.dispose();
    _note.dispose();
    super.dispose();
  }

  Future<void> _run(Future<ProOffer> Function() action, String success) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await action();
      _message = success;
    } on ServerFailure catch (e) {
      _message = switch (e.code) {
        'OFFER_TAKEN' => l.alertTaken,
        'OFFER_EXPIRED' => l.alertExpired,
        'PROPOSAL_OUTSIDE_WINDOW' => l.proposalStartInvalid,
        _ => failureMessage(common, e),
      };
    } on Object catch (e) {
      _message = failureMessage(common, e);
    } finally {
      ref.invalidate(_offerProvider(widget.offerId));
      ref.invalidate(proOffersProvider);
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _decline() async {
    final l = AppLocalizations.of(context);
    final reason = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          for (final r in [l.alertDeclineReasonBusy, l.alertDeclineReasonTooFar, l.alertDeclineReasonSkill, l.alertDeclineReasonOther])
            ListTile(title: Text(r), onTap: () => Navigator.pop(context, r)),
        ]),
      ),
    );
    if (reason == null) return;
    await _run(() => ref.read(apiProvider).declineOffer(widget.offerId, reason: reason), l.alertDecline);
    if (mounted) context.pop();
  }

  Future<void> _pickStart(TimeWindow w) async {
    final initial = _start ?? w.start;
    final t = await showTimePicker(context: context, initialTime: TimeOfDay(hour: initial.toUtc().hour, minute: initial.toUtc().minute));
    if (t == null) return;
    final d = w.start.toUtc();
    setState(() => _start = DateTime.utc(d.year, d.month, d.day, t.hour, t.minute));
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(),
      body: ref.watch(_offerProvider(widget.offerId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(failureMessage(common, e), textAlign: TextAlign.center))),
            data: (o) {
              final seconds = o.expiresAt.difference(DateTime.now()).inSeconds;
              final open = o.isOpen && seconds > 0;
              return ListView(
                padding: const EdgeInsets.all(IneedSpacing.s4),
                children: [
                  Text(o.mode == RequestMode.urgent ? l.alertTitleUrgent : l.alertTitleScheduled, style: text.labelLarge?.copyWith(color: o.mode == RequestMode.urgent ? c.urgent : c.action)),
                  Text(o.service?.name ?? o.category.name, style: text.headlineSmall),
                  Text(l.alertDistance(_km(o.distanceM), o.zoneName)),
                  if (open && o.mode == RequestMode.urgent) Text(l.alertExpiresIn(seconds), style: text.titleMedium?.copyWith(color: c.urgent)),
                  const SizedBox(height: IneedSpacing.s3),
                  Text(o.description),
                  if (o.window != null) ...[
                    const SizedBox(height: IneedSpacing.s3),
                    Text(l.alertSlot, style: text.labelMedium),
                    Text('${formatAbidjanDateTime(o.window!.start)} – ${_hm(o.window!.end)}'),
                  ],
                  if (o.budgetXof != null) ...[
                    const SizedBox(height: IneedSpacing.s3),
                    Text(l.alertBudget, style: text.labelMedium),
                    Text(formatXof(o.budgetXof!)),
                  ],
                  if (o.media.any((m) => m.kind == 'PHOTO')) ...[
                    const SizedBox(height: IneedSpacing.s3),
                    Wrap(spacing: IneedSpacing.s2, children: [
                      for (final m in o.media.where((m) => m.kind == 'PHOTO'))
                        ClipRRect(
                          borderRadius: BorderRadius.circular(IneedRadius.sm),
                          child: SizedBox.square(dimension: 84, child: Image.network(m.url, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.image_outlined))),
                        ),
                    ]),
                  ],
                  const SizedBox(height: IneedSpacing.s3),
                  Text(l.alertPrivacyNote, style: text.bodySmall?.copyWith(color: c.textMuted)),
                  if (_message != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s4), child: IneedBanner(message: _message!)),
                  if (!open && o.status == 'ACCEPTED' && _message == null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s4), child: IneedBanner(message: o.mode == RequestMode.urgent ? l.alertAcceptedWaiting : l.proposalSent, tone: IneedBannerTone.success)),
                  // Le client et le professionnel peuvent échanger dès l'acceptation.
                  if (o.status == 'ACCEPTED' || o.status == 'SELECTED') Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: OpenChatButton(requestId: o.requestId)),
                  if (o.status == 'NOT_SELECTED') Padding(padding: const EdgeInsets.only(top: IneedSpacing.s4), child: IneedBanner(message: l.alertClientDeclined)),
                  if (o.missionId != null)
                    Padding(padding: const EdgeInsets.only(top: IneedSpacing.s4), child: IneedButton(label: l.offerSeeMission, onPressed: () => context.push('/missions/${o.missionId}'))),
                  if (!open && (o.status == 'EXPIRED' || seconds <= 0) && o.status != 'ACCEPTED' && o.status != 'SELECTED' && _message == null)
                    Padding(padding: const EdgeInsets.only(top: IneedSpacing.s4), child: IneedBanner(message: l.alertExpired, tone: IneedBannerTone.warning)),
                  if (open) ...[
                    const SizedBox(height: IneedSpacing.s6),
                    if (o.mode == RequestMode.urgent)
                      IneedButton(label: l.alertAccept, variant: IneedButtonVariant.urgent, loading: _busy, onPressed: () => _run(() => ref.read(apiProvider).acceptOffer(o.id), l.alertAcceptedWaiting))
                    else ...[
                      ListTile(
                        contentPadding: EdgeInsets.zero,
                        title: Text(l.proposalStart),
                        subtitle: Text(_start == null ? '—' : _hm(_start!)),
                        trailing: const Icon(Icons.schedule),
                        onTap: () => _pickStart(o.window!),
                      ),
                      TextField(controller: _price, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: InputDecoration(labelText: l.proposalPrice, suffixText: 'F CFA')),
                      TextField(controller: _travel, keyboardType: TextInputType.number, inputFormatters: [FilteringTextInputFormatter.digitsOnly], decoration: InputDecoration(labelText: l.proposalTravelFee, suffixText: 'F CFA')),
                      TextField(controller: _note, maxLength: 500, decoration: InputDecoration(labelText: l.proposalMessage)),
                      IneedButton(
                        label: l.proposalSend,
                        loading: _busy,
                        onPressed: () {
                          final start = _start;
                          if (start == null) {
                            setState(() => _message = l.proposalStartInvalid);
                            return;
                          }
                          _run(
                            () => ref.read(apiProvider).proposeOffer(o.id, start: start, priceXof: int.tryParse(_price.text), travelFeeXof: int.tryParse(_travel.text), message: _note.text),
                            l.proposalSent,
                          );
                        },
                      ),
                    ],
                    const SizedBox(height: IneedSpacing.s2),
                    IneedButton(label: l.alertDecline, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : _decline),
                  ],
                ],
              );
            },
          ),
    );
  }
}
