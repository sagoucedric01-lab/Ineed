// Modèles des réponses de l'API (contrat : docs/api/openapi.json).

import 'json.dart';
import 'marketplace.dart';

T _req<T>(Map<String, Object?> j, String k) => req<T>(j, k);

List<Map<String, Object?>> _list(Map<String, Object?> j, String k) => listOf(j, k);

class OtpChallenge {
  const OtpChallenge({required this.challengeId, required this.expiresAt, required this.resendAvailableAt, required this.devMode});
  factory OtpChallenge.fromJson(Map<String, Object?> j) => OtpChallenge(
        challengeId: _req<String>(j, 'challengeId'),
        expiresAt: DateTime.parse(_req<String>(j, 'expiresAt')),
        resendAvailableAt: DateTime.parse(_req<String>(j, 'resendAvailableAt')),
        devMode: j['devMode'] == true,
      );
  final String challengeId;
  final DateTime expiresAt;
  final DateTime resendAvailableAt;

  /// Vrai si le serveur n'envoie pas de vrai SMS : l'application affiche le bandeau « Mode développement ».
  final bool devMode;
}

class LoginResult {
  const LoginResult({required this.userId, required this.isNewUser, required this.profileComplete});
  final String userId;
  final bool isNewUser;
  final bool profileComplete;
}

class Me {
  const Me({
    required this.id,
    required this.phone,
    required this.firstName,
    required this.lastName,
    required this.avatarUrl,
    required this.roles,
    required this.profileComplete,
    required this.proStatus,
  });
  factory Me.fromJson(Map<String, Object?> j) => Me(
        id: _req<String>(j, 'id'),
        phone: j['phone'] as String?,
        firstName: j['firstName'] as String?,
        lastName: j['lastName'] as String?,
        avatarUrl: j['avatarUrl'] as String?,
        roles: (j['roles'] as List<Object?>? ?? const []).whereType<String>().toList(),
        profileComplete: j['profileComplete'] == true,
        proStatus: j['proStatus'] as String?,
      );
  final String id;
  final String? phone;
  final String? firstName;
  final String? lastName;
  final String? avatarUrl;
  final List<String> roles;
  final bool profileComplete;
  final String? proStatus;
}

class DeviceSession {
  const DeviceSession({required this.id, required this.app, required this.deviceLabel, required this.lastUsedAt, required this.current});
  factory DeviceSession.fromJson(Map<String, Object?> j) => DeviceSession(
        id: _req<String>(j, 'id'),
        app: _req<String>(j, 'app'),
        deviceLabel: j['deviceLabel'] as String?,
        lastUsedAt: DateTime.parse(_req<String>(j, 'lastUsedAt')),
        current: j['current'] == true,
      );
  final String id;
  final String app;
  final String? deviceLabel;
  final DateTime lastUsedAt;
  final bool current;
}

class Skill {
  const Skill({required this.id, required this.name});
  factory Skill.fromJson(Map<String, Object?> j) => Skill(id: _req<String>(j, 'id'), name: _req<String>(j, 'name'));
  final String id;
  final String name;
}

class Category {
  const Category({required this.id, required this.slug, required this.name, required this.iconKey, required this.skills, this.description, this.services = const []});
  factory Category.fromJson(Map<String, Object?> j) => Category(
        id: _req<String>(j, 'id'),
        slug: _req<String>(j, 'slug'),
        name: _req<String>(j, 'name'),
        iconKey: _req<String>(j, 'iconKey'),
        description: j['description'] as String?,
        skills: _list(j, 'skills').map(Skill.fromJson).toList(),
        services: _list(j, 'services').map(Service.fromJson).toList(),
      );
  final String id;
  final String slug;
  final String name;
  final String iconKey;
  final String? description;
  final List<Skill> skills;

  /// Prestations (sous-catégories) proposées aux clients.
  final List<Service> services;
}

class Zone {
  const Zone({required this.id, required this.name, this.centroid});
  factory Zone.fromJson(Map<String, Object?> j) => Zone(
        id: _req<String>(j, 'id'),
        name: _req<String>(j, 'name'),
        centroid: j['centroid'] == null ? null : LatLng.fromJson(j['centroid']! as Map<String, Object?>),
      );
  final String id;
  final String name;

  /// Centre approximatif de la commune (pour centrer la carte).
  final LatLng? centroid;
}

class WeeklyHour {
  const WeeklyHour({required this.weekday, required this.start, required this.end});
  factory WeeklyHour.fromJson(Map<String, Object?> j) =>
      WeeklyHour(weekday: _req<int>(j, 'weekday'), start: _req<String>(j, 'start'), end: _req<String>(j, 'end'));
  final int weekday;
  final String start;
  final String end;
  Map<String, Object?> toJson() => {'weekday': weekday, 'start': start, 'end': end};
}

