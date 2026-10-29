import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/testing.dart';

import 'helpers.dart';
import 'marketplace_flow_test.dart' show signedIn, tapAndSettle;
import 'marketplace_helpers.dart';

Map<String, Object?> requestJson(String status, {String mode = 'URGENT', String? missionId, Map<String, Object?>? window}) => {
      'id': 'r1', 'status': status, 'mode': mode,
      'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'},
      'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'pricingModel': 'QUOTE', 'description': 'L’eau fuit sous l’évier.',
      'place': {'addressId': 'a1', 'zoneId': 'z1', 'location': {'lat': 5.36, 'lng': -3.97}, 'label': 'Maison', 'street': null, 'landmark': 'Derrière la pharmacie', 'instructions': null, 'zoneName': 'Cocody', 'cityName': 'Abidjan'},
      'window': window, 'budgetXof': null, 'media': <Object>[],
      'history': [{'from': null, 'to': 'DRAFT', 'at': '2026-10-29T10:00:00.000Z', 'reason': null}],
      'createdAt': '2026-10-29T10:00:00.000Z', 'publishedAt': '2026-10-29T10:01:00.000Z', 'cancelledAt': null, 'cancelReason': null,
      'reservedProId': status == 'AWAITING_CLIENT_CONFIRMATION' ? 'p1' : null,
      'reservationExpiresAt': status == 'AWAITING_CLIENT_CONFIRMATION' ? DateTime.now().add(const Duration(minutes: 2)).toUtc().toIso8601String() : null,
      'searchRadiusM': 3000, 'missionId': missionId,
    };

Map<String, Object?> offerJson(String id, String name, {bool reserved = false, int? price, String? start}) => {
      'id': id, 'status': 'ACCEPTED', 'reserved': reserved, 'distanceM': 800, 'etaMinutes': 15, 'proposedStartAt': start,
      'proposedPriceXof': price, 'proposedTravelFeeXof': null, 'message': null,
      'pro': {'id': 'pro-$id', 'businessName': name, 'avatarUrl': null, 'verified': true, 'ratingAvg': null, 'ratingCount': 0, 'missionsCompleted': 3},
    };

Map<String, Object?> missionJson(String status, {Map<String, Object?>? tracking, String? cancelTerms = 'FREE'}) => {
      'id': 'm1', 'reference': 'IN-2026-000042', 'status': status, 'pricingModel': 'QUOTE', 'scheduledStartAt': null,
      'enRouteAt': null, 'arrivedAt': null, 'startedAt': null, 'workCompletedAt': null,
      'autoCloseAt': status == 'WORK_COMPLETED' ? '2026-10-31T10:00:00.000Z' : null, 'closedAt': null, 'cancelledAt': null, 'cancelledBy': null, 'cancelReason': null,
      'request': {'id': 'r1', 'mode': 'URGENT', 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'description': 'L’eau fuit.'},
      'pro': {'id': 'p1', 'businessName': 'Koffi Plomberie', 'avatarUrl': null},
      'report': status == 'WORK_COMPLETED' ? 'Joint remplacé.' : null,
      'timeline': [
        {'kind': 'REQUEST', 'status': 'ASSIGNED', 'at': '2026-10-29T10:02:00.000Z', 'actor': 'CLIENT', 'reason': null},
        {'kind': 'MISSION', 'status': status, 'at': '2026-10-29T10:03:00.000Z', 'actor': 'PRO', 'reason': null},
      ],
      'place': {'zoneName': 'Cocody', 'cityName': 'Abidjan', 'label': 'Maison', 'landmark': 'Derrière la pharmacie'},
      'tracking': tracking, 'cancelTerms': cancelTerms,
    };

