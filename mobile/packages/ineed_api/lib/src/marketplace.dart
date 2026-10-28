// Modèles du catalogue, des adresses, de la recherche et des demandes (contrat : docs/api/openapi.json).

import 'json.dart';

class LatLng {
  const LatLng(this.lat, this.lng);
  factory LatLng.fromJson(Map<String, Object?> j) => LatLng((req<num>(j, 'lat')).toDouble(), (req<num>(j, 'lng')).toDouble());
  final double lat;
  final double lng;
  Map<String, Object?> toJson() => {'lat': lat, 'lng': lng};

  @override
  bool operator ==(Object other) => other is LatLng && other.lat == lat && other.lng == lng;
  @override
  int get hashCode => Object.hash(lat, lng);
}

/// Modèle de prix d'une prestation.
enum PricingModel {
  fixed('FIXED'),
  quote('QUOTE'),
  travelPlusDiagnosis('TRAVEL_PLUS_DIAGNOSIS');

  const PricingModel(this.code);
  final String code;
  static PricingModel parse(String code) => values.firstWhere((v) => v.code == code, orElse: () => PricingModel.quote);
}

/// Prestation (sous-catégorie) d'un métier. Montants en F CFA, entiers.
class Service {
  const Service({required this.id, required this.slug, required this.name, required this.pricingModel, this.description, this.referenceMinXof, this.referenceMaxXof, this.fixedPriceXof});
  factory Service.fromJson(Map<String, Object?> j) => Service(
        id: req<String>(j, 'id'),
        slug: req<String>(j, 'slug'),
        name: req<String>(j, 'name'),
        description: j['description'] as String?,
        pricingModel: PricingModel.parse(req<String>(j, 'pricingModel')),
        referenceMinXof: intOrNull(j, 'referenceMinXof'),
        referenceMaxXof: intOrNull(j, 'referenceMaxXof'),
        fixedPriceXof: intOrNull(j, 'fixedPriceXof'),
      );
  final String id;
  final String slug;
  final String name;
  final String? description;
  final PricingModel pricingModel;
  final int? referenceMinXof;
  final int? referenceMaxXof;
  final int? fixedPriceXof;
}

class CategoryRef {
  const CategoryRef({required this.id, required this.name, required this.iconKey});
  factory CategoryRef.fromJson(Map<String, Object?> j) => CategoryRef(id: req<String>(j, 'id'), name: req<String>(j, 'name'), iconKey: req<String>(j, 'iconKey'));
  final String id;
  final String name;
  final String iconKey;
}

class ServiceHit {
  const ServiceHit({required this.id, required this.name, required this.categoryId, required this.categoryName, required this.iconKey});
  factory ServiceHit.fromJson(Map<String, Object?> j) => ServiceHit(
        id: req<String>(j, 'id'),
        name: req<String>(j, 'name'),
        categoryId: req<String>(j, 'categoryId'),
        categoryName: req<String>(j, 'categoryName'),
        iconKey: req<String>(j, 'iconKey'),
      );
  final String id;
  final String name;
  final String categoryId;
  final String categoryName;
  final String iconKey;
}

class CatalogSearchResult {
  const CatalogSearchResult({required this.categories, required this.services});
  factory CatalogSearchResult.fromJson(Map<String, Object?> j) => CatalogSearchResult(
        categories: listOf(j, 'categories').map(CategoryRef.fromJson).toList(),
        services: listOf(j, 'services').map(ServiceHit.fromJson).toList(),
      );
  final List<CategoryRef> categories;
  final List<ServiceHit> services;
  bool get isEmpty => categories.isEmpty && services.isEmpty;
}

class RecentSearch {
  const RecentSearch({required this.query, this.categoryId});
  factory RecentSearch.fromJson(Map<String, Object?> j) => RecentSearch(query: req<String>(j, 'query'), categoryId: j['categoryId'] as String?);
  final String query;
  final String? categoryId;
}

