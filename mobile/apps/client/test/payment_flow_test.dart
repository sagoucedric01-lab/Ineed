import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_client/providers.dart';
import 'package:ineed_core/ineed_core.dart';

import 'helpers.dart';
import 'marketplace_flow_test.dart' show signedIn, tapAndSettle;
import 'matching_flow_test.dart' show matchingServer, missionJson, requestJson;

Map<String, Object?> quoteJson({String status = 'SUBMITTED', bool open = true, String kind = 'INITIAL', int version = 2}) => {
      'id': 'q$version', 'version': version, 'kind': kind, 'status': status, 'totalXof': 15000, 'validUntil': '2026-10-31T10:00:00.000Z', 'open': open,
      'conditions': 'Garantie 3 mois sur la pièce', 'estimatedDurationMin': 60, 'rejectionReason': null, 'submittedAt': '2026-10-29T10:05:00.000Z', 'decidedAt': null,
      'lines': [
        {'kind': 'TRAVEL', 'label': 'Déplacement', 'quantity': 1, 'unitPriceXof': 2000, 'amountXof': 2000, 'justification': null},
        {'kind': 'LABOR', 'label': 'Remplacement du joint', 'quantity': 1, 'unitPriceXof': 13000, 'amountXof': 13000, 'justification': kind == 'SUPPLEMENT' ? 'Le joint est fendu' : null},
      ],
    };

Map<String, Object?> paymentJson(String status, {String? failure, bool sandbox = true}) => {
      'id': 'p1', 'purpose': 'FULL', 'quoteId': 'q2', 'amountXof': 15000, 'status': status, 'method': status == 'SUCCEEDED' ? 'MTN_MOMO' : null, 'provider': 'sandbox',
      'isSandbox': sandbox, 'checkoutUrl': status == 'PENDING' ? '/v1/payments/sandbox/checkout/INP2026000001ABCD' : null,
      'initiatedAt': '2026-10-29T10:06:00.000Z', 'expiresAt': '2026-10-29T10:36:00.000Z', 'confirmedAt': status == 'SUCCEEDED' ? '2026-10-29T10:07:00.000Z' : null,
      'failureMessage': failure, 'receiptAvailable': status == 'SUCCEEDED', 'refunds': <Object>[],
    };

Map<String, Object?> withMoney(Map<String, Object?> mission, {List<Map<String, Object?>> quotes = const [], Map<String, Object?>? due, List<Map<String, Object?>> payments = const []}) => {
      ...mission,
      'money': {'quotes': quotes, 'due': due, 'payments': payments, 'paidXof': 0, 'refundedXof': 0},
    };

const due = {'purpose': 'FULL', 'quoteId': 'q2', 'amountXof': 15000, 'label': 'Devis n° 2'};

