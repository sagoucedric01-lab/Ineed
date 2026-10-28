// Lecture stricte des réponses JSON (bibliothèque interne, non exportée).

T req<T>(Map<String, Object?> j, String k) {
  final v = j[k];
  if (v is! T) throw FormatException('Champ « $k » manquant ou invalide');
  return v;
}

List<Map<String, Object?>> listOf(Map<String, Object?> j, String k) => (j[k] as List<Object?>? ?? const []).cast<Map<String, Object?>>();

Map<String, Object?>? mapOrNull(Map<String, Object?> j, String k) => j[k] as Map<String, Object?>?;

DateTime? dateOrNull(Map<String, Object?> j, String k) => j[k] == null ? null : DateTime.parse(j[k]! as String);

int? intOrNull(Map<String, Object?> j, String k) => (j[k] as num?)?.toInt();
