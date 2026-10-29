import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:test/test.dart';

Map<String, Object?> quoteJson({String status = 'SUBMITTED', bool open = true}) => {
      'id': 'q1', 'version': 2, 'kind': 'INITIAL', 'status': status, 'totalXof': 15000, 'validUntil': '2026-10-31T10:00:00.000Z', 'open': open,
      'conditions': 'Garantie 3 mois', 'estimatedDurationMin': 60, 'rejectionReason': null,
      'lines': [
        {'kind': 'TRAVEL', 'label': 'Déplacement', 'quantity': 1, 'unitPriceXof': 2000, 'amountXof': 2000, 'justification': null},
        {'kind': 'LABOR', 'label': 'Main-d’œuvre', 'quantity': 1, 'unitPriceXof': 13000, 'amountXof': 13000, 'justification': null},
      ],
    };

void main() {
  IneedApiClient client(FakeServer s) => IneedApiClient(baseUrl: Uri.parse('http://api.test'), adapter: s, tokenStore: InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R'));

  test('clé d’idempotence : 32 caractères aléatoires, envoyée dans l’en-tête des actions financières', () async {
    final k = newIdempotencyKey();
    expect(k, matches(RegExp(r'^[a-z0-9]{32}$')));
    expect(newIdempotencyKey(), isNot(k));
    final s = FakeServer({
      'POST /v1/missions/m1/payments': (_) async => jsonResponse(201, {
            'id': 'p1', 'purpose': 'FULL', 'amountXof': 15000, 'status': 'PENDING', 'isSandbox': true, 'receiptAvailable': false,
            'checkoutUrl': '/v1/payments/sandbox/checkout/INP1', 'refunds': <Object>[],
          }),
      'POST /v1/missions/m1/quotes/q1/accept': (_) async => jsonResponse(200, quoteJson(status: 'ACCEPTED', open: false)),
    });
    final p = await client(s).payMission('m1', idempotencyKey: k);
    expect(s.last('POST /v1/missions/m1/payments').headers['Idempotency-Key'], k);
    expect(p.isPending, isTrue);
    expect(p.isSucceeded, isFalse);
    final q = await client(s).acceptQuote('m1', 'q1', idempotencyKey: 'cle-1234');
    expect(q.status, 'ACCEPTED');
    expect(s.last('POST /v1/missions/m1/quotes/q1/accept').headers['Idempotency-Key'], 'cle-1234');
  });

  test('devis : lignes, total et envoi au format attendu', () async {
    final q = Quote.fromJson(quoteJson());
    expect(q.lines.map((l) => l.amountXof), [2000, 13000]);
    expect(q.open, isTrue);
    const draft = QuoteDraft(lines: [QuoteLine(kind: QuoteLineKind.labor, label: 'Pose', quantity: 2, unitPriceXof: 5000, justification: '  ')], validForHours: 24);
    expect(draft.totalXof, 10000);
    expect(draft.toJson(), {
      'lines': [{'kind': 'LABOR', 'label': 'Pose', 'quantity': 2, 'unitPriceXof': 5000}],
      'validForHours': 24,
    });
  });

  test('volet financier de la mission : devis en attente, montant dû, paiement en cours ; reçu', () {
    final money = MissionMoney.fromJson({
      'quotes': [quoteJson(status: 'SUPERSEDED', open: false), quoteJson()],
      'due': {'purpose': 'FULL', 'quoteId': 'q1', 'amountXof': 15000, 'label': 'Devis n° 2'},
      'payments': [
        {'id': 'p1', 'purpose': 'FULL', 'amountXof': 15000, 'status': 'FAILED', 'isSandbox': false, 'receiptAvailable': false, 'failureMessage': 'Solde insuffisant', 'refunds': <Object>[]},
        {'id': 'p2', 'purpose': 'FULL', 'amountXof': 15000, 'status': 'PENDING', 'isSandbox': false, 'receiptAvailable': false, 'checkoutUrl': 'https://pay.test/x', 'refunds': <Object>[]},
      ],
      'paidXof': 0, 'refundedXof': 0,
    });
    expect(money.openQuote?.version, 2);
    expect(money.due?.amountXof, 15000);
    expect(money.pendingPayment?.id, 'p2');
    expect(money.netXof, isNull);

    final r = Receipt.fromJson({
      'receiptNumber': 'RC-INP2026000001ABCD', 'issuedAt': '2026-10-29T10:00:00.000Z', 'isSandbox': false, 'notice': 'Ce reçu n’est pas une facture.',
      'payer': {'firstName': 'Awa', 'phone': '+225 07 •• •• •• 12'}, 'pro': {'businessName': 'Koffi Plomberie'}, 'mission': {'reference': 'IN-2026-000042'},
      'purpose': 'Prestation', 'lines': [{'label': 'Main-d’œuvre', 'quantity': 1, 'unitPriceXof': 13000, 'amountXof': 13000}], 'amountXof': 13000,
      'method': 'Orange Money', 'transactionReference': 'MP1', 'refunds': [{'amountXof': 3000}],
    });
    expect(r.proName, 'Koffi Plomberie');
    expect(r.refunds, [3000]);
  });
}
