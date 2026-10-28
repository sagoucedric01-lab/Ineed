import 'package:flutter/material.dart';
import 'package:ineed_api/ineed_api.dart';

import '../l10n/gen/app_localizations.dart';

String _two(int v) => v.toString().padLeft(2, '0');

/// Heure d'Abidjan (UTC+0 toute l'année) : les créneaux sont construits et affichés en UTC.
String slotLabel(AppLocalizations l, TimeWindow w) {
  final s = w.start.toUtc();
  final e = w.end.toUtc();
  return l.requestSlotSummary('${_two(s.day)}/${_two(s.month)}/${s.year}', '${_two(s.hour)}:${_two(s.minute)}', '${_two(e.hour)}:${_two(e.minute)}');
}

/// Créneau proposé par défaut : demain matin, de 9 h à 12 h.
TimeWindow defaultSlot([DateTime? now]) {
  final n = (now ?? DateTime.now()).toUtc();
  final d = DateTime.utc(n.year, n.month, n.day).add(const Duration(days: 1));
  return TimeWindow(d.add(const Duration(hours: 9)), d.add(const Duration(hours: 12)));
}

/// Choix du jour, de l'heure de début et de fin. Retourne null si le client annule.
Future<TimeWindow?> pickSlot(BuildContext context, TimeWindow initial) async {
  final l = AppLocalizations.of(context);
  final start = initial.start.toUtc();
  final today = DateTime.now().toUtc();
  final day = await showDatePicker(
    context: context,
    initialDate: start,
    firstDate: DateTime.utc(today.year, today.month, today.day),
    lastDate: today.add(const Duration(days: 30)),
    helpText: l.requestSlotDay,
  );
  if (day == null || !context.mounted) return null;
  final from = await showTimePicker(context: context, initialTime: TimeOfDay(hour: start.hour, minute: start.minute), helpText: l.requestSlotStart);
  if (from == null || !context.mounted) return null;
  final end = initial.end.toUtc();
  final to = await showTimePicker(context: context, initialTime: TimeOfDay(hour: end.hour, minute: end.minute), helpText: l.requestSlotEnd);
  if (to == null) return null;
  final base = DateTime.utc(day.year, day.month, day.day);
  return TimeWindow(base.add(Duration(hours: from.hour, minutes: from.minute)), base.add(Duration(hours: to.hour, minutes: to.minute)));
}

/// Créneau valide : commence au moins une heure après maintenant, dure au moins une heure, sur une seule journée.
bool isValidSlot(TimeWindow w, [DateTime? now]) {
  final n = (now ?? DateTime.now()).toUtc();
  return w.start.isAfter(n.add(const Duration(minutes: 59))) && !w.end.isBefore(w.start.add(const Duration(hours: 1))) && w.end.difference(w.start).inHours <= 12;
}