/// Ville et commune d'un point choisi sur la carte.
class Located {
  const Located({required this.inServiceArea, this.cityName, this.zoneId, this.zoneName, this.zoneApproximate = false});
  factory Located.fromJson(Map<String, Object?> j) => Located(
        inServiceArea: j['inServiceArea'] == true,
        cityName: j['cityName'] as String?,
        zoneId: j['zoneId'] as String?,
        zoneName: j['zoneName'] as String?,
        zoneApproximate: j['zoneApproximate'] == true,
      );
  final bool inServiceArea;
  final String? cityName;
  final String? zoneId;
  final String? zoneName;
  final bool zoneApproximate;
}

/// Lieu d'intervention saisi par le client (point sur la carte, commune, repère).
class PlaceInput {
  const PlaceInput({required this.location, this.zoneId, this.label, this.street, this.landmark, this.instructions});
  final LatLng location;
  final String? zoneId;
  final String? label;
  final String? street;
  final String? landmark;
  final String? instructions;

  static String? _clean(String? s) => s == null || s.trim().isEmpty ? null : s.trim();

  Map<String, Object?> toJson() => {
        'location': location.toJson(),
        'zoneId': ?zoneId,
        'label': ?_clean(label),
        'street': ?_clean(street),
        'landmark': ?_clean(landmark),
        'instructions': ?_clean(instructions),
      };
}

class Address {
  const Address({required this.id, required this.location, required this.cityName, this.label, this.zoneId, this.zoneName, this.street, this.landmark, this.instructions});
  factory Address.fromJson(Map<String, Object?> j) => Address(
        id: req<String>(j, 'id'),
        label: j['label'] as String?,
        location: LatLng.fromJson(req<Map<String, Object?>>(j, 'location')),
        cityName: req<String>(j, 'cityName'),
        zoneId: j['zoneId'] as String?,
        zoneName: j['zoneName'] as String?,
        street: j['street'] as String?,
        landmark: j['landmark'] as String?,
        instructions: j['instructions'] as String?,
      );
  final String id;
  final String? label;
  final LatLng location;
  final String cityName;
  final String? zoneId;
  final String? zoneName;
  final String? street;
  final String? landmark;
  final String? instructions;

  /// Résumé affiché : « Maison · Cocody » ou le repère.
  String get title => label ?? landmark ?? street ?? zoneName ?? cityName;
}

enum RequestMode {
  urgent('URGENT'),
  scheduled('SCHEDULED');

  const RequestMode(this.code);
  final String code;
  static RequestMode parse(String code) => code == 'SCHEDULED' ? scheduled : urgent;
}

class TimeWindow {
  const TimeWindow(this.start, this.end);
  factory TimeWindow.fromJson(Map<String, Object?> j) => TimeWindow(DateTime.parse(req<String>(j, 'start')), DateTime.parse(req<String>(j, 'end')));
  final DateTime start;
  final DateTime end;
  Map<String, Object?> toJson() => {'start': start.toUtc().toIso8601String(), 'end': end.toUtc().toIso8601String()};
}

/// Piste proposée quand aucun professionnel n'est trouvé.
enum SearchSuggestion { widenRadius, schedule, changeSlot }

class ProCard {
  const ProCard({
    required this.id,
    required this.businessName,
    required this.verified,
    required this.locationPrecision,
    required this.ratingCount,
    required this.missionsCompleted,
    required this.isOnline,
    this.avatarUrl,
    this.distanceM,
    this.etaMinutes,
    this.ratingAvg,
    this.indicativePriceXof,
  });
  factory ProCard.fromJson(Map<String, Object?> j) => ProCard(
        id: req<String>(j, 'id'),
        businessName: req<String>(j, 'businessName'),
        avatarUrl: j['avatarUrl'] as String?,
        verified: j['verified'] == true,
        distanceM: intOrNull(j, 'distanceM'),
        etaMinutes: intOrNull(j, 'etaMinutes'),
        locationPrecision: req<String>(j, 'locationPrecision'),
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble(),
        ratingCount: intOrNull(j, 'ratingCount') ?? 0,
        missionsCompleted: intOrNull(j, 'missionsCompleted') ?? 0,
        indicativePriceXof: intOrNull(j, 'indicativePriceXof'),
        isOnline: j['isOnline'] == true,
      );
  final String id;
  final String businessName;
  final String? avatarUrl;
  final bool verified;
  final int? distanceM;
  final int? etaMinutes;

