import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../location.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

/// Intervalle d'envoi de la position tant que le professionnel est disponible et l'écran ouvert.
const locationRefreshInterval = Duration(minutes: 5);

/// P-10 : tableau de bord d'un professionnel validé : disponibilité, position du moment, zone d'intervention.
/// Les demandes reçues arrivent en phase 6 (mise en relation).
class DashboardScreen extends ConsumerStatefulWidget {
  const DashboardScreen({super.key});

  @override
  ConsumerState<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends ConsumerState<DashboardScreen> {
  bool _saving = false;
  bool _locationDenied = false;
  double? _radiusKm;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  /// Envoie la position du moment ; refusée ou indisponible, le professionnel reste proposé autour de son
  /// point de départ et dans ses communes.
  Future<void> _sendLocation() async {
    try {
      final p = await ref.read(positionFinderProvider)();
      await ref.read(apiProvider).updateProLocation(p);
      if (mounted) setState(() => _locationDenied = false);
    } on LocationUnavailable {
      if (mounted) setState(() => _locationDenied = true);
    } on Object {
      // Échec réseau ponctuel : nouvel essai au prochain intervalle.
    }
  }

  void _syncTimer(bool online) {
    if (online && _timer == null) {
      _timer = Timer.periodic(locationRefreshInterval, (_) => _sendLocation());
    } else if (!online) {
      _timer?.cancel();
      _timer = null;
    }
  }

  Future<void> _setOnline(bool on) async {
    final messenger = ScaffoldMessenger.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _saving = true);
    try {
      await ref.read(apiProvider).setAvailability(isOnline: on);
      if (on) await _sendLocation();
      _syncTimer(on);
      ref.invalidate(proProfileProvider);
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  Future<void> _saveArea({LatLng? base, int? radiusM}) async {
    final messenger = ScaffoldMessenger.of(context);
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    try {
      await ref.read(apiProvider).setServiceArea(baseLocation: base, serviceRadiusM: radiusM);
      ref.invalidate(proProfileProvider);
      messenger.showSnackBar(SnackBar(content: Text(base != null ? l.serviceAreaBaseSet : l.serviceAreaSaved)));
    } on ServerFailure catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(e.code == 'LOCATION_OUTSIDE_CITY' ? l.serviceAreaOutside : failureMessage(common, e))));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    }
  }

  Future<void> _useCurrentAsBase() async {
    try {
      final p = await ref.read(positionFinderProvider)();
      await _saveArea(base: p);
    } on LocationUnavailable {
      if (mounted) setState(() => _locationDenied = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(
        title: Text(CommonLocalizations.of(context).appNamePro),
        actions: [IconButton(tooltip: CommonLocalizations.of(context).profileTitle, icon: const Icon(Icons.person_outline), onPressed: () => context.push('/compte'))],
      ),
      body: AsyncBody(
        value: ref.watch(proProfileProvider),
        onRetry: () => ref.invalidate(proProfileProvider),
        builder: (p) {
          final online = p?.isOnline ?? false;
          // Disponible à l'ouverture de l'écran : la position est envoyée puis rafraîchie régulièrement.
          if (online && _timer == null) {
            _syncTimer(true);
            WidgetsBinding.instance.addPostFrameCallback((_) => _sendLocation());
          }
          final radiusKm = _radiusKm ?? (p?.serviceRadiusM ?? 10000) / 1000;
          return ListView(
            padding: const EdgeInsets.all(IneedSpacing.s4),
            children: [
              Text(l.dashboardApprovedTitle, style: text.titleLarge),
              const SizedBox(height: IneedSpacing.s4),
              Card(
                color: online ? c.successSoft : null,
                child: SwitchListTile(
                  value: online,
                  onChanged: _saving || p == null ? null : _setOnline,
                  title: Text(l.dashboardAvailable),
                  subtitle: Text(online ? l.dashboardAvailableOn : l.dashboardAvailableOff),
                ),
              ),
              if (online) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(l.dashboardLocationShared, style: text.bodySmall?.copyWith(color: c.textMuted))),
              if (_locationDenied) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: IneedBanner(message: l.locationDeniedPro, tone: IneedBannerTone.warning)),
              const SizedBox(height: IneedSpacing.s6),
              Text(l.serviceAreaTitle, style: text.titleMedium),
              Text(l.serviceAreaHelp, style: text.bodySmall?.copyWith(color: c.textMuted)),
              const SizedBox(height: IneedSpacing.s2),
              if (p?.baseLocation == null) Text(l.serviceAreaNoBase),
              OutlinedButton.icon(onPressed: p == null ? null : _useCurrentAsBase, icon: const Icon(Icons.my_location), label: Text(l.serviceAreaUseLocation)),
              const SizedBox(height: IneedSpacing.s3),
              Text(l.serviceAreaRadius(radiusKm.round())),
              Slider(
                value: radiusKm.clamp(1, 50).toDouble(),
                min: 1,
                max: 50,
                divisions: 49,
                label: '${radiusKm.round()} km',
                onChanged: p == null ? null : (v) => setState(() => _radiusKm = v),
                onChangeEnd: (v) => _saveArea(radiusM: v.round() * 1000),
              ),
              const SizedBox(height: IneedSpacing.s6),
              Text(l.dashboardIncoming, style: text.titleMedium),
              const SizedBox(height: IneedSpacing.s2),
              Text(l.dashboardIncomingEmpty, style: text.bodyMedium?.copyWith(color: c.textMuted)),
            ],
          );
        },
      ),
    );
  }
}