/// Faux serveur dédié : une demande « r1 » dont l'état change au fil des actions du client.
FakeServer matchingServer({required Map<String, Object?> Function() request, Map<String, Object?> Function()? offers, Map<String, ResponseBody Function(RequestOptions)> extra = const {}}) {
  final b = ClientBackend();
  withHomeAddress(b);
  final server = b.server;
  server.routes['GET /v1/requests/r1'] = (_) async => jsonResponse(200, request());
  server.routes['GET /v1/requests/r1/offers'] = (_) async => jsonResponse(200, offers?.call() ?? {'requestStatus': 'MATCHING', 'reservationExpiresAt': null, 'offers': <Object>[]});
  server.routes['GET /v1/requests'] = (_) async => jsonResponse(200, [
        {'id': 'r1', 'status': request()['status'], 'mode': 'URGENT', 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': null, 'description': 'L’eau fuit.', 'zoneName': 'Cocody', 'createdAt': '2026-10-29T10:00:00.000Z', 'publishedAt': null},
      ]);
  server.routes['GET /v1/missions'] = (_) async => jsonResponse(200, [
        if (request()['missionId'] != null)
          {'id': 'm1', 'reference': 'IN-2026-000042', 'status': 'EN_ROUTE', 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'zoneName': 'Cocody', 'proName': 'Koffi Plomberie', 'scheduledStartAt': null, 'createdAt': '2026-10-29T10:00:00.000Z'},
      ]);
  for (final e in extra.entries) {
    server.routes[e.key] = (o) async => e.value(o);
  }
  return server;
}

void main() {
  testWidgets('T9 — professionnel réservé : le client confirme, la mission est créée et suivie', (tester) async {
    var status = 'AWAITING_CLIENT_CONFIRMATION';
    final server = matchingServer(
      request: () => requestJson(status, missionId: status == 'ASSIGNED' ? 'm1' : null),
      offers: () => {'requestStatus': status, 'reservationExpiresAt': null, 'offers': [offerJson('o1', 'Koffi Plomberie', reserved: true)]},
      extra: {
        'POST /v1/requests/r1/confirm': (_) {
          status = 'ASSIGNED';
          return jsonResponse(200, requestJson(status, missionId: 'm1'));
        },
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson('AWAITING_QUOTE')),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.text('L’eau fuit.'));
    expect(find.text('Koffi Plomberie a accepté votre demande'), findsOneWidget);
    expect(find.textContaining('Confirmez dans les'), findsOneWidget);
    expect(find.text('À 0,8 km'), findsOneWidget);
    await tapAndSettle(tester, find.text('Confirmer ce professionnel'));
    expect(server.count('POST /v1/requests/r1/confirm'), 1);
    await tapAndSettle(tester, find.text('Suivre la mission'));
    expect(find.text('Suivi de la mission'), findsOneWidget);
    expect(find.text('Mission IN-2026-000042'), findsOneWidget);
    expect(find.text('En attente de devis'), findsWidgets);
    // Honnêteté : devis et paiement arrivent à la phase suivante.
    expect(find.textContaining('Le devis et le paiement dans l’application arrivent dans la prochaine version'), findsOneWidget);
  });

  testWidgets('le client ne retient pas le professionnel réservé : recherche relancée', (tester) async {
    var status = 'AWAITING_CLIENT_CONFIRMATION';
    final server = matchingServer(
      request: () => requestJson(status),
      offers: () => {'requestStatus': status, 'reservationExpiresAt': null, 'offers': [offerJson('o1', 'Koffi Plomberie', reserved: true)]},
      extra: {
        'POST /v1/requests/r1/decline-reservation': (_) {
          status = 'MATCHING';
          return jsonResponse(200, requestJson(status));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.text('L’eau fuit.'));
    await tapAndSettle(tester, find.text('Chercher quelqu’un d’autre'));
    expect(server.count('POST /v1/requests/r1/decline-reservation'), 1);
    expect(find.text('Recherche en cours'), findsOneWidget);
    expect(find.text('Recherche dans un rayon de 3,0 km'), findsOneWidget);
  });

  testWidgets('programmé : propositions comparées, choix d’un professionnel', (tester) async {
    var status = 'OFFERS_RECEIVED';
    final window = {'start': '2026-10-30T09:00:00.000Z', 'end': '2026-10-30T12:00:00.000Z'};
    final server = matchingServer(
      request: () => requestJson(status, mode: 'SCHEDULED', window: window),
      offers: () => {
        'requestStatus': status,
        'reservationExpiresAt': null,
        'offers': [offerJson('o1', 'Awa Clim', price: 20000, start: '2026-10-30T09:00:00.000Z', reserved: status != 'OFFERS_RECEIVED'), offerJson('o2', 'Koffi Froid', price: 25000, start: '2026-10-30T10:00:00.000Z')],
      },
      extra: {
        'POST /v1/requests/r1/offers/o1/choose': (_) {
          status = 'AWAITING_CLIENT_CONFIRMATION';
          return jsonResponse(200, requestJson(status, mode: 'SCHEDULED', window: window));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.text('L’eau fuit.'));
    expect(find.text('Propositions reçues'), findsWidgets);
    expect(find.text('2 professionnels ont répondu'), findsOneWidget);
    expect(find.textContaining('20 000'), findsOneWidget);
    expect(find.text('Disponible : 09:00'), findsOneWidget);
    await tapAndSettle(tester, find.text('Choisir ce professionnel').first);
    expect(server.count('POST /v1/requests/r1/offers/o1/choose'), 1);
    expect(find.text('Awa Clim a accepté votre demande'), findsOneWidget);
  });

  testWidgets('T6 — aucun professionnel : relancer la recherche ou programmer', (tester) async {
    var status = 'NO_PROVIDER_FOUND';
    final server = matchingServer(
      request: () => requestJson(status),
      extra: {
        'POST /v1/requests/r1/retry': (_) {
          status = 'MATCHING';
          return jsonResponse(200, requestJson(status));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.text('L’eau fuit.'));
    expect(find.text('Aucun professionnel disponible pour le moment'), findsOneWidget);
    expect(find.text('Envoyer une demande programmée'), findsOneWidget);
    await tapAndSettle(tester, find.text('Relancer la recherche'));
    expect(server.last('POST /v1/requests/r1/retry').data, <String, Object?>{});
    expect(find.text('Recherche en cours'), findsOneWidget);
  });

  testWidgets('T20 — suivi du trajet : distance, délai, position trop ancienne signalée', (tester) async {
    var tracking = <String, Object?>{'position': {'lat': 5.37, 'lng': -3.97}, 'recordedAt': DateTime.now().toUtc().toIso8601String(), 'stale': false, 'distanceM': 1200, 'etaMinutes': 4};
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson('EN_ROUTE', tracking: tracking, cancelTerms: 'TRAVEL_FEE_DUE'))},
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('Koffi Plomberie est en route'), findsOneWidget);
    expect(find.text('À 1,2 km de chez vous'), findsOneWidget);
    expect(find.text('Arrivée estimée dans 4 min'), findsOneWidget);
    expect(find.textContaining('les frais de déplacement restent dus'), findsOneWidget);

    // Position non mise à jour : le serveur la signale, l'écran l'affiche au rafraîchissement suivant.
    tracking = {...tracking, 'stale': true};
    await tester.pump(const Duration(seconds: 6));
    await tester.pumpAndSettle();
    expect(find.textContaining('La position du professionnel n’est plus mise à jour'), findsOneWidget);
  });

  testWidgets('T21 — fin de prestation : le client confirme et la mission est clôturée', (tester) async {
    var status = 'WORK_COMPLETED';
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson(status, cancelTerms: null)),
        'POST /v1/missions/m1/confirm-completion': (_) {
          status = 'CLOSED';
          return jsonResponse(200, missionJson(status, cancelTerms: null));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('L’intervention est-elle terminée ?'), findsOneWidget);
    expect(find.text('« Joint remplacé. »'), findsOneWidget);
    expect(find.textContaining('clôturée automatiquement le 31/10/2026'), findsOneWidget);
    await tapAndSettle(tester, find.text('Oui, tout est en ordre'));
    expect(server.count('POST /v1/missions/m1/confirm-completion'), 1);
    expect(find.text('Mission clôturée. Merci d’avoir utilisé Ineed.'), findsWidgets);
  });

  testWidgets('T18 — annulation avant le départ : gratuite, après confirmation', (tester) async {
    var status = 'CONFIRMED';
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson(status, cancelTerms: status == 'CANCELLED' ? null : 'FREE')),
        'POST /v1/missions/m1/cancel': (_) {
          status = 'CANCELLED';
          return jsonResponse(200, missionJson(status, cancelTerms: null));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('L’annulation est gratuite tant que le professionnel n’est pas parti.'), findsOneWidget);
    await tapAndSettle(tester, find.text('Annuler l’intervention'));
    expect(find.text('Annuler l’intervention ?'), findsOneWidget);
    await tapAndSettle(tester, find.text('Annuler l’intervention').last);
    expect(server.count('POST /v1/missions/m1/cancel'), 1);
    expect(find.text('Mission annulée'), findsWidgets);
  });
}