  /// LIVE : position du moment ; BASE : point de départ habituel ; ZONE : intervient dans la commune.
  final String locationPrecision;
  final double? ratingAvg;
  final int ratingCount;
  final int missionsCompleted;
  final int? indicativePriceXof;
  final bool isOnline;
}

class ProSearchResult {
  const ProSearchResult({required this.radiusM, required this.maxRadiusM, required this.items, required this.suggestions, this.zoneName, this.nextRadiusM});
  factory ProSearchResult.fromJson(Map<String, Object?> j) => ProSearchResult(
        radiusM: req<num>(j, 'radiusM').toInt(),
        maxRadiusM: req<num>(j, 'maxRadiusM').toInt(),
        zoneName: j['zoneName'] as String?,
        items: listOf(j, 'items').map(ProCard.fromJson).toList(),
        suggestions: (j['suggestions'] as List<Object?>? ?? const [])
            .map((s) => switch (s) {
                  'WIDEN_RADIUS' => SearchSuggestion.widenRadius,
                  'SCHEDULE' => SearchSuggestion.schedule,
                  'CHANGE_SLOT' => SearchSuggestion.changeSlot,
                  _ => null,
                })
            .whereType<SearchSuggestion>()
            .toList(),
        nextRadiusM: intOrNull(j, 'nextRadiusM'),
      );
  final int radiusM;
  final int maxRadiusM;
  final String? zoneName;
  final List<ProCard> items;
  final List<SearchSuggestion> suggestions;
  final int? nextRadiusM;
}

class PublicWeeklyHour {
  const PublicWeeklyHour({required this.weekday, required this.start, required this.end});
  factory PublicWeeklyHour.fromJson(Map<String, Object?> j) => PublicWeeklyHour(weekday: req<num>(j, 'weekday').toInt(), start: req<String>(j, 'start'), end: req<String>(j, 'end'));
  final int weekday;
  final String start;
  final String end;
}

class PublicProProfile {
  const PublicProProfile({
    required this.id,
    required this.businessName,
    required this.verified,
    required this.categories,
    required this.skills,
    required this.zones,
    required this.weeklyHours,
    required this.ratingCount,
    required this.missionsCompleted,
    required this.isOnline,
    this.avatarUrl,
    this.bio,
    this.yearsExperience,
    this.ratingAvg,
    this.indicativePriceXof,
  });
  factory PublicProProfile.fromJson(Map<String, Object?> j) => PublicProProfile(
        id: req<String>(j, 'id'),
        businessName: req<String>(j, 'businessName'),
        avatarUrl: j['avatarUrl'] as String?,
        verified: j['verified'] == true,
        bio: j['bio'] as String?,
        yearsExperience: intOrNull(j, 'yearsExperience'),
        categories: listOf(j, 'categories').map(CategoryRef.fromJson).toList(),
        skills: listOf(j, 'skills').map((s) => req<String>(s, 'name')).toList(),
        zones: listOf(j, 'zones').map((z) => req<String>(z, 'name')).toList(),
        weeklyHours: listOf(j, 'weeklyHours').map(PublicWeeklyHour.fromJson).toList(),
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble(),
        ratingCount: intOrNull(j, 'ratingCount') ?? 0,
        missionsCompleted: intOrNull(j, 'missionsCompleted') ?? 0,
        indicativePriceXof: intOrNull(j, 'indicativePriceXof'),
        isOnline: j['isOnline'] == true,
      );
  final String id;
  final String businessName;
  final String? avatarUrl;
  final bool verified;
  final String? bio;
  final int? yearsExperience;
  final List<CategoryRef> categories;
  final List<String> skills;
  final List<String> zones;
  final List<PublicWeeklyHour> weeklyHours;
  final double? ratingAvg;
  final int ratingCount;
  final int missionsCompleted;
  final int? indicativePriceXof;
  final bool isOnline;
}

