import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_pro/trip_tracker.dart';

import 'helpers.dart';

Map<String, Object?> offerJson(String status, {String mode = 'URGENT', String? missionId, int expiresInS = 55}) => {
      'id': 'o1', 'status': status, 'requestId': 'r1', 'mode': mode, 'pricingModel': 'QUOTE',
      'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'},
      'description': 'L’eau fuit sous l’évier.', 'zoneName': 'Cocody', 'distanceM': 1200, 'etaMinutes': 15,
      'window': mode == 'SCHEDULED' ? {'start': '2026-10-30T09:00:00.000Z', 'end': '2026-10-30T12:00:00.000Z'} : null,
      'budgetXof': 15000, 'media': <Object>[],
      'sentAt': DateTime.now().toUtc().toIso8601String(),
      'expiresAt': DateTime.now().add(Duration(seconds: expiresInS)).toUtc().toIso8601String(),
      'proposal': null, 'missionId': missionId,
    };

Map<String, Object?> missionJson(String status) => {
      'id': 'm1', 'reference': 'IN-2026-000042', 'status': status, 'pricingModel': 'QUOTE', 'scheduledStartAt': null,
      'autoCloseAt': null, 'cancelledBy': null, 'cancelReason': null,
      'request': {'id': 'r1', 'mode': 'URGENT', 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'description': 'L’eau fuit sous l’évier.'},
      'pro': {'id': 'p1', 'businessName': 'Koffi Plomberie', 'avatarUrl': null},
      'client': {'firstName': 'Awa'},
      'place': {'zoneName': 'Cocody', 'cityName': 'Abidjan', 'label': 'Maison', 'landmark': 'Derrière la pharmacie', 'street': null, 'instructions': 'Appeler en arrivant', 'location': {'lat': 5.36, 'lng': -3.97}},
      'media': <Object>[], 'report': null, 'timeline': <Object>[],
    };

ProBackend approvedPro() => ProBackend(avatarUrl: 'http://storage.test/a.jpg', proStatus: 'APPROVED', profile: filledProfile(online: true));

