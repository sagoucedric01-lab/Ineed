import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:ineed_api/ineed_api.dart' as api;
import 'package:ineed_ui/ineed_ui.dart';
import 'package:latlong2/latlong.dart' as ll;

import '../l10n/gen/app_localizations.dart';

/// Carte avec un repère fixe au centre : le client déplace la carte pour placer le repère.
/// Sans fond de carte configuré ([tileUrl] nul), un encadré explique comment saisir l'adresse autrement.
class PlaceMap extends StatefulWidget {
  const PlaceMap({required this.tileUrl, required this.center, required this.onCenterChanged, this.controller, super.key});

  final String? tileUrl;
  final api.LatLng center;
  final ValueChanged<api.LatLng> onCenterChanged;
  final MapController? controller;

  @override
  State<PlaceMap> createState() => _PlaceMapState();
}

class _PlaceMapState extends State<PlaceMap> {
  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final tiles = widget.tileUrl;
    if (tiles == null) {
      return Container(
        height: 120,
        padding: const EdgeInsets.all(IneedSpacing.s4),
        decoration: BoxDecoration(color: c.surfaceMuted, borderRadius: BorderRadius.circular(IneedRadius.md)),
        alignment: Alignment.center,
        child: Text(l.addressMapUnavailable, textAlign: TextAlign.center, style: TextStyle(color: c.textMuted)),
      );
    }
    return ClipRRect(
      borderRadius: BorderRadius.circular(IneedRadius.md),
      child: SizedBox(
        height: 260,
        child: Stack(
          alignment: Alignment.center,
          children: [
            FlutterMap(
              mapController: widget.controller,
              options: MapOptions(
                initialCenter: ll.LatLng(widget.center.lat, widget.center.lng),
                initialZoom: 16,
                minZoom: 10,
                maxZoom: 19,
                interactionOptions: const InteractionOptions(flags: InteractiveFlag.all & ~InteractiveFlag.rotate),
                onPositionChanged: (camera, hasGesture) {
                  if (hasGesture) widget.onCenterChanged(api.LatLng(camera.center.latitude, camera.center.longitude));
                },
              ),
              children: [
                TileLayer(urlTemplate: tiles, userAgentPackageName: 'ci.ineed.app'),
                if (tiles.contains('openstreetmap.org'))
                  Align(
                    alignment: Alignment.bottomRight,
                    child: Container(
                      color: Colors.white70,
                      padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 2),
                      child: Text(l.mapAttributionOsm, style: const TextStyle(fontSize: 10, color: Colors.black87)),
                    ),
                  ),
              ],
            ),
            // Repère fixe : la pointe désigne le centre de la carte.
            IgnorePointer(
              child: Padding(
                padding: const EdgeInsets.only(bottom: 36),
                child: Icon(Icons.location_on, size: 44, color: c.urgent, semanticLabel: l.addressEditTitle),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
