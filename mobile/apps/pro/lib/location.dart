import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:ineed_api/ineed_api.dart';

/// Position indisponible : localisation coupée, autorisation refusée ou délai dépassé.
class LocationUnavailable implements Exception {
  const LocationUnavailable();
}

typedef PositionFinder = Future<LatLng> Function();

/// Position actuelle ; l'autorisation n'est demandée que lorsque le professionnel se déclare disponible
/// ou choisit son point de départ.
final positionFinderProvider = Provider<PositionFinder>((ref) => () async {
      if (!await Geolocator.isLocationServiceEnabled()) throw const LocationUnavailable();
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied || permission == LocationPermission.deniedForever) throw const LocationUnavailable();
      try {
        final p = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)));
        return LatLng(p.latitude, p.longitude);
      } on Object {
        throw const LocationUnavailable();
      }
    });
