import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/testing.dart';

import 'helpers.dart';
import 'missions_flow_test.dart' show approvedPro, offerJson;

Map<String, Object?> conversationJson() => {
      'id': 'c1', 'requestId': 'r1', 'missionId': null, 'missionReference': null, 'subject': 'Fuite d’eau',
      'otherParty': {'name': 'Awa'}, 'canWrite': true, 'unread': 0, 'lastMessage': null, 'lastMessageAt': null,
    };

void main() {
  testWidgets('demande acceptée : le professionnel écrit au client (prénom seulement, sans numéro)', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/offers'] = (_) async => jsonResponse(200, [offerJson('ACCEPTED')]);
    backend.server.routes['GET /v1/pro/offers/o1'] = (_) async => jsonResponse(200, offerJson('ACCEPTED'));
    backend.server.routes['POST /v1/conversations'] = (_) async => jsonResponse(200, conversationJson());
    backend.server.routes['GET /v1/conversations/c1'] = (_) async => jsonResponse(200, conversationJson());
    final stored = <Map<String, Object?>>[];
    backend.server.routes['GET /v1/conversations/c1/messages'] = (_) async => jsonResponse(200, {'items': stored, 'hasMore': false});
    backend.server.routes['POST /v1/conversations/c1/read'] = (_) async => ResponseBody.fromString('', 204);
    backend.server.routes['POST /v1/conversations/c1/messages'] = (o) async {
      stored.add({'id': 'm1', 'clientMsgId': (o.data as Map)['clientMsgId'], 'fromMe': true, 'body': (o.data as Map)['body'], 'hidden': false, 'photoUrl': null, 'createdAt': '2026-10-29T10:00:00.000Z', 'read': false});
      return jsonResponse(201, {'message': stored.last, 'duplicate': false, 'warning': null});
    };
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.text('Fuite d’eau'));
    await tester.ensureVisible(find.text('Envoyer un message'));
    await tapAndSettle(tester, find.text('Envoyer un message'));
    expect(backend.server.last('POST /v1/conversations').data, {'requestId': 'r1'});
    expect(find.text('Awa'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Bonjour, j’arrive dans 15 min.');
    await tapAndSettle(tester, find.byTooltip('Envoyer'));
    final sent = backend.server.last('POST /v1/conversations/c1/messages').data as Map;
    expect(sent['body'], 'Bonjour, j’arrive dans 15 min.');
    expect(sent['clientMsgId'], matches(RegExp(r'^m[a-z0-9]{23}$')));
    expect(find.text('Bonjour, j’arrive dans 15 min.'), findsOneWidget);
    expect(find.textContaining('gardez les échanges'), findsNothing);
  });

  testWidgets('appareil enregistré pour les notifications push dès l’ouverture du tableau de bord', (tester) async {
    final backend = approvedPro();
    backend.server.routes['PUT /v1/me/devices'] = (_) async => ResponseBody.fromString('', 204);
    await pumpProApp(tester, backend, signedInStore(), pushToken: (token: 'fcm-token-pro-0123456789abcdef', platform: 'ANDROID'));
    expect(backend.server.last('PUT /v1/me/devices').data, {'pushToken': 'fcm-token-pro-0123456789abcdef', 'platform': 'ANDROID'});
  });

  testWidgets('sans projet Firebase configuré : aucun enregistrement d’appareil', (tester) async {
    final backend = approvedPro();
    await pumpProApp(tester, backend, signedInStore());
    expect(backend.server.count('PUT /v1/me/devices'), 0);
  });

  testWidgets('mes avis : avis en attente de vérification signalé ; réponse publique une fois', (tester) async {
    final backend = approvedPro();
    var replied = false;
    backend.server.routes['GET /v1/pro/reviews'] = (_) async => jsonResponse(200, [
          {'id': 'rv1', 'rating': 4, 'comment': 'Travail propre.', 'author': 'Awa K.', 'proReply': replied ? 'Merci !' : null, 'status': 'PUBLISHED', 'createdAt': '2026-10-29T11:00:00.000Z', 'missionReference': 'IN-2026-000042'},
          {'id': 'rv2', 'rating': 1, 'comment': 'Appelez le 07…', 'author': 'Yao K.', 'proReply': null, 'status': 'PENDING_MODERATION', 'createdAt': '2026-10-29T12:00:00.000Z', 'missionReference': 'IN-2026-000043'},
        ]);
    backend.server.routes['POST /v1/pro/reviews/rv1/reply'] = (_) async {
      replied = true;
      return jsonResponse(201, {'id': 'rv1', 'rating': 4, 'comment': 'Travail propre.', 'author': 'Awa K.', 'proReply': 'Merci !', 'createdAt': '2026-10-29T11:00:00.000Z'});
    };
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.byTooltip('Mon profil'));
    await tapAndSettle(tester, find.text('Mes avis'));
    expect(find.text('4 sur 5 · Awa K.'), findsOneWidget);
    expect(find.text('En attente de vérification par l’équipe Ineed'), findsOneWidget);
    expect(find.text('Répondre'), findsOneWidget);
    await tapAndSettle(tester, find.text('Répondre'));
    await tester.enterText(find.byType(TextField), 'Merci !');
    await tapAndSettle(tester, find.text('Envoyer'));
    expect(backend.server.last('POST /v1/pro/reviews/rv1/reply').data, {'reply': 'Merci !'});
    expect(find.text('Votre réponse : Merci !'), findsOneWidget);
    expect(find.text('Répondre'), findsNothing);
  });

  testWidgets('assistance : réclamation sans mission envoyée depuis le compte', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/complaints'] = (_) async => jsonResponse(200, <Object>[]);
    backend.server.routes['POST /v1/complaints'] = (_) async => jsonResponse(201, {
          'id': 'k1', 'reference': 'REC-2026-000002', 'category': 'PAYMENT', 'description': 'Je n’ai pas reçu mon reversement.', 'status': 'OPEN', 'resolution': null,
          'mission': null, 'createdAt': '2026-10-29T12:00:00.000Z', 'resolvedAt': null, 'messages': <Object>[],
        });
    backend.server.routes['GET /v1/complaints/k1'] = (_) async => jsonResponse(200, {
          'id': 'k1', 'reference': 'REC-2026-000002', 'category': 'PAYMENT', 'description': 'Je n’ai pas reçu mon reversement.', 'status': 'OPEN', 'resolution': null,
          'mission': null, 'createdAt': '2026-10-29T12:00:00.000Z', 'resolvedAt': null, 'messages': <Object>[],
        });
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.byTooltip('Mon profil'));
    await tapAndSettle(tester, find.text('Réclamations'));
    expect(find.textContaining('Aucune réclamation'), findsOneWidget);
    await tapAndSettle(tester, find.text('Contacter l’assistance'));
    await tapAndSettle(tester, find.text('Autre'));
    await tapAndSettle(tester, find.text('Problème de paiement').last);
    await tester.enterText(find.byType(TextField), 'Je n’ai pas reçu mon reversement.');
    await tapAndSettle(tester, find.text('Envoyer la réclamation'));
    expect(backend.server.last('POST /v1/complaints').data, {'category': 'PAYMENT', 'description': 'Je n’ai pas reçu mon reversement.'});
    expect(find.text('Réclamation REC-2026-000002'), findsOneWidget);
  });
}
