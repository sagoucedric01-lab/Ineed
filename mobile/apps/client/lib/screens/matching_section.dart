import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/pro_card_tile.dart';
import '../widgets/slot_picker.dart';

String _two(int v) => v.toString().padLeft(2, '0');
String _hour(DateTime d) => '${_two(d.toUtc().hour)}:${_two(d.toUtc().minute)}';

/// C-17 à C-20 : suivi de la mise en relation selon l'état de la demande (recherche, professionnel réservé,
/// propositions reçues, aucun professionnel, demande attribuée).
class MatchingSection extends ConsumerStatefulWidget {
  const MatchingSection({required this.request, required this.onChanged, super.key});

  final ServiceRequest request;
  final VoidCallback onChanged;

  @override
  ConsumerState<MatchingSection> createState() => _MatchingSectionState();
}

class _MatchingSectionState extends ConsumerState<MatchingSection> {
  bool _busy = false;

  Future<void> _act(Future<void> Function() action) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _busy = true);
    try {
      await action();
      ref.invalidate(requestOffersProvider(widget.request.id));
      ref.invalidate(activeRequestsProvider);
      ref.invalidate(activeMissionsProvider);
      widget.onChanged();
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
      widget.onChanged();
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final r = widget.request;
    final api = ref.read(apiProvider);
    Widget card(List<Widget> children) => Card(
          child: Padding(padding: const EdgeInsets.all(IneedSpacing.s4), child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: children)),
        );

    switch (r.status) {
      case 'PUBLISHED' || 'MATCHING':
        return card([
          Row(children: [
            Icon(Icons.travel_explore, color: c.action),
            const SizedBox(width: IneedSpacing.s3),
            Expanded(child: Text(l.matchingTitle, style: text.titleMedium)),
          ]),
          const SizedBox(height: IneedSpacing.s2),
          Text(l.matchingSubtitle),
          if (r.searchRadiusM != null) Text(l.matchingProgress(0, formatKm(r.searchRadiusM!)), style: text.bodySmall?.copyWith(color: c.textMuted)),
        ]);
      case 'PROVISIONALLY_RESERVED' || 'AWAITING_CLIENT_CONFIRMATION':
        final offers = ref.watch(requestOffersProvider(r.id)).value;
        final reserved = offers?.reserved;
        if (reserved == null) return const LinearProgressIndicator();
        final minutes = r.reservationExpiresAt == null ? 0 : r.reservationExpiresAt!.difference(DateTime.now()).inMinutes.clamp(0, 999);
        return card([
          Text(l.reservedTitle(reserved.pro.businessName), style: text.titleMedium),
          const SizedBox(height: IneedSpacing.s2),
          Text(l.reservedBody(minutes == 0 ? 1 : minutes)),
          const SizedBox(height: IneedSpacing.s3),
          _OfferDetails(offer: reserved),
          const SizedBox(height: IneedSpacing.s3),
          IneedButton(label: l.reservedConfirm, loading: _busy, onPressed: () => _act(() => api.confirmRequest(r.id))),
          const SizedBox(height: IneedSpacing.s2),
          IneedButton(label: l.reservedDecline, variant: IneedButtonVariant.secondary, onPressed: _busy ? null : () => _act(() => api.declineReservation(r.id))),
        ]);
      case 'OFFERS_RECEIVED':
        final offers = ref.watch(requestOffersProvider(r.id)).value?.offers ?? const <ClientOffer>[];
        return card([
          Text(l.offersTitle, style: text.titleMedium),
          if (offers.isNotEmpty) Text(l.offersSubtitle(offers.length)),
          for (final o in offers) ...[
            const Divider(),
            _OfferDetails(offer: o),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton(onPressed: _busy ? null : () => _act(() => api.chooseOffer(r.id, o.id)), child: Text(l.offerChoose)),
            ),
          ],
          const SizedBox(height: IneedSpacing.s2),
          Text(l.offersWaiting, style: text.bodySmall?.copyWith(color: c.textMuted)),
        ]);
      case 'NO_PROVIDER_FOUND':
        return card([
          Text(l.noProviderTitle, style: text.titleMedium),
          const SizedBox(height: IneedSpacing.s2),
          Text(l.noProviderBody),
          const SizedBox(height: IneedSpacing.s3),
          IneedButton(label: l.requestRetry, icon: Icons.refresh, loading: _busy, onPressed: () => _act(() => api.retryRequest(r.id))),
          const SizedBox(height: IneedSpacing.s2),
          IneedButton(
            label: r.mode == RequestMode.urgent ? l.noProviderSchedule : l.noProviderChangeTime,
            icon: Icons.event,
            variant: IneedButtonVariant.secondary,
            onPressed: _busy
                ? null
                : () async {
                    final slot = await pickSlot(context, r.window ?? defaultSlot());
                    if (slot != null) await _act(() => api.retryRequest(r.id, window: slot));
                  },
          ),
        ]);
      case 'ASSIGNED':
        return r.missionId == null
            ? const SizedBox.shrink()
            : Padding(
                padding: const EdgeInsets.only(bottom: IneedSpacing.s4),
                child: IneedButton(label: l.requestSeeMission, icon: Icons.route, onPressed: () => context.push('/missions/${r.missionId}')),
              );
      default:
        return const SizedBox.shrink();
    }
  }
}

class _OfferDetails extends StatelessWidget {
  const _OfferDetails({required this.offer});

  final ClientOffer offer;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final o = offer;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(children: [
          Expanded(child: Text(o.pro.businessName, style: text.titleSmall)),
          if (o.pro.verified) Icon(Icons.verified, size: 18, color: c.success, semanticLabel: l.resultsVerified),
        ]),
        Text(o.pro.ratingAvg != null ? l.resultsRating(o.pro.ratingAvg!.toStringAsFixed(1).replaceAll('.', ','), o.pro.ratingCount) : l.resultsMissions(o.pro.missionsCompleted), style: text.bodySmall),
        Text(l.resultsDistance(formatKm(o.distanceM))),
        if (o.etaMinutes != null) Text(l.resultsEta(o.etaMinutes!)),
        if (o.proposedStartAt != null) Text('${l.offerProposedSlot} : ${_hour(o.proposedStartAt!)}'.replaceAll(' :', ' :')),
        if (o.proposedPriceXof != null) Text('${l.offerProposedPrice} : ${formatXof(o.proposedPriceXof!)}'.replaceAll(' :', ' :'), style: text.bodyMedium?.copyWith(fontWeight: FontWeight.w600)),
        if (o.message != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s1), child: Text('« ${o.message!} »', style: text.bodySmall)),
      ],
    );
  }
}
