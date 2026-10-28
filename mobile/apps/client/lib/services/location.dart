import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:ineed_api/ineed_api.dart';

/// Position indisponible : service de localisation coupé, autorisation refusée ou délai dépassé.
class LocationUnavailable implements Exception {
  const LocationUnavailable();
}

/// Position actuelle du téléphone. L'autorisation n'est demandée qu'au moment où le client le choisit.
typedef PositionFinder = Future<LatLng> Function();

final positionFinderProvider = Provider<PositionFinder>((ref) => () async {
      if (!await Geolocator.isLocationServiceEnabled()) throw const LocationUnavailable();
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) throw const LocationUnavailable();
      try {
        final p = await Geolocator.getCurrentPosition(
          locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
        );
        return LatLng(p.latitude, p.longitude);
      } on Object {
        throw const LocationUnavailable();
      }
    });

/// Centre d'Abidjan (Plateau), point de départ de la carte quand aucune position n'est connue.
const abidjanCenter = LatLng(5.3236, -4.0197);
