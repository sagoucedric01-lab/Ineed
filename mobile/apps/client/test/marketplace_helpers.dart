import 'dart:typed_data';

import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_client/services/location.dart';
import 'package:ineed_client/services/voice_recorder.dart';

import 'helpers.dart';

final jpegBytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46]);

final marketCategoriesJson = [
  {
    'id': 'c1', 'slug': 'plomberie', 'name': 'Plomberie', 'iconKey': 'plomberie', 'description': null, 'skills': <Object>[],
    'services': [
      {'id': 's1', 'slug': 'plomberie-fuite', 'name': 'Fuite d’eau', 'description': null, 'pricingModel': 'QUOTE', 'referenceMinXof': null, 'referenceMaxXof': null, 'fixedPriceXof': null},
      {'id': 's2', 'slug': 'plomberie-robinet', 'name': 'Remplacement de robinet', 'description': null, 'pricingModel': 'FIXED', 'referenceMinXof': null, 'referenceMaxXof': null, 'fixedPriceXof': 15000},
    ],
  },
  {'id': 'c2', 'slug': 'climatisation', 'name': 'Climatisation', 'iconKey': 'climatisation', 'description': null, 'skills': <Object>[], 'services': <Object>[]},
];

final zonesJson = [
  {'id': 'z1', 'name': 'Cocody', 'kind': 'COMMUNE', 'centroid': {'lat': 5.36, 'lng': -3.97}},
  {'id': 'z2', 'name': 'Marcory', 'kind': 'COMMUNE', 'centroid': {'lat': 5.3, 'lng': -3.9833}},
];

Map<String, Object?> proCardJson({String id = 'p1', String name = 'Koffi Plomberie', int? distance = 800, int? eta = 15}) => {
      'id': id, 'businessName': name, 'avatarUrl': null, 'verified': true, 'distanceM': distance, 'etaMinutes': eta,
      'locationPrecision': distance == null ? 'ZONE' : 'LIVE', 'ratingAvg': null, 'ratingCount': 0, 'missionsCompleted': 0,
      'indicativePriceXof': null, 'isOnline': true,
    };

/// Faux enregistreur : renvoie une note de 7 secondes.
class FakeRecorder implements VoiceRecorder {
  bool allowed = true;
  int started = 0;

  @override
  Future<bool> start() async {
    started++;
    return allowed;
  }

  @override
  Future<RecordedVoice?> stop() async => RecordedVoice(Uint8List.fromList(List.filled(64, 1)), 7);

  @override
  Future<void> cancel() async {}
}

/// Faux serveur Ineed côté client, avec un état : adresses, demandes, notifications.
class ClientBackend {
  final addresses = <Map<String, Object?>>[];
  final requests = <String, Map<String, Object?>>{};
  List<Map<String, Object?>> Function(RequestOptions o) searchItems = (_) => [proCardJson(), proCardJson(id: 'p2', name: 'Awa Services', distance: null, eta: null)];
  int unread = 2;
  var _files = 0;

  Map<String, Object?> _address(Map<String, Object?> body, String id) {
    final zoneId = body['zoneId'] as String? ?? 'z1';
    return {
      'id': id, 'label': body['label'], 'location': body['location'], 'cityId': 'abj', 'cityName': 'Abidjan', 'zoneId': zoneId,
      'zoneName': zonesJson.firstWhere((z) => z['id'] == zoneId)['name'], 'street': body['street'], 'landmark': body['landmark'], 'instructions': body['instructions'],
    };
  }

