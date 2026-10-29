// Modèles de la mise en relation (offres) et des missions (contrat : docs/api/openapi.json).

import 'json.dart';
import 'marketplace.dart';
import 'money.dart';

/// Proposition de mission reçue par un professionnel (quartier et distance approximative seulement).
class ProOffer {
  const ProOffer({
    required this.id,
    required this.status,
    required this.requestId,
    required this.mode,
    required this.category,
    required this.description,
    required this.zoneName,
    required this.distanceM,
    required this.media,
    required this.sentAt,
    required this.expiresAt,
    this.service,
    this.etaMinutes,
    this.window,
    this.budgetXof,
    this.proposedStartAt,
    this.proposedPriceXof,
    this.missionId,
  });
  factory ProOffer.fromJson(Map<String, Object?> j) {
    final proposal = mapOrNull(j, 'proposal');
    return ProOffer(
      id: req<String>(j, 'id'),
      status: req<String>(j, 'status'),
      requestId: req<String>(j, 'requestId'),
      mode: RequestMode.parse(req<String>(j, 'mode')),
      category: CategoryRef.fromJson(req<Map<String, Object?>>(j, 'category')),
      service: mapOrNull(j, 'service') == null ? null : ServiceRef.fromJson(mapOrNull(j, 'service')!),
      description: req<String>(j, 'description'),
      zoneName: req<String>(j, 'zoneName'),
      distanceM: req<num>(j, 'distanceM').toInt(),
      etaMinutes: intOrNull(j, 'etaMinutes'),
      window: mapOrNull(j, 'window') == null ? null : TimeWindow.fromJson(mapOrNull(j, 'window')!),
      budgetXof: intOrNull(j, 'budgetXof'),
      media: listOf(j, 'media').map(RequestMedia.fromJson).toList(),
      sentAt: DateTime.parse(req<String>(j, 'sentAt')),
      expiresAt: DateTime.parse(req<String>(j, 'expiresAt')),
      proposedStartAt: proposal == null ? null : dateOrNull(proposal, 'proposedStartAt'),
      proposedPriceXof: proposal == null ? null : intOrNull(proposal, 'proposedPriceXof'),
      missionId: j['missionId'] as String?,
    );
  }
  final String id;

  /// SENT, SEEN, ACCEPTED, DECLINED, EXPIRED, WITHDRAWN, NOT_SELECTED, SELECTED.
  final String status;
  final String requestId;
  final RequestMode mode;
  final CategoryRef category;
  final ServiceRef? service;
  final String description;
  final String zoneName;
  final int distanceM;
  final int? etaMinutes;
  final TimeWindow? window;
  final int? budgetXof;
  final List<RequestMedia> media;
  final DateTime sentAt;
  final DateTime expiresAt;
  final DateTime? proposedStartAt;
  final int? proposedPriceXof;
  final String? missionId;

  bool get isOpen => status == 'SENT' || status == 'SEEN';
}

class OfferPro {
  const OfferPro({required this.id, required this.businessName, required this.verified, required this.ratingCount, required this.missionsCompleted, this.avatarUrl, this.ratingAvg});
  factory OfferPro.fromJson(Map<String, Object?> j) => OfferPro(
        id: req<String>(j, 'id'),
        businessName: req<String>(j, 'businessName'),
        avatarUrl: j['avatarUrl'] as String?,
        verified: j['verified'] == true,
        ratingAvg: (j['ratingAvg'] as num?)?.toDouble(),
        ratingCount: intOrNull(j, 'ratingCount') ?? 0,
        missionsCompleted: intOrNull(j, 'missionsCompleted') ?? 0,
      );
  final String id;
  final String businessName;
  final String? avatarUrl;
  final bool verified;
  final double? ratingAvg;
  final int ratingCount;
  final int missionsCompleted;
}

