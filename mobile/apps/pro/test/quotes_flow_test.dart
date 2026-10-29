import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_core/ineed_core.dart';

import 'helpers.dart';
import 'missions_flow_test.dart' show approvedPro, missionJson;

Map<String, Object?> summary(String status) => {
      'id': 'm1', 'reference': 'IN-2026-000042', 'status': status, 'category': {'id': 'c1', 'name': 'Plomberie', 'iconKey': 'plomberie'},
      'service': {'id': 's1', 'name': 'Fuite d’eau'}, 'zoneName': 'Cocody', 'proName': 'Koffi Plomberie', 'scheduledStartAt': null, 'createdAt': '2026-10-29T10:00:00.000Z',
    };

Map<String, Object?> quoteJson(String status, {int version = 1, String kind = 'INITIAL', String? reason}) => {
      'id': 'q$version', 'version': version, 'kind': kind, 'status': status, 'totalXof': 15000, 'validUntil': '2026-10-31T10:00:00.000Z', 'open': status == 'SUBMITTED',
      'conditions': null, 'estimatedDurationMin': null, 'rejectionReason': reason, 'lines': <Object>[],
    };

Map<String, Object?> withMoney(String status, {List<Map<String, Object?>> quotes = const [], Map<String, Object?>? due, int paid = 0, bool sandbox = true}) => {
      ...missionJson(status),
      'money': {
        'quotes': quotes, 'due': due, 'paidXof': paid, 'refundedXof': 0, 'commissionXof': paid > 0 ? 1300 : 0, 'netXof': paid > 0 ? paid - 1300 : 0,
        'payments': [if (paid > 0) {'id': 'p1', 'purpose': 'FULL', 'amountXof': paid, 'status': 'SUCCEEDED', 'isSandbox': sandbox, 'receiptAvailable': true, 'refunds': <Object>[]}],
      },
    };

