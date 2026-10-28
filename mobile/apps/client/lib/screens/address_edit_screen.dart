import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';
import 'package:latlong2/latlong.dart' as ll;

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../services/location.dart';
import '../widgets/place_map.dart';

/// C-08 : adresse d'intervention : repère placé sur la carte, commune, rue facultative, repère obligatoire.
/// Aucun service de géocodage externe : la commune est déduite par le serveur à partir du point.
class AddressEditScreen extends ConsumerStatefulWidget {
  const AddressEditScreen({required this.environment, this.address, super.key});

  final AppEnvironment environment;
  final Address? address;

  @override
  ConsumerState<AddressEditScreen> createState() => _AddressEditScreenState();
}

class _AddressEditScreenState extends ConsumerState<AddressEditScreen> {
  final _map = MapController();
  late LatLng _center;
  String? _zoneId;
  bool _zoneApproximate = false;
  bool _outside = false;
  bool _locating = false;
  bool _saving = false;
  String? _error;
  Timer? _debounce;
  late final TextEditingController _label;
  late final TextEditingController _street;
  late final TextEditingController _landmark;
  late final TextEditingController _instructions;

  @override
  void initState() {
    super.initState();
    final a = widget.address;
    _center = a?.location ?? abidjanCenter;
    _zoneId = a?.zoneId;
    _label = TextEditingController(text: a?.label);
    _street = TextEditingController(text: a?.street);
    _landmark = TextEditingController(text: a?.landmark);
    _instructions = TextEditingController(text: a?.instructions);
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _label.dispose();
    _street.dispose();
    _landmark.dispose();
    _instructions.dispose();
    super.dispose();
  }

  bool get _hasMap => widget.environment.mapTileUrl != null;

  void _onCenterChanged(LatLng p) {
    _center = p;
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 600), _locate);
  }

  Future<void> _locate() async {
    try {
      final located = await ref.read(apiProvider).locate(_center);
      if (!mounted) return;
      setState(() {
        _outside = !located.inServiceArea;
        if (located.zoneId != null) _zoneId = located.zoneId;
        _zoneApproximate = located.zoneApproximate;
      });
    } on Object {
      // La commune reste modifiable à la main ; le serveur revérifie à l'enregistrement.
    }
  }

  Future<void> _useMyLocation() async {
    final common = CommonLocalizations.of(context);
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      final p = await ref.read(positionFinderProvider)();
      _center = p;
      if (_hasMap) _map.move(ll.LatLng(p.lat, p.lng), 17);
      await _locate();
    } on LocationUnavailable {
      if (mounted) setState(() => _error = common.locationDenied);
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  void _onZoneChosen(String? id, List<Zone> zones) {
    setState(() {
      _zoneId = id;
      _zoneApproximate = false;
    });
    // Sans carte, le point retenu est le centre de la commune ; le repère précise l'endroit.
    final zone = zones.where((z) => z.id == id).firstOrNull;
    if (!_hasMap && zone?.centroid != null) _center = zone!.centroid!;
  }

  Future<void> _save() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    if (_landmark.text.trim().isEmpty && _street.text.trim().isEmpty) {
      setState(() => _error = l.addressLandmarkRequired);
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    final place = PlaceInput(location: _center, zoneId: _zoneId, label: _label.text, street: _street.text, landmark: _landmark.text, instructions: _instructions.text);
    try {
      final api = ref.read(apiProvider);
      final saved = widget.address == null ? await api.createAddress(place) : await api.updateAddress(widget.address!.id, place);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(common.addressSaved)));
      context.pop(saved);
    } on ServerFailure catch (e) {
      setState(() => _error = e.code == 'OUTSIDE_SERVICE_AREA' ? common.locationOutsideZone : failureMessage(common, e));
    } on Object catch (e) {
      setState(() => _error = failureMessage(common, e));
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final zones = ref.watch(zonesProvider).value ?? const <Zone>[];
    return Scaffold(
      appBar: AppBar(title: Text(l.addressEditTitle)),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          PlaceMap(tileUrl: widget.environment.mapTileUrl, center: _center, controller: _hasMap ? _map : null, onCenterChanged: _onCenterChanged),
          if (_hasMap) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(common.locationAdjustPin, style: TextStyle(color: c.textMuted))),
          const SizedBox(height: IneedSpacing.s2),
          OutlinedButton.icon(
            onPressed: _locating ? null : _useMyLocation,
            icon: _locating ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2)) : const Icon(Icons.my_location),
            label: Text(_locating ? common.locationSearching : common.locationUseCurrent),
          ),
          if (_outside) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: IneedBanner(message: common.locationOutsideZone, tone: IneedBannerTone.warning)),
          const SizedBox(height: IneedSpacing.s4),
          DropdownButtonFormField<String>(
            initialValue: zones.any((z) => z.id == _zoneId) ? _zoneId : null,
            key: ValueKey(_zoneId),
            decoration: InputDecoration(labelText: common.addressCommune, helperText: _zoneApproximate ? l.addressCommuneApproximate : null),
            items: [for (final z in zones) DropdownMenuItem(value: z.id, child: Text(z.name))],
            onChanged: (id) => _onZoneChosen(id, zones),
          ),
          const SizedBox(height: IneedSpacing.s3),
          TextField(controller: _landmark, maxLength: 200, decoration: InputDecoration(labelText: common.addressLandmark, hintText: common.addressLandmarkHint)),
          TextField(controller: _street, maxLength: 120, decoration: InputDecoration(labelText: common.addressStreet)),
          TextField(controller: _instructions, maxLength: 300, decoration: InputDecoration(labelText: common.addressInstructions, hintText: common.addressInstructionsHint)),
          TextField(controller: _label, maxLength: 40, decoration: InputDecoration(labelText: common.addressLabel, hintText: common.addressLabelHint)),
          if (_error != null) Padding(padding: const EdgeInsets.only(bottom: IneedSpacing.s3), child: Text(_error!, style: TextStyle(color: c.danger))),
          IneedButton(label: l.addressSave, loading: _saving, onPressed: _save),
        ],
      ),
    );
  }
}