class ProDocument {
  const ProDocument({required this.id, required this.typeCode, required this.typeLabel, required this.status, required this.rejectionReason});
  factory ProDocument.fromJson(Map<String, Object?> j) => ProDocument(
        id: _req<String>(j, 'id'),
        typeCode: _req<String>(j, 'typeCode'),
        typeLabel: _req<String>(j, 'typeLabel'),
        status: _req<String>(j, 'status'),
        rejectionReason: j['rejectionReason'] as String?,
      );
  final String id;
  final String typeCode;
  final String typeLabel;
  final String status;
  final String? rejectionReason;
}

class DocumentType {
  const DocumentType({required this.code, required this.label, required this.requiredFor});
  factory DocumentType.fromJson(Map<String, Object?> j) => DocumentType(
        code: _req<String>(j, 'code'),
        label: _req<String>(j, 'label'),
        requiredFor: (j['requiredFor'] as List<Object?>? ?? const []).whereType<String>().toList(),
      );
  final String code;
  final String label;
  final List<String> requiredFor;
}

/// Dossier professionnel tel que renvoyé par GET /v1/pro/profile.
class ProProfile {
  const ProProfile({
    required this.kind,
    required this.businessName,
    required this.companyRegNumber,
    required this.bio,
    required this.yearsExperience,
    required this.categoryIds,
    required this.skillIds,
    required this.zoneIds,
    required this.weeklyHours,
    required this.documents,
    required this.verificationStatus,
    required this.lastDecisionNote,
    required this.isOnline,
    required this.missing,
    this.serviceRadiusM = 10000,
    this.baseLocation,
    required this.canSubmit,
  });
  factory ProProfile.fromJson(Map<String, Object?> j) => ProProfile(
        kind: _req<String>(j, 'kind'),
        businessName: _req<String>(j, 'businessName'),
        companyRegNumber: j['companyRegNumber'] as String?,
        bio: j['bio'] as String?,
        yearsExperience: j['yearsExperience'] as int?,
        categoryIds: _list(j, 'categories').map((c) => _req<String>(c, 'id')).toList(),
        skillIds: _list(j, 'skills').map((c) => _req<String>(c, 'id')).toList(),
        zoneIds: _list(j, 'zones').map((c) => _req<String>(c, 'id')).toList(),
        weeklyHours: _list(j, 'weeklyHours').map(WeeklyHour.fromJson).toList(),
        documents: _list(j, 'documents').map(ProDocument.fromJson).toList(),
        verificationStatus: _req<String>(j, 'verificationStatus'),
        lastDecisionNote: j['lastDecisionNote'] as String?,
        isOnline: j['isOnline'] == true,
        serviceRadiusM: (j['serviceRadiusM'] as num?)?.toInt() ?? 10000,
        baseLocation: j['baseLocation'] == null ? null : LatLng.fromJson(j['baseLocation']! as Map<String, Object?>),
        missing: (j['missing'] as List<Object?>? ?? const []).whereType<String>().toList(),
        canSubmit: j['canSubmit'] == true,
      );
  final String kind;
  final String businessName;
  final String? companyRegNumber;
  final String? bio;
  final int? yearsExperience;
  final List<String> categoryIds;
  final List<String> skillIds;
  final List<String> zoneIds;
  final List<WeeklyHour> weeklyHours;
  final List<ProDocument> documents;
  final String verificationStatus;
  final String? lastDecisionNote;
  final bool isOnline;
  final List<String> missing;

  /// Distance maximale acceptée (m) et point de départ habituel : réglages modifiables à tout moment.
  final int serviceRadiusM;
  final LatLng? baseLocation;
  final bool canSubmit;

  bool get isEditable => verificationStatus == 'DRAFT' || verificationStatus == 'INFO_REQUESTED';
}

/// Données envoyées par PUT /v1/pro/profile.
class ProProfileDraft {
  const ProProfileDraft({
    required this.kind,
    required this.businessName,
    required this.categoryIds,
    required this.zoneIds,
    required this.weeklyHours,
    this.companyRegNumber,
    this.bio,
    this.yearsExperience,
    this.skillIds = const [],
  });
  final String kind;
  final String businessName;
  final String? companyRegNumber;
  final String? bio;
  final int? yearsExperience;
  final List<String> categoryIds;
  final List<String> skillIds;
  final List<String> zoneIds;
  final List<WeeklyHour> weeklyHours;

  Map<String, Object?> toJson() => {
        'kind': kind,
        'businessName': businessName,
        if (companyRegNumber != null && companyRegNumber!.isNotEmpty) 'companyRegNumber': companyRegNumber,
        if (bio != null && bio!.isNotEmpty) 'bio': bio,
        'yearsExperience': ?yearsExperience,
        'categoryIds': categoryIds,
        'skillIds': skillIds,
        'zoneIds': zoneIds,
        'weeklyHours': [for (final h in weeklyHours) h.toJson()],
      };
}
