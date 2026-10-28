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
import 'request_form_screen.dart';

/// C-09 / C-10 : professionnels proches pour un métier, en urgence ou sur un créneau ;
/// sans résultat, pistes concrètes (élargir le rayon, programmer, changer de créneau).
class ResultsScreen extends ConsumerStatefulWidget {
  const ResultsScreen({required this.categoryId, this.serviceId, super.key});

  final String categoryId;
  final String? serviceId;

  @override
  ConsumerState<ResultsScreen> createState() => _ResultsScreenState();
}

class _ResultsScreenState extends ConsumerState<ResultsScreen> {
  RequestMode _mode = RequestMode.urgent;
  TimeWindow _slot = defaultSlot();
  late String? _serviceId = widget.serviceId;
  int? _radius;
  ProSearchResult? _result;
  Object? _error;
  bool _loading = false;
  String? _searchedFor;

  Future<void> _search(Address address) async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final r = await ref.read(apiProvider).searchPros(
            categoryId: widget.categoryId,
            serviceId: _serviceId,
            mode: _mode,
            location: address.location,
            zoneId: address.zoneId,
            radiusM: _radius,
            window: _mode == RequestMode.scheduled ? _slot : null,
          );
      if (mounted) setState(() => _result = r);
    } on Object catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _changeSlot(Address address) async {
    final picked = await pickSlot(context, _slot);
    if (picked == null) return;
    setState(() {
      _slot = picked;
      _mode = RequestMode.scheduled;
    });
    await _search(address);
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final category = ref.watch(categoriesProvider).value?.where((c) => c.id == widget.categoryId).firstOrNull;
    final address = ref.watch(selectedAddressProvider);
    final a = address.value;

    // Nouvelle recherche dès que l'adresse est connue ou change.
    final key = a?.id;
    if (a != null && key != _searchedFor && !_loading) {
      _searchedFor = key;
      WidgetsBinding.instance.addPostFrameCallback((_) => _search(a));
    }

    final r = _result;
    return Scaffold(
      appBar: AppBar(title: Text(category?.name ?? l.resultsTitle)),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(IneedSpacing.s4),
          child: IneedButton(
            label: l.resultsDescribeNeed,
            onPressed: () => context.push(
              '/demandes/nouvelle',
              extra: RequestFormArgs(mode: _mode, categoryId: widget.categoryId, serviceId: _serviceId, window: _mode == RequestMode.scheduled ? _slot : null),
            ),
          ),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          if (address.isLoading) const LinearProgressIndicator(),
          if (!address.isLoading && a == null) ...[
            IneedBanner(message: l.resultsNeedAddress, tone: IneedBannerTone.warning, actionLabel: l.requestChooseAddress, onAction: () => context.push('/adresses', extra: true)),
          ],
          if (category != null && category.services.isNotEmpty) ...[
            Text(l.serviceChooseTitle, style: text.titleSmall),
            const SizedBox(height: IneedSpacing.s2),
            Wrap(
              spacing: IneedSpacing.s2,
              runSpacing: IneedSpacing.s2,
              children: [
                for (final s in category.services)
                  ChoiceChip(
                    label: Text(s.name),
                    selected: _serviceId == s.id,
                    onSelected: (on) {
                      setState(() => _serviceId = on ? s.id : null);
                      if (a != null) _search(a);
                    },
                  ),
              ],
            ),
            if (category.services.where((s) => s.id == _serviceId).firstOrNull case final s?) _PriceInfo(service: s),
            const SizedBox(height: IneedSpacing.s4),
          ],
          SegmentedButton<RequestMode>(
            segments: [
              ButtonSegment(value: RequestMode.urgent, label: Text(l.requestModeUrgent), icon: const Icon(Icons.bolt)),
              ButtonSegment(value: RequestMode.scheduled, label: Text(l.requestModeScheduled), icon: const Icon(Icons.event)),
            ],
            selected: {_mode},
            onSelectionChanged: (s) {
              setState(() {
                _mode = s.first;
                _radius = null;
              });
              if (a != null) _search(a);
            },
          ),
          if (_mode == RequestMode.scheduled)
            Padding(
              padding: const EdgeInsets.only(top: IneedSpacing.s2),
              child: ActionChip(avatar: const Icon(Icons.schedule, size: 18), label: Text(slotLabel(l, _slot)), onPressed: a == null ? null : () => _changeSlot(a)),
            ),
          const SizedBox(height: IneedSpacing.s3),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            IneedBanner(message: failureMessage(common, _error!), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: a == null ? null : () => _search(a)),
          if (r != null) ...[
            Text(
              r.zoneName == null ? l.resultsRadius(formatKm(r.radiusM)) : l.resultsRadiusZone(formatKm(r.radiusM), r.zoneName!),
              style: text.bodySmall,
            ),
            const SizedBox(height: IneedSpacing.s2),
            for (final p in r.items) ProCardTile(pro: p, onTap: () => context.push('/pros/${p.id}')),
            if (r.items.isEmpty) ...[
              Text(l.noProviderTitle, style: text.titleMedium),
              const SizedBox(height: IneedSpacing.s2),
              Text(l.noProviderBody),
              const SizedBox(height: IneedSpacing.s3),
              for (final s in r.suggestions)
                Padding(
                  padding: const EdgeInsets.only(bottom: IneedSpacing.s2),
                  child: switch (s) {
                    SearchSuggestion.widenRadius => IneedButton(
                        label: l.noProviderWiden,
                        variant: IneedButtonVariant.secondary,
                        icon: Icons.zoom_out_map,
                        onPressed: () {
                          setState(() => _radius = r.nextRadiusM);
                          _search(a!);
                        },
                      ),
                    SearchSuggestion.schedule => IneedButton(
                        label: l.noProviderSchedule,
                        variant: IneedButtonVariant.secondary,
                        icon: Icons.event,
                        onPressed: () {
                          setState(() {
                            _mode = RequestMode.scheduled;
                            _radius = null;
                          });
                          _search(a!);
                        },
                      ),
                    SearchSuggestion.changeSlot => IneedButton(label: l.noProviderChangeTime, variant: IneedButtonVariant.secondary, icon: Icons.schedule, onPressed: () => _changeSlot(a!)),
                  },
                ),
            ],
          ],
        ],
      ),
    );
  }
}

class _PriceInfo extends StatelessWidget {
  const _PriceInfo({required this.service});

  final Service service;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final s = service;
    final message = switch (s.pricingModel) {
      PricingModel.fixed when s.fixedPriceXof != null => l.serviceFixedPrice(formatXof(s.fixedPriceXof!)),
      _ when s.referenceMinXof != null && s.referenceMaxXof != null => l.serviceReferencePrice(formatXof(s.referenceMinXof!), formatXof(s.referenceMaxXof!)),
      _ => l.serviceQuoteInfo,
    };
    return Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: IneedBanner(message: message));
  }
}