void main() {
  final amount = formatXof(15000);

  testWidgets('T13 — le client lit le devis détaillé, l’accepte, puis paie : confirmé seulement quand le serveur l’a vérifié', (tester) async {
    var mission = withMoney(missionJson('QUOTE_PENDING_APPROVAL'), quotes: [quoteJson(status: 'SUPERSEDED', open: false, version: 1), quoteJson()]);
    var paymentStatus = 'PENDING';
    final launched = <Uri>[];
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, mission),
        'POST /v1/missions/m1/quotes/q2/accept': (_) {
          mission = withMoney(missionJson('PAYMENT_PENDING'), quotes: [quoteJson(status: 'ACCEPTED', open: false)], due: due);
          return jsonResponse(200, quoteJson(status: 'ACCEPTED', open: false));
        },
        'POST /v1/missions/m1/payments': (_) {
          mission = withMoney(missionJson('PAYMENT_PENDING'), quotes: [quoteJson(status: 'ACCEPTED', open: false)], due: due, payments: [paymentJson('PENDING')]);
          return jsonResponse(201, paymentJson('PENDING'));
        },
        'GET /v1/payments/p1': (_) => jsonResponse(200, paymentJson(paymentStatus)),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true, overrides: [
      checkoutLauncherProvider.overrideWithValue((url) async {
        launched.add(url);
        return true;
      }),
    ]);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('Devis n° 2'), findsOneWidget);
    expect(find.text('Remplacement du joint'), findsOneWidget);
    expect(find.text('Total : $amount'), findsOneWidget);
    expect(find.text('Garantie 3 mois sur la pièce'), findsOneWidget);
    await tapAndSettle(tester, find.text('Accepter le devis'));
    final accept = server.last('POST /v1/missions/m1/quotes/q2/accept');
    expect(accept.headers['Idempotency-Key'], matches(RegExp(r'^[a-z0-9]{32}$')));
    expect(find.text('Devis accepté. Il reste à régler l’intervention.'), findsOneWidget);
    expect(find.text('À régler : $amount'), findsOneWidget);
    expect(find.textContaining('conservé par notre prestataire de paiement agréé'), findsOneWidget);

    await tapAndSettle(tester, find.text('Payer $amount'));
    expect(server.count('POST /v1/missions/m1/payments'), 1);
    // Page du prestataire ouverte (lien relatif résolu sur l'adresse de l'API).
    expect(launched.single.toString(), 'http://api.test/v1/payments/sandbox/checkout/INP2026000001ABCD');
    expect(find.textContaining('Paiement simulé (environnement de test)'), findsOneWidget);

    // Le serveur n'a pas encore confirmé : aucune réussite affichée.
    await tester.pump(paymentPollIntervalForTest);
    await tester.pumpAndSettle();
    expect(find.text('Paiement de $amount confirmé.'), findsNothing);
    expect(find.text('Voir le reçu'), findsNothing);
    expect(find.textContaining('Paiement en cours de vérification'), findsWidgets);

    paymentStatus = 'SUCCEEDED';
    mission = withMoney(missionJson('PAYMENT_CONFIRMED'), quotes: [quoteJson(status: 'ACCEPTED', open: false)], payments: [paymentJson('SUCCEEDED')]);
    await tester.pump(paymentPollIntervalForTest);
    await tester.pumpAndSettle();
    expect(find.text('Paiement de $amount confirmé.'), findsOneWidget);
    expect(find.text('Voir le reçu'), findsOneWidget);
  });

  testWidgets('T13 — refus motivé du devis', (tester) async {
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, withMoney(missionJson('QUOTE_PENDING_APPROVAL'), quotes: [quoteJson()])),
        'POST /v1/missions/m1/quotes/q2/reject': (_) => jsonResponse(200, quoteJson(status: 'REJECTED', open: false)),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    await tapAndSettle(tester, find.text('Refuser'));
    expect(find.text('Refuser ce devis ?'), findsOneWidget);
    await tester.enterText(find.byType(TextField), 'Trop cher pour moi');
    await tapAndSettle(tester, find.widgetWithText(TextButton, 'Refuser'));
    expect(server.last('POST /v1/missions/m1/quotes/q2/reject').data, {'reason': 'Trop cher pour moi'});
    expect(find.text('Devis refusé. Le professionnel est prévenu.'), findsOneWidget);
  });

  testWidgets('T15 — paiement refusé : motif affiché, nouvel essai possible ; après une coupure, la même clé est renvoyée', (tester) async {
    var calls = 0;
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, withMoney(missionJson('PAYMENT_PENDING'), due: due, payments: [paymentJson('FAILED', failure: 'Solde insuffisant sur le compte Mobile Money.', sandbox: false)])),
      },
    );
    server.routes['POST /v1/missions/m1/payments'] = (o) async {
      calls++;
      if (calls == 1) throw DioException.connectionError(requestOptions: o, reason: 'réseau');
      return jsonResponse(201, paymentJson('PENDING', sandbox: false));
    };
    server.routes['GET /v1/payments/p1'] = (_) async => jsonResponse(200, paymentJson('PENDING', sandbox: false));
    await pumpClientApp(tester, server, signedIn(), tallScreen: true, overrides: [checkoutLauncherProvider.overrideWithValue((_) async => true)]);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('Le paiement n’a pas abouti. Solde insuffisant sur le compte Mobile Money.'), findsOneWidget);
    expect(find.textContaining('Paiement simulé'), findsNothing);
    await tapAndSettle(tester, find.text('Payer $amount'));
    await tapAndSettle(tester, find.text('Payer $amount'));
    final keys = server.requests.where((r) => r.uri.path == '/v1/missions/m1/payments').map((r) => r.headers['Idempotency-Key']).toList();
    expect(keys, hasLength(2));
    expect(keys[0], keys[1]);
  });

  testWidgets('frais supplémentaires pendant les travaux : justification affichée, acceptation', (tester) async {
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, withMoney(missionJson('IN_PROGRESS', cancelTerms: null), quotes: [quoteJson(kind: 'SUPPLEMENT', version: 3)])),
        'POST /v1/missions/m1/quotes/q3/accept': (_) => jsonResponse(200, quoteJson(kind: 'SUPPLEMENT', version: 3, status: 'ACCEPTED', open: false)),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    expect(find.text('Frais supplémentaires proposés'), findsOneWidget);
    expect(find.text('Le joint est fendu'), findsOneWidget);
    await tapAndSettle(tester, find.text('Accepter ces frais'));
    expect(server.count('POST /v1/missions/m1/quotes/q3/accept'), 1);
  });

  testWidgets('reçu d’un paiement confirmé, marqué « simulation » quand il l’est', (tester) async {
    final server = matchingServer(
      request: () => requestJson('ASSIGNED', missionId: 'm1'),
      extra: {
        'GET /v1/missions/m1': (_) => jsonResponse(200, withMoney(missionJson('PAYMENT_CONFIRMED'), quotes: [quoteJson(status: 'ACCEPTED', open: false)], payments: [paymentJson('SUCCEEDED')])),
        'GET /v1/payments/p1/receipt': (_) => jsonResponse(200, {
              'receiptNumber': 'RC-INP2026000001ABCD', 'issuedAt': '2026-10-29T10:07:00.000Z', 'isSandbox': true,
              'notice': 'SIMULATION — aucun paiement réel n’a eu lieu. Ce document n’a aucune valeur.',
              'payer': {'firstName': 'Awa', 'phone': '+225 07 •• •• •• 78'}, 'pro': {'businessName': 'Koffi Plomberie'}, 'mission': {'reference': 'IN-2026-000042'},
              'purpose': 'Prestation', 'lines': [{'label': 'Déplacement', 'quantity': 1, 'unitPriceXof': 2000, 'amountXof': 2000}, {'label': 'Remplacement du joint', 'quantity': 1, 'unitPriceXof': 13000, 'amountXof': 13000}],
              'amountXof': 15000, 'method': 'MTN Mobile Money', 'transactionReference': 'SBX12', 'refunds': <Object>[],
            }),
      },
    );
    await pumpClientApp(tester, server, signedIn(), tallScreen: true);
    await tapAndSettle(tester, find.textContaining('Koffi Plomberie ·'));
    await tapAndSettle(tester, find.text('Voir le reçu'));
    expect(find.text('Reçu de paiement'), findsOneWidget);
    expect(find.text('Reçu n° RC-INP2026000001ABCD'), findsOneWidget);
    expect(find.textContaining('SIMULATION'), findsOneWidget);
    expect(find.text('Moyen de paiement : MTN Mobile Money'), findsOneWidget);
    expect(find.text(amount), findsWidgets);
  });
}

/// Intervalle de vérification du paiement, légèrement dépassé.
const paymentPollIntervalForTest = Duration(seconds: 4);