/// Contenu d'un brouillon de demande.
class RequestDraft {
  const RequestDraft({
    required this.categoryId,
    required this.mode,
    required this.description,
    this.serviceId,
    this.addressId,
    this.place,
    this.window,
    this.budgetXof,
    this.photoFileIds = const [],
    this.voiceFileId,
  });
  final String categoryId;
  final String? serviceId;
  final RequestMode mode;
  final String description;
  final String? addressId;
  final PlaceInput? place;
  final TimeWindow? window;
  final int? budgetXof;
  final List<String> photoFileIds;
  final String? voiceFileId;

  Map<String, Object?> toJson() => {
        'categoryId': categoryId,
        'serviceId': ?serviceId,
        'mode': mode.code,
        'description': description.trim(),
        'addressId': ?addressId,
        'place': ?place?.toJson(),
        'window': ?window?.toJson(),
        'budgetXof': ?budgetXof,
        'photoFileIds': photoFileIds,
        'voiceFileId': ?voiceFileId,
      };
}

class RequestPlace {
  const RequestPlace({required this.location, required this.cityName, this.addressId, this.zoneId, this.label, this.street, this.landmark, this.instructions, this.zoneName});
  factory RequestPlace.fromJson(Map<String, Object?> j) => RequestPlace(
        addressId: j['addressId'] as String?,
        zoneId: j['zoneId'] as String?,
        location: LatLng.fromJson(req<Map<String, Object?>>(j, 'location')),
        label: j['label'] as String?,
        street: j['street'] as String?,
        landmark: j['landmark'] as String?,
        instructions: j['instructions'] as String?,
        zoneName: j['zoneName'] as String?,
        cityName: req<String>(j, 'cityName'),
      );
  final String? addressId;
  final String? zoneId;
  final LatLng location;
  final String? label;
  final String? street;
  final String? landmark;
  final String? instructions;
  final String? zoneName;
  final String cityName;
}

class RequestMedia {
  const RequestMedia({required this.fileId, required this.kind, required this.mimeType, required this.url});
  factory RequestMedia.fromJson(Map<String, Object?> j) =>
      RequestMedia(fileId: req<String>(j, 'fileId'), kind: req<String>(j, 'kind'), mimeType: req<String>(j, 'mimeType'), url: req<String>(j, 'url'));
  final String fileId;

  /// PHOTO ou VOICE.
  final String kind;
  final String mimeType;
  final String url;
}

class RequestStatusChange {
  const RequestStatusChange({required this.to, required this.at, this.from, this.reason});
  factory RequestStatusChange.fromJson(Map<String, Object?> j) =>
      RequestStatusChange(from: j['from'] as String?, to: req<String>(j, 'to'), at: DateTime.parse(req<String>(j, 'at')), reason: j['reason'] as String?);
  final String? from;
  final String to;
  final DateTime at;
  final String? reason;
}

class ServiceRef {
  const ServiceRef({required this.id, required this.name});
  factory ServiceRef.fromJson(Map<String, Object?> j) => ServiceRef(id: req<String>(j, 'id'), name: req<String>(j, 'name'));
  final String id;
  final String name;
}

