import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:test/test.dart';

class _Adapter implements HttpClientAdapter {
  _Adapter(this.handler);
  final Object Function(RequestOptions o) handler;
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) async {
    last = o;
    return ResponseBody.fromString(jsonEncode(handler(o)), 200, headers: {Headers.contentTypeHeader: ['application/json']});
  }

  @override
  void close({bool force = false}) {}
}

IneedApiClient _client(_Adapter a) => IneedApiClient(
      baseUrl: Uri.parse('http://api.test'),
      adapter: a,
      tokenStore: InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R'),
    );

void main() {
  test('recherche : paramètres envoyés (créneau en UTC) et pistes quand rien n’est trouvé', () async {
    final a = _Adapter((_) => {'mode': 'SCHEDULED', 'radiusM': 5000, 'maxRadiusM': 20000, 'zoneName': 'Cocody', 'items': <Object>[], 'suggestions': ['WIDEN_RADIUS', 'CHANGE_SLOT'], 'nextRadiusM': 10000});
    final r = await _client(a).searchPros(
      categoryId: 'c1',
      mode: RequestMode.scheduled,
      location: const LatLng(5.36, -3.97),
      window: TimeWindow(DateTime.utc(2026, 10, 29, 9), DateTime.utc(2026, 10, 29, 11)),
    );
    expect(a.last!.uri.path, '/v1/pros/search');
    expect(a.last!.queryParameters, {'categoryId': 'c1', 'mode': 'SCHEDULED', 'lat': 5.36, 'lng': -3.97, 'start': '2026-10-29T09:00:00.000Z', 'end': '2026-10-29T11:00:00.000Z'});
    expect(a.last!.headers['authorization'], 'Bearer A');
    expect(r.suggestions, [SearchSuggestion.widenRadius, SearchSuggestion.changeSlot]);
    expect(r.nextRadiusM, 10000);
  });

  test('carte de professionnel : distance et note facultatives', () {
    final card = ProCard.fromJson({
      'id': 'p1', 'businessName': 'Koffi Plomberie', 'avatarUrl': null, 'verified': true, 'distanceM': null, 'etaMinutes': null,
      'locationPrecision': 'ZONE', 'ratingAvg': null, 'ratingCount': 1, 'missionsCompleted': 0, 'indicativePriceXof': null, 'isOnline': true,
    });
    expect(card.distanceM, isNull);
    expect(card.ratingAvg, isNull);
    expect(card.locationPrecision, 'ZONE');
  });

  test('brouillon : champs vides omis, repère nettoyé', () {
    final d = RequestDraft(
      categoryId: 'c1',
      mode: RequestMode.urgent,
      description: '  L’eau fuit sous l’évier.  ',
      place: const PlaceInput(location: LatLng(5.36, -3.97), landmark: '  Portail vert ', street: ' '),
      photoFileIds: const ['f1'],
    );
    expect(d.toJson(), {
      'categoryId': 'c1',
      'mode': 'URGENT',
      'description': 'L’eau fuit sous l’évier.',
      'place': {'location': {'lat': 5.36, 'lng': -3.97}, 'landmark': 'Portail vert'},
      'photoFileIds': ['f1'],
    });
  });

  test('demande : lecture complète (lieu, créneau, médias, historique)', () {
    final r = ServiceRequest.fromJson({
      'id': 'r1', 'status': 'PUBLISHED', 'mode': 'SCHEDULED',
      'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'},
      'service': {'id': 's1', 'name': 'Fuite d’eau'},
      'pricingModel': 'QUOTE', 'description': 'Fuite sous l’évier.',
      'place': {'addressId': null, 'zoneId': 'z1', 'location': {'lat': 5.36, 'lng': -3.97}, 'label': null, 'street': null, 'landmark': 'Portail vert', 'instructions': null, 'zoneName': 'Cocody', 'cityName': 'Abidjan'},
      'window': {'start': '2026-10-29T09:00:00.000Z', 'end': '2026-10-29T11:00:00.000Z'},
      'budgetXof': 15000,
      'media': [{'fileId': 'f1', 'kind': 'PHOTO', 'mimeType': 'image/jpeg', 'url': 'http://s/f1'}],
      'history': [{'from': null, 'to': 'DRAFT', 'at': '2026-10-28T10:00:00.000Z', 'reason': null}, {'from': 'DRAFT', 'to': 'PUBLISHED', 'at': '2026-10-28T10:05:00.000Z', 'reason': null}],
      'createdAt': '2026-10-28T10:00:00.000Z', 'publishedAt': '2026-10-28T10:05:00.000Z', 'cancelledAt': null, 'cancelReason': null,
    });
    expect(r.mode, RequestMode.scheduled);
    expect(r.window!.start, DateTime.utc(2026, 10, 29, 9));
    expect(r.place.zoneName, 'Cocody');
    expect(r.history.last.to, 'PUBLISHED');
    expect(r.canCancel, isTrue);
    expect(r.isDraft, isFalse);
  });
}