  Map<String, Object?> _request(String id, Map<String, Object?> body, {String status = 'DRAFT', List<Map<String, Object?>>? history}) {
    final address = addresses.firstWhere((a) => a['id'] == body['addressId'], orElse: () => addresses.first);
    return {
      'id': id, 'status': status, 'mode': body['mode'],
      'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'},
      'service': body['serviceId'] == null ? null : {'id': body['serviceId'], 'name': 'Fuite d’eau'},
      'pricingModel': 'QUOTE', 'description': body['description'],
      'place': {...address, 'addressId': address['id']},
      'window': body['window'], 'budgetXof': body['budgetXof'],
      'media': [
        for (final f in (body['photoFileIds'] as List? ?? const [])) {'fileId': f, 'kind': 'PHOTO', 'mimeType': 'image/jpeg', 'url': 'http://storage.test/$f'},
        if (body['voiceFileId'] != null) {'fileId': body['voiceFileId'], 'kind': 'VOICE', 'mimeType': 'audio/mp4', 'url': 'http://storage.test/v'},
      ],
      'history': history ?? [{'from': null, 'to': 'DRAFT', 'at': '2026-10-28T10:00:00.000Z', 'reason': null}],
      'createdAt': '2026-10-28T10:00:00.000Z', 'publishedAt': null, 'cancelledAt': null, 'cancelReason': null, '_body': body,
    };
  }

  Map<String, Object?> _public(Map<String, Object?> r) => {...r}..remove('_body');

  late final FakeServer server = FakeServer({
    'GET /v1/me': (_) async => jsonResponse(200, meJson(firstName: 'Awa', lastName: 'Koné')),
    'GET /v1/catalog/categories': (_) async => jsonResponse(200, marketCategoriesJson),
    'GET /v1/geo/zones': (_) async => jsonResponse(200, zonesJson),
    'GET /v1/geo/locate': (o) async => jsonResponse(200, {'inServiceArea': true, 'cityName': 'Abidjan', 'zoneId': 'z1', 'zoneName': 'Cocody', 'zoneApproximate': true}),
    'GET /v1/catalog/recent-searches': (_) async => jsonResponse(200, [{'query': 'fuite', 'categoryId': 'c1'}]),
    'GET /v1/catalog/search': (o) async => jsonResponse(200, {
          'categories': [{'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}],
          'services': [{'id': 's1', 'name': 'Fuite d’eau', 'categoryId': 'c1', 'categoryName': 'Plomberie', 'iconKey': 'plomberie'}],
        }),
    'GET /v1/me/addresses': (_) async => jsonResponse(200, addresses),
    'POST /v1/me/addresses': (o) async {
      final body = Map<String, Object?>.from(o.data as Map);
      if (body['landmark'] == null && body['street'] == null) return errorResponse(422, 'ADDRESS_INCOMPLETE', 'Repère manquant');
      final a = _address(body, 'a${addresses.length + 1}');
      addresses.insert(0, a);
      return jsonResponse(201, a);
    },
    'GET /v1/me/notifications': (_) async => jsonResponse(200, {
          'unread': unread,
          'items': [
            {'id': 'n1', 'type': 'client.welcome', 'title': 'Bienvenue sur Ineed', 'body': 'Votre compte est prêt.', 'data': <String, Object>{}, 'read': unread == 0, 'createdAt': '2026-10-28T10:00:00.000Z'},
          ],
        }),
    'POST /v1/me/notifications/read': (_) async {
      unread = 0;
      return ResponseBody.fromString('', 204);
    },
    'GET /v1/pros/search': (o) async {
      final items = searchItems(o);
      final radius = int.tryParse('${o.queryParameters['radiusM'] ?? ''}') ?? 3000;
      return jsonResponse(200, {
        'mode': o.queryParameters['mode'], 'radiusM': radius, 'maxRadiusM': 15000, 'zoneName': 'Cocody', 'items': items,
        'suggestions': items.isEmpty ? [if (radius < 15000) 'WIDEN_RADIUS', o.queryParameters['mode'] == 'URGENT' ? 'SCHEDULE' : 'CHANGE_SLOT'] : <String>[],
        'nextRadiusM': items.isEmpty && radius < 15000 ? radius + 3000 : null,
      });
    },
    'GET /v1/pros/p1': (_) async => jsonResponse(200, {
          'id': 'p1', 'businessName': 'Koffi Plomberie', 'avatarUrl': null, 'verified': true, 'verifiedAt': '2026-10-01T10:00:00.000Z', 'kind': 'INDIVIDUAL',
          'bio': 'Plombier depuis 12 ans.', 'yearsExperience': 12, 'categories': [{'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}],
          'skills': [{'id': 'k1', 'name': 'Recherche de fuite'}], 'zones': [{'id': 'z1', 'name': 'Cocody'}],
          'weeklyHours': [{'weekday': 1, 'start': '08:00', 'end': '18:00'}], 'ratingAvg': null, 'ratingCount': 0, 'missionsCompleted': 0,
          'indicativePriceXof': null, 'isOnline': true, 'reviews': <Object>[],
        }),
    'POST /v1/files': (o) async {
      _files++;
      return jsonResponse(201, {'fileId': 'f$_files', 'uploadUrl': 'http://storage.test/upload/f$_files', 'method': 'PUT', 'headers': {'content-type': (o.data as Map)['mimeType']}, 'expiresAt': '2026-10-28T11:00:00.000Z'});
    },
    'PUT /upload/f1': (_) async => ResponseBody.fromString('', 200),
    'PUT /upload/f2': (_) async => ResponseBody.fromString('', 200),
    'PUT /upload/f3': (_) async => ResponseBody.fromString('', 200),
    'POST /v1/files/f1/complete': (_) async => jsonResponse(200, {'id': 'f1', 'status': 'READY'}),
    'POST /v1/files/f2/complete': (_) async => jsonResponse(200, {'id': 'f2', 'status': 'READY'}),
    'POST /v1/files/f3/complete': (_) async => jsonResponse(200, {'id': 'f3', 'status': 'READY'}),
    'GET /v1/requests': (o) async => jsonResponse(200, [
          for (final r in requests.values)
            if ((o.queryParameters['scope'] == 'history') == (r['status'] == 'CANCELLED'))
              {'id': r['id'], 'status': r['status'], 'mode': r['mode'], 'category': r['category'], 'service': r['service'], 'description': r['description'], 'zoneName': 'Cocody', 'createdAt': r['createdAt'], 'publishedAt': null},
        ]),
    'POST /v1/requests': (o) async {
      final r = _request('r${requests.length + 1}', Map<String, Object?>.from(o.data as Map));
      requests[r['id']! as String] = r;
      server.routes['GET /v1/requests/${r['id']}'] = (_) async => jsonResponse(200, _public(requests[r['id']]!));
      server.routes['POST /v1/requests/${r['id']}/publish'] = (_) async {
        final cur = requests[r['id']]!;
        requests[r['id']! as String] = _request(r['id']! as String, cur['_body']! as Map<String, Object?>, status: 'PUBLISHED', history: [
          {'from': null, 'to': 'DRAFT', 'at': '2026-10-28T10:00:00.000Z', 'reason': null},
          {'from': 'DRAFT', 'to': 'PUBLISHED', 'at': '2026-10-28T10:05:00.000Z', 'reason': null},
        ]);
        return jsonResponse(200, _public(requests[r['id']]!));
      };
      server.routes['POST /v1/requests/${r['id']}/cancel'] = (_) async {
        final cur = requests[r['id']]!;
        requests[r['id']! as String] = {...cur, 'status': 'CANCELLED'};
        return jsonResponse(200, _public(requests[r['id']]!));
      };
      return jsonResponse(201, _public(r));
    },
  });
}

/// Adresse « Maison » à Cocody déjà enregistrée.
void withHomeAddress(ClientBackend b) {
  b.addresses.add({
    'id': 'a1', 'label': 'Maison', 'location': {'lat': 5.36, 'lng': -3.97}, 'cityId': 'abj', 'cityName': 'Abidjan', 'zoneId': 'z1', 'zoneName': 'Cocody',
    'street': null, 'landmark': 'Derrière la pharmacie', 'instructions': null,
  });
}

/// Position du téléphone simulée.
Future<LatLng> fakePosition() async => const LatLng(5.355, -3.975);

Future<LatLng> deniedPosition() async => throw const LocationUnavailable();
