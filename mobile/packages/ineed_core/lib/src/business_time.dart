/// Dates : le serveur envoie de l'UTC (ISO 8601). Abidjan est en UTC+0 toute l'année (pas d'heure d'été),
/// l'heure affichée pour Abidjan est donc l'heure UTC. D'autres villes nécessiteront le paquet `timezone`.
String _two(int v) => v.toString().padLeft(2, '0');

/// « 28/10/2026 à 10:23 » à l'heure d'Abidjan, identique au backend (`formatDateTime`).
String formatAbidjanDateTime(DateTime instant) {
  final t = instant.toUtc();
  return '${_two(t.day)}/${_two(t.month)}/${t.year} à ${_two(t.hour)}:${_two(t.minute)}';
}

/// « 10:23 » à l'heure d'Abidjan.
String formatAbidjanTime(DateTime instant) {
  final t = instant.toUtc();
  return '${_two(t.hour)}:${_two(t.minute)}';
}