class ServiceRequest {
  const ServiceRequest({
    required this.id,
    required this.status,
    required this.mode,
    required this.category,
    required this.pricingModel,
    required this.description,
    required this.place,
    required this.media,
    required this.history,
    required this.createdAt,
    this.service,
    this.window,
    this.budgetXof,
    this.publishedAt,
    this.cancelledAt,
    this.cancelReason,
  });
  factory ServiceRequest.fromJson(Map<String, Object?> j) => ServiceRequest(
        id: req<String>(j, 'id'),
        status: req<String>(j, 'status'),
        mode: RequestMode.parse(req<String>(j, 'mode')),
        category: CategoryRef.fromJson(req<Map<String, Object?>>(j, 'category')),
        service: mapOrNull(j, 'service') == null ? null : ServiceRef.fromJson(mapOrNull(j, 'service')!),
        pricingModel: PricingModel.parse(req<String>(j, 'pricingModel')),
        description: req<String>(j, 'description'),
        place: RequestPlace.fromJson(req<Map<String, Object?>>(j, 'place')),
        window: mapOrNull(j, 'window') == null ? null : TimeWindow.fromJson(mapOrNull(j, 'window')!),
        budgetXof: intOrNull(j, 'budgetXof'),
        media: listOf(j, 'media').map(RequestMedia.fromJson).toList(),
        history: listOf(j, 'history').map(RequestStatusChange.fromJson).toList(),
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
        publishedAt: dateOrNull(j, 'publishedAt'),
        cancelledAt: dateOrNull(j, 'cancelledAt'),
        cancelReason: j['cancelReason'] as String?,
      );
  final String id;
  final String status;
  final RequestMode mode;
  final CategoryRef category;
  final ServiceRef? service;
  final PricingModel pricingModel;
  final String description;
  final RequestPlace place;
  final TimeWindow? window;
  final int? budgetXof;
  final List<RequestMedia> media;
  final List<RequestStatusChange> history;
  final DateTime createdAt;
  final DateTime? publishedAt;
  final DateTime? cancelledAt;
  final String? cancelReason;

  bool get isDraft => status == 'DRAFT';
  bool get canCancel => const {'DRAFT', 'PUBLISHED', 'MATCHING', 'OFFERS_RECEIVED', 'NO_PROVIDER_FOUND'}.contains(status);
}

class RequestSummary {
  const RequestSummary({required this.id, required this.status, required this.mode, required this.category, required this.description, required this.createdAt, this.service, this.zoneName});
  factory RequestSummary.fromJson(Map<String, Object?> j) => RequestSummary(
        id: req<String>(j, 'id'),
        status: req<String>(j, 'status'),
        mode: RequestMode.parse(req<String>(j, 'mode')),
        category: CategoryRef.fromJson(req<Map<String, Object?>>(j, 'category')),
        service: mapOrNull(j, 'service') == null ? null : ServiceRef.fromJson(mapOrNull(j, 'service')!),
        description: req<String>(j, 'description'),
        zoneName: j['zoneName'] as String?,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final String status;
  final RequestMode mode;
  final CategoryRef category;
  final ServiceRef? service;
  final String description;
  final String? zoneName;
  final DateTime createdAt;
}

class AppNotification {
  const AppNotification({required this.id, required this.type, required this.title, required this.body, required this.read, required this.createdAt});
  factory AppNotification.fromJson(Map<String, Object?> j) => AppNotification(
        id: req<String>(j, 'id'),
        type: req<String>(j, 'type'),
        title: req<String>(j, 'title'),
        body: req<String>(j, 'body'),
        read: j['read'] == true,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final String type;
  final String title;
  final String body;
  final bool read;
  final DateTime createdAt;
}

class NotificationsPage {
  const NotificationsPage({required this.unread, required this.items});
  factory NotificationsPage.fromJson(Map<String, Object?> j) =>
      NotificationsPage(unread: intOrNull(j, 'unread') ?? 0, items: listOf(j, 'items').map(AppNotification.fromJson).toList());
  final int unread;
  final List<AppNotification> items;
}
