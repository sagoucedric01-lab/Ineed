import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/testing.dart';

import 'helpers.dart';
import 'marketplace_flow_test.dart' show signedIn, tapAndSettle;
import 'matching_flow_test.dart' show matchingServer, missionJson, requestJson;

Map<String, Object?> conversationJson({bool canWrite = true, int unread = 0}) => {
      'id': 'c1', 'requestId': 'r1', 'missionId': 'm1', 'missionReference': 'IN-2026-000042', 'subject': 'Fuite d’eau',
      'otherParty': {'name': 'Koffi Plomberie'}, 'canWrite': canWrite, 'unread': unread, 'lastMessage': null, 'lastMessageAt': null,
    };

Map<String, Object?> messageJson(String id, String body, {bool fromMe = false, bool read = false}) => {
      'id': id, 'clientMsgId': 'cm-$id', 'fromMe': fromMe, 'body': body, 'hidden': false, 'photoUrl': null, 'createdAt': '2026-10-29T10:15:00.000Z', 'read': read,
    };

Future<void> scrollTo(WidgetTester tester, Finder f) async {
  await tester.scrollUntilVisible(f, 200, scrollable: find.byType(Scrollable).first);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('messagerie : ouverte depuis la mission ; message non envoyé après coupure renvoyé avec le même identifiant ; avertissement coordonnées ; temps réel', (tester) async {
    final messages = <Map<String, Object?>>[messageJson('1', 'Je serai là à 10 h.')];
    var sendCalls = 0;
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson('IN_PROGRESS', cancelTerms: null)),
        'POST /v1/conversations': (_) => jsonResponse(200, conversationJson()),
        'GET /v1/conversations/c1': (_) => jsonResponse(200, conversationJson()),
        'GET /v1/conversations/c1/messages': (_) => jsonResponse(200, {'items': messages, 'hasMore': false}),
        'POST /v1/conversations/c1/read': (_) => ResponseBody.fromString('', 204),
      },
    );
    server.routes['POST /v1/conversations/c1/messages'] = (o) async {
      sendCalls++;
      if (sendCalls == 1) throw DioException.connectionError(requestOptions: o, reason: 'réseau');
      final body = o.data as Map;
      messages.add(messageJson('2', body['body'] as String, fromMe: true));
      return jsonResponse(201, {'message': messages.last, 'duplicate': false, 'warning': 'CONTACT_SHARING'});
    };
    final channels = <FakeWebSocketChannel>[];
    await pumpClientApp(tester, server, signedIn(), tallScreen: true, realtime: channels);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    await scrollTo(tester, find.text('Envoyer un message'));
    await tapAndSettle(tester, find.text('Envoyer un message'));
    expect(server.last('POST /v1/conversations').data, {'requestId': 'r1', 'proId': 'p1'});
    expect(find.text('Je serai là à 10 h.'), findsOneWidget);
    expect(find.text('Vos numéros de téléphone ne sont jamais partagés.'), findsOneWidget);
    expect(server.count('POST /v1/conversations/c1/read'), 1);

    await tester.enterText(find.byType(TextField), 'Appelez-moi au 07 08 09 10 11');
    await tapAndSettle(tester, find.byTooltip('Envoyer'));
    expect(find.text('Non envoyé. Touchez pour réessayer.'), findsOneWidget);
    await tapAndSettle(tester, find.text('Non envoyé. Touchez pour réessayer.'));
    final ids = server.requests.where((r) => r.uri.path == '/v1/conversations/c1/messages' && r.method == 'POST').map((r) => (r.data as Map)['clientMsgId']).toList();
    expect(ids, hasLength(2));
    expect(ids[0], ids[1]);
    expect(find.textContaining('gardez les échanges et le paiement sur Ineed'), findsOneWidget);
    expect(find.text('Appelez-moi au 07 08 09 10 11'), findsOneWidget);

    // Le serveur pousse un nouveau message : la conversation se recharge sans attendre.
    messages.add(messageJson('3', 'Bien reçu, à tout de suite.'));
    channels.single.push({'type': 'message', 'conversationId': 'c1', 'message': messages.last});
    await tester.pumpAndSettle();
    expect(find.text('Bien reçu, à tout de suite.'), findsOneWidget);
    expect(server.count('POST /v1/conversations/c1/read'), 2);

    // Signalement d'un message reçu (appui long).
    server.routes['POST /v1/reports'] = (_) async => jsonResponse(201, {'id': 'rep1', 'status': 'OPEN', 'createdAt': '2026-10-29T10:20:00.000Z'});
    await tester.longPress(find.text('Je serai là à 10 h.'));
    await tester.pumpAndSettle();
    await tapAndSettle(tester, find.text('Arnaque'));
    expect(server.last('POST /v1/reports').data, {'targetType': 'MESSAGE', 'targetId': '1', 'reason': 'FRAUD'});
    expect(find.text('Merci. L’équipe Ineed va examiner ce signalement.'), findsOneWidget);
  });

  testWidgets('conversation terminée : lecture seule, pas de saisie', (tester) async {
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/notifications': (_) => jsonResponse(200, {'unread': 0, 'items': <Object>[]}),
        'GET /v1/conversations': (_) => jsonResponse(200, [conversationJson(canWrite: false, unread: 2)]),
        'GET /v1/conversations/unread': (_) => jsonResponse(200, {'unread': 2}),
        'GET /v1/conversations/c1': (_) => jsonResponse(200, conversationJson(canWrite: false)),
        'GET /v1/conversations/c1/messages': (_) => jsonResponse(200, {'items': [messageJson('1', 'Merci pour tout', fromMe: true, read: true)], 'hasMore': false}),
        'POST /v1/conversations/c1/read': (_) => ResponseBody.fromString('', 204),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.byTooltip('Messages'));
    expect(find.text('Koffi Plomberie'), findsOneWidget);
    expect(find.text('2'), findsOneWidget);
    await tapAndSettle(tester, find.text('Koffi Plomberie'));
    expect(find.textContaining('vous pouvez la relire mais plus y écrire'), findsOneWidget);
    expect(find.byType(TextField), findsNothing);
    expect(find.textContaining('Lu'), findsOneWidget);
  });

  testWidgets('T22 — évaluation après clôture : note obligatoire, envoi, avis affiché', (tester) async {
    var state = <String, Object?>{'canReview': true, 'review': null};
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson('CLOSED', cancelTerms: null)),
        'GET /v1/missions/m1/review': (_) => jsonResponse(200, state),
        'POST /v1/missions/m1/review': (o) {
          final review = {'id': 'rv1', 'rating': (o.data as Map)['rating'], 'comment': (o.data as Map)['comment'], 'status': 'PUBLISHED', 'proReply': null, 'createdAt': '2026-10-29T11:00:00.000Z'};
          state = {'canReview': false, 'review': review};
          return jsonResponse(201, review);
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    await scrollTo(tester, find.text('Donner mon avis'));
    await tapAndSettle(tester, find.text('Donner mon avis'));
    expect(find.text('Comment s’est passée l’intervention de Koffi Plomberie ?'), findsOneWidget);
    await tapAndSettle(tester, find.text('Publier mon avis'));
    expect(find.text('Choisissez une note de 1 à 5.'), findsOneWidget);
    expect(server.count('POST /v1/missions/m1/review'), 0);
    await tapAndSettle(tester, find.byTooltip('4 sur 5'));
    await tester.enterText(find.byType(TextField), 'Travail propre et rapide.');
    await tapAndSettle(tester, find.text('Publier mon avis'));
    expect(server.last('POST /v1/missions/m1/review').data, {'rating': 4, 'comment': 'Travail propre et rapide.'});
    expect(find.text('Merci pour votre avis.'), findsOneWidget);
    await scrollTo(tester, find.text('Votre avis : 4 sur 5'));
    expect(find.text('Donner mon avis'), findsNothing);
  });

  testWidgets('T23 — réclamation depuis la mission : description exigée, fil avec le support, réponse', (tester) async {
    Map<String, Object?> complaint(String status, List<Map<String, Object?>> messages) => {
          'id': 'k1', 'reference': 'REC-2026-000001', 'category': 'QUALITY', 'description': 'La fuite a repris le soir même.', 'status': status, 'resolution': null,
          'mission': {'id': 'm1', 'reference': 'IN-2026-000042', 'status': 'DISPUTED'}, 'createdAt': '2026-10-29T12:00:00.000Z', 'resolvedAt': null, 'messages': messages,
        };
    var thread = <Map<String, Object?>>[
      {'id': 'x1', 'fromSupport': true, 'author': 'Équipe Ineed', 'body': 'Pouvez-vous envoyer une photo ?', 'fileUrl': null, 'createdAt': '2026-10-29T12:30:00.000Z'},
    ];
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, missionJson('WORK_COMPLETED', cancelTerms: null)),
        'POST /v1/complaints': (_) => jsonResponse(201, complaint('OPEN', const [])),
        'GET /v1/complaints/k1': (_) => jsonResponse(200, complaint('WAITING_USER', thread)),
        'POST /v1/complaints/k1/messages': (o) {
          thread = [...thread, {'id': 'x2', 'fromSupport': false, 'author': null, 'body': (o.data as Map)['body'], 'fileUrl': null, 'createdAt': '2026-10-29T12:40:00.000Z'}];
          return jsonResponse(201, complaint('IN_REVIEW', thread));
        },
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    await scrollTo(tester, find.text('Faire une réclamation'));
    await tapAndSettle(tester, find.text('Faire une réclamation'));
    expect(find.text('Mission IN-2026-000042'), findsOneWidget);
    expect(find.textContaining('le professionnel n’est pas payé'), findsOneWidget);
    await tapAndSettle(tester, find.text('Envoyer la réclamation'));
    expect(find.text('Décrivez le problème en 10 caractères au moins.'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'La fuite a repris le soir même.');
    await tapAndSettle(tester, find.text('Envoyer la réclamation'));
    expect(server.last('POST /v1/complaints').data, {'category': 'QUALITY', 'description': 'La fuite a repris le soir même.', 'missionId': 'm1'});
    expect(find.text('Réclamation REC-2026-000001'), findsOneWidget);
    expect(find.text('Pouvez-vous envoyer une photo ?'.replaceAll(' ', ' ')), findsOneWidget);
    expect(find.textContaining('Réponse attendue de votre part'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Voici, l’eau coule encore.');
    await tapAndSettle(tester, find.text('Répondre'));
    expect(server.last('POST /v1/complaints/k1/messages').data, {'body': 'Voici, l’eau coule encore.'});
    expect(find.text('Voici, l’eau coule encore.'), findsOneWidget);
  });

  testWidgets('notification de nouveau message : un appui ouvre la conversation', (tester) async {
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/me/notifications': (_) => jsonResponse(200, {
              'unread': 1,
              'items': [
                {'id': 'n1', 'type': 'client.NEW_MESSAGE', 'title': 'Koffi Plomberie', 'body': 'J’arrive', 'data': {'conversationId': 'c1'}, 'read': false, 'createdAt': '2026-10-29T10:00:00.000Z'},
              ],
            }),
        'GET /v1/conversations/c1': (_) => jsonResponse(200, conversationJson()),
        'GET /v1/conversations/c1/messages': (_) => jsonResponse(200, {'items': [messageJson('1', 'J’arrive')], 'hasMore': false}),
        'POST /v1/conversations/c1/read': (_) => ResponseBody.fromString('', 204),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.byTooltip('Notifications'));
    await tapAndSettle(tester, find.text('Koffi Plomberie'));
    expect(find.byType(TextField), findsOneWidget);
    expect(find.text('Fuite d’eau'), findsOneWidget);
  });
}