/// Proposition (ou acceptation) d'un professionnel, vue par le client.
class ClientOffer {
  const ClientOffer({required this.id, required this.status, required this.reserved, required this.distanceM, required this.pro, this.etaMinutes, this.proposedStartAt, this.proposedPriceXof, this.proposedTravelFeeXof, this.message});
  factory ClientOffer.fromJson(Map<String, Object?> j) => ClientOffer(
        id: req<String>(j, 'id'),
        status: req<String>(j, 'status'),
        reserved: j['reserved'] == true,
        distanceM: req<num>(j, 'distanceM').toInt(),
        etaMinutes: intOrNull(j, 'etaMinutes'),
        proposedStartAt: dateOrNull(j, 'proposedStartAt'),
        proposedPriceXof: intOrNull(j, 'proposedPriceXof'),
        proposedTravelFeeXof: intOrNull(j, 'proposedTravelFeeXof'),
        message: j['message'] as String?,
        pro: OfferPro.fromJson(req<Map<String, Object?>>(j, 'pro')),
      );
  final String id;
  final String status;
  final bool reserved;
  final int distanceM;
  final int? etaMinutes;
  final DateTime? proposedStartAt;
  final int? proposedPriceXof;
  final int? proposedTravelFeeXof;
  final String? message;
  final OfferPro pro;
}

class RequestOffers {
  const RequestOffers({required this.requestStatus, required this.offers, this.reservationExpiresAt});
  factory RequestOffers.fromJson(Map<String, Object?> j) => RequestOffers(
        requestStatus: req<String>(j, 'requestStatus'),
        reservationExpiresAt: dateOrNull(j, 'reservationExpiresAt'),
        offers: listOf(j, 'offers').map(ClientOffer.fromJson).toList(),
      );
  final String requestStatus;
  final DateTime? reservationExpiresAt;
  final List<ClientOffer> offers;

  ClientOffer? get reserved => offers.where((o) => o.reserved).firstOrNull;
}

class TimelineEvent {
  const TimelineEvent({required this.kind, required this.status, required this.at, required this.actor, this.reason});
  factory TimelineEvent.fromJson(Map<String, Object?> j) => TimelineEvent(
        kind: req<String>(j, 'kind'),
        status: req<String>(j, 'status'),
        at: DateTime.parse(req<String>(j, 'at')),
        actor: req<String>(j, 'actor'),
        reason: j['reason'] as String?,
      );

  /// REQUEST (demande) ou MISSION.
  final String kind;
  final String status;
  final DateTime at;
  final String actor;
  final String? reason;
}

class Tracking {
  const Tracking({required this.stale, this.position, this.recordedAt, this.distanceM, this.etaMinutes});
  factory Tracking.fromJson(Map<String, Object?> j) => Tracking(
        position: mapOrNull(j, 'position') == null ? null : LatLng.fromJson(mapOrNull(j, 'position')!),
        recordedAt: dateOrNull(j, 'recordedAt'),
        stale: j['stale'] == true,
        distanceM: intOrNull(j, 'distanceM'),
        etaMinutes: intOrNull(j, 'etaMinutes'),
      );
  final LatLng? position;
  final DateTime? recordedAt;
  final bool stale;
  final int? distanceM;
  final int? etaMinutes;
}

class MissionPlace {
  const MissionPlace({required this.cityName, this.zoneName, this.label, this.landmark, this.street, this.instructions, this.location});
  factory MissionPlace.fromJson(Map<String, Object?> j) => MissionPlace(
        cityName: req<String>(j, 'cityName'),
        zoneName: j['zoneName'] as String?,
        label: j['label'] as String?,
        landmark: j['landmark'] as String?,
        street: j['street'] as String?,
        instructions: j['instructions'] as String?,
        location: mapOrNull(j, 'location') == null ? null : LatLng.fromJson(mapOrNull(j, 'location')!),
      );
  final String cityName;
  final String? zoneName;
  final String? label;
  final String? landmark;
  final String? street;
  final String? instructions;

  /// Point précis : uniquement pour le professionnel retenu.
  final LatLng? location;
}

