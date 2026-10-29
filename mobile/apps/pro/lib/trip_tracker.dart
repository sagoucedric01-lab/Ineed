import 'dart:async';

import 'package:ineed_api/ineed_api.dart';

import 'location.dart';

/// Partage de la position pendant le trajet. Les positions qui n'ont pas pu être envoyées (coupure réseau)
/// sont gardées et renvoyées avec les suivantes ; le serveur ignore les doublons.
class TripTracker {
  TripTracker({required this.api, required this.missionId, required this.position, this.interval = const Duration(seconds: 20), this.maxPending = 100});

  final IneedApiClient api;
  final String missionId;
  final PositionFinder position;
  final Duration interval;
  final int maxPending;
  final List<TripPoint> _pending = [];
  Timer? _timer;
  bool _busy = false;

  /// Positions en attente d'envoi.
  int get pending => _pending.length;

  /// false si la localisation est refusée ou indisponible.
  bool locationAvailable = true;

  void start() {
    _timer ??= Timer.periodic(interval, (_) => tick());
    unawaited(tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> tick() async {
    if (_busy) return;
    _busy = true;
    try {
      try {
        final p = await position();
        locationAvailable = true;
        _pending.add(TripPoint(position: p, recordedAt: DateTime.now()));
        if (_pending.length > maxPending) _pending.removeRange(0, _pending.length - maxPending);
      } on LocationUnavailable {
        locationAvailable = false;
      }
      if (_pending.isEmpty) return;
      final batch = List<TripPoint>.of(_pending);
      await api.sendTripPoints(missionId, batch);
      _pending.removeRange(0, batch.length);
    } on ApiFailure {
      // Réseau indisponible : nouvel essai au prochain intervalle avec les positions accumulées.
    } finally {
      _busy = false;
    }
  }
}