void main() {
  final amount = formatXof(15000);

  testWidgets('T12 — le professionnel rédige son devis : total calculé, montant non payable refusé, envoi avec clé d’idempotence', (tester) async {
    final backend = approvedPro();
    var mission = withMoney('AWAITING_QUOTE');
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [summary(mission['status']! as String)]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, mission);
    backend.server.routes['POST /v1/pro/missions/m1/quotes'] = (_) async {
      mission = withMoney('QUOTE_PENDING_APPROVAL', quotes: [quoteJson('SUBMITTED')]);
      return jsonResponse(201, quoteJson('SUBMITTED'));
    };
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('En attente de devis'));
    await tapAndSettle(tester, find.text('Rédiger le devis'));
    expect(find.text('Devis'), findsOneWidget);
    final prices = find.widgetWithText(TextField, 'Prix unitaire (F CFA)');
    await tester.enterText(prices.at(0), '2000');
    await tester.enterText(prices.at(1), '13002');
    await tester.pumpAndSettle();
    expect(find.text('Total : ${formatXof(15002)}'), findsOneWidget);
    await tester.ensureVisible(find.text('Envoyer le devis'));
    await tapAndSettle(tester, find.text('Envoyer le devis'));
    expect(find.textContaining('multiple de 5'), findsOneWidget);
    expect(backend.server.count('POST /v1/pro/missions/m1/quotes'), 0);

    await tester.enterText(prices.at(1), '13000');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Envoyer le devis'));
    await tapAndSettle(tester, find.text('Envoyer le devis'));
    final sent = backend.server.last('POST /v1/pro/missions/m1/quotes');
    expect(sent.headers['Idempotency-Key'], matches(RegExp(r'^[a-z0-9]{32}$')));
    expect(sent.data, {
      'lines': [
        {'kind': 'TRAVEL', 'label': 'Déplacement', 'quantity': 1, 'unitPriceXof': 2000},
        {'kind': 'LABOR', 'label': 'Main-d’œuvre', 'quantity': 1, 'unitPriceXof': 13000},
      ],
      'validForHours': 48,
    });
    expect(find.text('Devis envoyé au client.'), findsOneWidget);
    expect(find.text('Devis n° 1 envoyé : en attente de la réponse du client.'), findsOneWidget);
    expect(find.text('Envoyer une nouvelle version'), findsOneWidget);
    expect(find.text('Retirer le devis'), findsOneWidget);
  });

  testWidgets('T13 — devis refusé par le client : motif affiché, nouvelle version proposée', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [summary('AWAITING_QUOTE')]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, withMoney('AWAITING_QUOTE', quotes: [quoteJson('REJECTED', reason: 'Trop cher')]));
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('En attente de devis'));
    expect(find.text('Devis n° 1 refusé par le client.'), findsOneWidget);
    expect(find.text('Motif : Trop cher'), findsOneWidget);
    expect(find.text('Envoyer une nouvelle version'), findsOneWidget);
  });

  testWidgets('T14 — en attente du paiement du client, puis paiement confirmé : départ possible, commission et net affichés', (tester) async {
    final backend = approvedPro();
    var mission = withMoney('PAYMENT_PENDING', quotes: [quoteJson('ACCEPTED')], due: {'purpose': 'FULL', 'quoteId': 'q1', 'amountXof': 15000, 'label': 'Devis n° 1'});
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [summary(mission['status']! as String)]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, mission);
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('Paiement en attente'));
    expect(find.text('En attente du paiement du client ($amount). Vous serez prévenu dès qu’il est confirmé.'), findsOneWidget);
    expect(find.text('Je pars'), findsNothing);

    mission = withMoney('PAYMENT_CONFIRMED', quotes: [quoteJson('ACCEPTED')], paid: 15000);
    await tester.pump(const Duration(seconds: 11));
    await tester.pumpAndSettle();
    expect(find.text('Paiement confirmé : vous pouvez intervenir.'), findsOneWidget);
    expect(find.text('Payé par le client : $amount'), findsOneWidget);
    expect(find.text('Commission Ineed : ${formatXof(1300)}'), findsOneWidget);
    expect(find.text('Montant qui vous est dû : ${formatXof(13700)}'), findsOneWidget);
    expect(find.textContaining('Paiements simulés'), findsOneWidget);
    expect(find.text('Je pars'), findsOneWidget);
  });

  testWidgets('frais supplémentaires pendant les travaux : justification exigée', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/missions'] = (_) async => jsonResponse(200, [summary('IN_PROGRESS')]);
    backend.server.routes['GET /v1/pro/missions/m1'] = (_) async => jsonResponse(200, withMoney('IN_PROGRESS', quotes: [quoteJson('ACCEPTED')], paid: 15000));
    backend.server.routes['POST /v1/pro/missions/m1/quotes'] = (_) async => jsonResponse(201, quoteJson('SUBMITTED', version: 2, kind: 'SUPPLEMENT'));
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.textContaining('Intervention en cours'));
    await tester.ensureVisible(find.text('Proposer des frais supplémentaires'));
    await tapAndSettle(tester, find.text('Proposer des frais supplémentaires'));
    expect(find.text('Frais supplémentaires'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Description'), 'Robinet neuf');
    await tester.enterText(find.widgetWithText(TextField, 'Prix unitaire (F CFA)'), '8000');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Envoyer le devis'));
    await tapAndSettle(tester, find.text('Envoyer le devis'));
    expect(find.text('Expliquez pourquoi chaque frais supplémentaire est nécessaire.'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, 'Pourquoi est-ce nécessaire ?'), 'L’ancien robinet est fissuré');
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Envoyer le devis'));
    await tapAndSettle(tester, find.text('Envoyer le devis'));
    final body = backend.server.last('POST /v1/pro/missions/m1/quotes').data as Map;
    expect((body['lines'] as List).single, {'kind': 'MATERIAL', 'label': 'Robinet neuf', 'quantity': 1, 'unitPriceXof': 8000, 'justification': 'L’ancien robinet est fissuré'});
  });

  testWidgets('revenus : montant dû par Ineed, en attente ou disponible, reversements pas encore ouverts', (tester) async {
    final backend = approvedPro();
    backend.server.routes['GET /v1/pro/earnings'] = (_) async => jsonResponse(200, {
          'totalDueXof': 31400, 'heldXof': 13700, 'availableXof': 17700,
          'missions': [
            {'missionId': 'm1', 'reference': 'IN-2026-000042', 'status': 'PAYMENT_CONFIRMED', 'grossXof': 15000, 'commissionXof': 1300, 'refundedXof': 0, 'netXof': 13700, 'available': false},
            {'missionId': 'm2', 'reference': 'IN-2026-000043', 'status': 'CLOSED', 'grossXof': 19000, 'commissionXof': 1300, 'refundedXof': 0, 'netXof': 17700, 'available': true},
          ],
        });
    await pumpProApp(tester, backend, signedInStore());
    await tapAndSettle(tester, find.byTooltip('Mes revenus'));
    expect(find.text('Montant dû par Ineed : ${formatXof(31400)}'), findsOneWidget);
    expect(find.text('En attente de la fin des missions : ${formatXof(13700)}'), findsOneWidget);
    expect(find.textContaining('reversements sur votre compte Mobile Money ne sont pas encore ouverts'), findsOneWidget);
    expect(find.text('Disponible'), findsOneWidget);
    expect(find.text('En attente de clôture'), findsOneWidget);
  });
}