/// Mission vue par le client ou par le professionnel retenu (champs propres à chacun facultatifs).
class Mission {
  const Mission({
    required this.id,
    required this.reference,
    required this.status,
    required this.pricingModel,
    required this.category,
    required this.description,
    required this.proName,
    required this.place,
    required this.timeline,
    this.service,
    this.scheduledStartAt,
    this.autoCloseAt,
    this.cancelledBy,
    this.cancelReason,
    this.report,
    this.tracking,
    this.cancelTerms,
    this.clientFirstName,
    this.proAvatarUrl,
    this.money,
    this.requestId = '',
    this.proId = '',
  });
  factory Mission.fromJson(Map<String, Object?> j) {
    final request = req<Map<String, Object?>>(j, 'request');
    final pro = req<Map<String, Object?>>(j, 'pro');
    return Mission(
      id: req<String>(j, 'id'),
      reference: req<String>(j, 'reference'),
      status: req<String>(j, 'status'),
      pricingModel: PricingModel.parse(req<String>(j, 'pricingModel')),
      scheduledStartAt: dateOrNull(j, 'scheduledStartAt'),
      autoCloseAt: dateOrNull(j, 'autoCloseAt'),
      cancelledBy: j['cancelledBy'] as String?,
      cancelReason: j['cancelReason'] as String?,
      category: CategoryRef.fromJson(req<Map<String, Object?>>(request, 'category')),
      service: mapOrNull(request, 'service') == null ? null : ServiceRef.fromJson(mapOrNull(request, 'service')!),
      description: req<String>(request, 'description'),
      proName: req<String>(pro, 'businessName'),
      proAvatarUrl: pro['avatarUrl'] as String?,
      place: MissionPlace.fromJson(req<Map<String, Object?>>(j, 'place')),
      report: j['report'] as String?,
      tracking: mapOrNull(j, 'tracking') == null ? null : Tracking.fromJson(mapOrNull(j, 'tracking')!),
      cancelTerms: j['cancelTerms'] as String?,
      clientFirstName: mapOrNull(j, 'client')?['firstName'] as String?,
      timeline: listOf(j, 'timeline').map(TimelineEvent.fromJson).toList(),
      money: mapOrNull(j, 'money') == null ? null : MissionMoney.fromJson(mapOrNull(j, 'money')!),
      requestId: request['id'] as String? ?? '',
      proId: pro['id'] as String? ?? '',
    );
  }
  final String id;
  final String reference;
  final String status;
  final PricingModel pricingModel;
  final CategoryRef category;
  final ServiceRef? service;
  final String description;
  final String proName;
  final String? proAvatarUrl;
  final MissionPlace place;
  final List<TimelineEvent> timeline;
  final DateTime? scheduledStartAt;
  final DateTime? autoCloseAt;
  final String? cancelledBy;
  final String? cancelReason;
  final String? report;
  final Tracking? tracking;

  /// Client : FREE ou TRAVEL_FEE_DUE si l'annulation est possible maintenant ; null sinon.
  final String? cancelTerms;
  final String? clientFirstName;

  /// Devis, paiements, montant dû (absent des réponses antérieures à la phase 7).
  final MissionMoney? money;

  /// Demande d'origine et professionnel (ouverture de la conversation).
  final String requestId;
  final String proId;

  /// Étapes qui dépendent du devis et du paiement dans l'application (phase suivante).
  bool get waitsForQuoteOrPayment => const {'AWAITING_QUOTE', 'QUOTE_PENDING_APPROVAL', 'CONFIRMED', 'PAYMENT_PENDING'}.contains(status);
  bool get isActive => status != 'CLOSED' && status != 'CANCELLED';
}

class MissionSummary {
  const MissionSummary({required this.id, required this.reference, required this.status, required this.category, required this.proName, required this.createdAt, this.service, this.zoneName, this.scheduledStartAt});
  factory MissionSummary.fromJson(Map<String, Object?> j) => MissionSummary(
        id: req<String>(j, 'id'),
        reference: req<String>(j, 'reference'),
        status: req<String>(j, 'status'),
        category: CategoryRef.fromJson(req<Map<String, Object?>>(j, 'category')),
        service: mapOrNull(j, 'service') == null ? null : ServiceRef.fromJson(mapOrNull(j, 'service')!),
        zoneName: j['zoneName'] as String?,
        proName: req<String>(j, 'proName'),
        scheduledStartAt: dateOrNull(j, 'scheduledStartAt'),
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final String reference;
  final String status;
  final CategoryRef category;
  final ServiceRef? service;
  final String? zoneName;
  final String proName;
  final DateTime? scheduledStartAt;
  final DateTime createdAt;
}

/// Position du trajet, conservée sur le téléphone tant qu'elle n'a pas pu être envoyée.
class TripPoint {
  const TripPoint({required this.position, required this.recordedAt, this.accuracyM});
  final LatLng position;
  final DateTime recordedAt;
  final double? accuracyM;
  Map<String, Object?> toJson() => {...position.toJson(), 'accuracyM': ?accuracyM, 'recordedAt': recordedAt.toUtc().toIso8601String()};
}