void main() {
  testWidgets('T7 — demande urgente reçue : quartier et distance seulement, acceptation, réservation', (tester) async {
    final backend = approvedPro();
    var status = 'SENT';
    backend.server.routes['GET /v1/pro/offers'] = (_) async => jsonResponse(200, [offerJson(status)]);
    backend.server.routes['GET /v1/pro/offers/o1'] = (_) async => jsonResponse(200, offerJson(status == 'SENT' ? 'SEEN' : status));
    backend.server.routes['POST /v1/pro/offers/o1/accept'] = (_) async {
      status = 'ACCEPTED';
      return jsonResponse(200, offerJson(status));
    };
    await pumpProApp(tester, backend, signedInStore());
    expect(find.text('Fuite d’eau'), findsOneWidget);
    expect(find.text('À environ 1,2 km · Cocody'), findsOneWidget);
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    expect(find.text('Demande urgente'), findsOneWidget);
    expect(find.textContaining('Répondez dans'), findsOneWidget);
    expect(find.text('L’adresse exacte vous sera communiquée après confirmation du client.'), findsOneWidget);
    await tapAndSettle(tester, find.text('Accepter'));
    expect(backend.server.count('POST /v1/pro/offers/o1/accept'), 1);
    expect(find.textContaining('Vous êtes réservé'), findsOneWidget);
  });

  testWidgets('T8 — un autre professionnel a été plus rapide : message clair', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/offers'] = (_) async => jsonResponse(200, [offerJson('SENT')]);
    backend.server.routes['GET /v1/pro/offers/o1'] = (_) async => jsonResponse(200, offerJson('SEEN'));
    backend.server.routes['POST /v1/pro/offers/o1/accept'] = (_) async => errorResponse(409, 'OFFER_TAKEN', 'Pris');
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    await tapAndSettle(tester, find.text('Accepter'));
    expect(find.text('Un autre professionnel a été plus rapide. Restez disponible pour la prochaine demande.'), findsOneWidget);
  });

  testWidgets('T11 — refus avec motif', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/offers'] = (_) async => jsonResponse(200, [offerJson('SENT')]);
    backend.server.routes['GET /v1/pro/offers/o1'] = (_) async => jsonResponse(200, offerJson('SEEN'));
    backend.server.routes['POST /v1/pro/offers/o1/decline'] = (_) async => jsonResponse(200, offerJson('DECLINED'));
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    await tapAndSettle(tester, find.text('Refuser'));
    await tapAndSettle(tester, find.text('Trop loin'));
    expect(backend.server.last('POST /v1/pro/offers/o1/decline').data, {'reason': 'Trop loin'});
    expect(find.text('Votre compte est validé'), findsOneWidget);
  });

  testWidgets('programmé : proposition d’horaire et de prix dans le créneau', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/offers'] = (_) async => jsonResponse(200, [offerJson('SENT', mode: 'SCHEDULED', expiresInS: 7200)]);
    backend.server.routes['GET /v1/pro/offers/o1'] = (_) async => jsonResponse(200, offerJson('SEEN', mode: 'SCHEDULED', expiresInS: 7200));
    backend.server.routes['POST /v1/pro/offers/o1/propose'] = (_) async => jsonResponse(200, offerJson('ACCEPTED', mode: 'SCHEDULED', expiresInS: 7200));
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    expect(find.text('Nouvelle demande'), findsOneWidget);
    await tapAndSettle(tester, find.text('Envoyer ma proposition'));
    expect(find.text('Choisissez une heure dans le créneau du client.'), findsOneWidget);
    expect(backend.server.count('POST /v1/pro/offers/o1/propose'), 0);
    await tapAndSettle(tester, find.text('Heure d’arrivée proposée'));
    await tapAndSettle(tester, find.text('OK'));
    await tester.enterText(find.widgetWithText(TextField, 'Votre prix'), '20000');
    await tapAndSettle(tester, find.text('Envoyer ma proposition'));
    final body = backend.server.last('POST /v1/pro/offers/o1/propose').data as Map;
    expect(body['proposedStartAt'], '2026-10-30T09:00:00.000Z');
    expect(body['proposedPriceXof'], 20000);
    expect(find.text('Proposition envoyée. Vous serez prévenu si le client vous choisit.'), findsOneWidget);
  });

  testWidgets('T20 — mission : adresse précise, départ, partage de position, arrivée', (tester) async {
    final backend = approvedPro();
    var status = 'PAYMENT_CONFIRMED';
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [
          {'id': 'm1', 'reference': 'IN-2026-000042', 'status': status, 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'zoneName': 'Cocody', 'proName': 'Koffi Plomberie', 'scheduledStartAt': null, 'createdAt': '2026-10-29T10:00:00.000Z'},
        ]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, missionJson(status));
    final sent = <Object?>[];
    backend.server.routes['POST /v1/pro/missions/m1/locations'] = (o) async {
      sent.add(o.data);
      return jsonResponse(200, {'accepted': 1, 'ignored': 0});
    };
    for (final (step, to) in [('depart', 'EN_ROUTE'), ('arrive', 'ARRIVED'), ('start', 'IN_PROGRESS')]) {
      backend.server.routes['POST /v1/pro/missions/m1/$step'] = (_) async {
        status = to;
        return jsonResponse(200, missionJson(status));
      };
    }
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('Paiement confirmé'));
    expect(find.text('Client : Awa'), findsOneWidget);
    expect(find.text('Derrière la pharmacie'), findsOneWidget);
    expect(find.text('Appeler en arrivant'), findsOneWidget);
    await tapAndSettle(tester, find.text('Je pars'));
    expect(find.text('Votre position est partagée avec le client jusqu’à votre arrivée.'), findsOneWidget);
    expect(sent, hasLength(1));
    expect(((sent.first! as Map)['points'] as List).single, containsPair('lat', 5.36));
    await tapAndSettle(tester, find.text('Je suis arrivé'));
    await tapAndSettle(tester, find.text('Commencer les travaux'));
    expect(find.text('Intervention en cours'), findsOneWidget);
    expect(find.text('Terminer l’intervention'), findsOneWidget);
  });

  testWidgets('mission en attente du devis : étape suivante expliquée, aucune action de trajet', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [
          {'id': 'm1', 'reference': 'IN-2026-000042', 'status': 'AWAITING_QUOTE', 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'}, 'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'zoneName': 'Cocody', 'proName': 'Koffi Plomberie', 'scheduledStartAt': null, 'createdAt': '2026-10-29T10:00:00.000Z'},
        ]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, missionJson('AWAITING_QUOTE'));
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('En attente de devis'));
    expect(find.textContaining('Envoyez votre devis'), findsOneWidget);
    expect(find.text('Rédiger le devis'), findsOneWidget);
    expect(find.text('Je pars'), findsNothing);
  });

  test('T26 — positions gardées pendant une coupure réseau puis renvoyées ensemble', () async {
    var down = true;
    final received = <List<Object?>>[];
    final server = FakeServer({
      'POST /v1/pro/missions/m1/locations': (o) async {
        if (down) throw DioException.connectionError(requestOptions: o, reason: 'réseau');
        received.add(((o.data as Map)['points'] as List).cast<Object?>());
        return jsonResponse(200, {'accepted': 2, 'ignored': 0});
      },
    });
    final api = IneedApiClient(baseUrl: Uri.parse('http://api.test'), adapter: server, tokenStore: signedInStore());
    var i = 0;
    final tracker = TripTracker(api: api, missionId: 'm1', position: () async => LatLng(5.36 + (i++) * 0.001, -3.97));
    await tracker.tick();
    expect(tracker.pending, 1);
    down = false;
    await tracker.tick();
    expect(tracker.pending, 0);
    expect(received.single, hasLength(2));
  });
}
