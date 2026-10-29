// Devis, paiements, reçus et revenus (contrat : docs/api/openapi.json). Montants en francs CFA entiers.

import 'dart:math';

import 'json.dart';

/// Clé d'idempotence d'une action financière : générée une fois par action, réutilisée telle quelle si
/// l'application renvoie la même action (réponse perdue, double appui).
String newIdempotencyKey() {
  final r = Random.secure();
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return List.generate(32, (_) => chars[r.nextInt(chars.length)]).join();
}

enum QuoteLineKind {
  travel('TRAVEL'),
  labor('LABOR'),
  material('MATERIAL'),
  other('OTHER');

  const QuoteLineKind(this.code);
  final String code;
  static QuoteLineKind parse(String v) => values.firstWhere((k) => k.code == v, orElse: () => QuoteLineKind.other);
}

class QuoteLine {
  const QuoteLine({required this.kind, required this.label, required this.quantity, required this.unitPriceXof, this.justification});
  factory QuoteLine.fromJson(Map<String, Object?> j) => QuoteLine(
        kind: QuoteLineKind.parse(req<String>(j, 'kind')),
        label: req<String>(j, 'label'),
        quantity: req<num>(j, 'quantity').toInt(),
        unitPriceXof: req<num>(j, 'unitPriceXof').toInt(),
        justification: j['justification'] as String?,
      );
  final QuoteLineKind kind;
  final String label;
  final int quantity;
  final int unitPriceXof;
  final String? justification;
  int get amountXof => quantity * unitPriceXof;

  Map<String, Object?> toJson() => {
        'kind': kind.code,
        'label': label,
        'quantity': quantity,
        'unitPriceXof': unitPriceXof,
        if (justification != null && justification!.trim().isNotEmpty) 'justification': justification!.trim(),
      };
}

class Quote {
  const Quote({
    required this.id,
    required this.version,
    required this.kind,
    required this.status,
    required this.totalXof,
    required this.validUntil,
    required this.open,
    required this.lines,
    this.conditions,
    this.estimatedDurationMin,
    this.rejectionReason,
  });
  factory Quote.fromJson(Map<String, Object?> j) => Quote(
        id: req<String>(j, 'id'),
        version: req<num>(j, 'version').toInt(),
        kind: req<String>(j, 'kind'),
        status: req<String>(j, 'status'),
        totalXof: req<num>(j, 'totalXof').toInt(),
        validUntil: DateTime.parse(req<String>(j, 'validUntil')),
        open: j['open'] == true,
        conditions: j['conditions'] as String?,
        estimatedDurationMin: intOrNull(j, 'estimatedDurationMin'),
        rejectionReason: j['rejectionReason'] as String?,
        lines: listOf(j, 'lines').map(QuoteLine.fromJson).toList(),
      );
  final String id;
  final int version;

  /// INITIAL ou SUPPLEMENT (frais supplémentaires pendant les travaux).
  final String kind;

  /// SUBMITTED, ACCEPTED, REJECTED, SUPERSEDED, EXPIRED, WITHDRAWN.
  final String status;
  final int totalXof;
  final DateTime validUntil;

  /// En attente de la réponse du client et encore valable.
  final bool open;
  final String? conditions;
  final int? estimatedDurationMin;
  final String? rejectionReason;
  final List<QuoteLine> lines;
  bool get isSupplement => kind == 'SUPPLEMENT';
}

class QuoteDraft {
  const QuoteDraft({required this.lines, this.validForHours, this.conditions, this.estimatedDurationMin});
  final List<QuoteLine> lines;
  final int? validForHours;
  final String? conditions;
  final int? estimatedDurationMin;
  int get totalXof => lines.fold(0, (s, l) => s + l.amountXof);

  Map<String, Object?> toJson() => {
        'lines': [for (final l in lines) l.toJson()],
        'validForHours': ?validForHours,
        if (conditions != null && conditions!.trim().isNotEmpty) 'conditions': conditions!.trim(),
        'estimatedDurationMin': ?estimatedDurationMin,
      };
}

class PaymentDue {
  const PaymentDue({required this.purpose, required this.amountXof, required this.label, this.quoteId});
  factory PaymentDue.fromJson(Map<String, Object?> j) =>
      PaymentDue(purpose: req<String>(j, 'purpose'), amountXof: req<num>(j, 'amountXof').toInt(), label: req<String>(j, 'label'), quoteId: j['quoteId'] as String?);

  /// FULL, TRAVEL_FEE, WORK, SUPPLEMENT.
  final String purpose;
  final int amountXof;
  final String label;
  final String? quoteId;
}

class Refund {
  const Refund({required this.amountXof, required this.status, required this.reason, this.completedAt});
  factory Refund.fromJson(Map<String, Object?> j) =>
      Refund(amountXof: req<num>(j, 'amountXof').toInt(), status: req<String>(j, 'status'), reason: req<String>(j, 'reason'), completedAt: dateOrNull(j, 'completedAt'));
  final int amountXof;
  final String status;
  final String reason;
  final DateTime? completedAt;
}

/// Paiement tel que le serveur le connaît. Seul [isSucceeded] (statut vérifié par le serveur auprès du
/// prestataire) vaut confirmation : l'application n'en déduit jamais une réussite d'elle-même.
class Payment {
  const Payment({
    required this.id,
    required this.purpose,
    required this.amountXof,
    required this.status,
    required this.isSandbox,
    required this.receiptAvailable,
    required this.refunds,
    this.checkoutUrl,
    this.method,
    this.confirmedAt,
    this.failureMessage,
  });
  factory Payment.fromJson(Map<String, Object?> j) => Payment(
        id: req<String>(j, 'id'),
        purpose: req<String>(j, 'purpose'),
        amountXof: req<num>(j, 'amountXof').toInt(),
        status: req<String>(j, 'status'),
        isSandbox: j['isSandbox'] == true,
        receiptAvailable: j['receiptAvailable'] == true,
        checkoutUrl: j['checkoutUrl'] as String?,
        method: j['method'] as String?,
        confirmedAt: dateOrNull(j, 'confirmedAt'),
        failureMessage: j['failureMessage'] as String?,
        refunds: listOf(j, 'refunds').map(Refund.fromJson).toList(),
      );
  final String id;
  final String purpose;
  final int amountXof;

  /// INITIATED, PENDING, SUCCEEDED, FAILED, CANCELLED, EXPIRED.
  final String status;
  final bool isSandbox;
  final bool receiptAvailable;
  final String? checkoutUrl;
  final String? method;
  final DateTime? confirmedAt;
  final String? failureMessage;
  final List<Refund> refunds;
  bool get isPending => status == 'INITIATED' || status == 'PENDING';
  bool get isSucceeded => status == 'SUCCEEDED';
}

/// Volet financier d'une mission. Côté professionnel : commission et montant net de la mission.
class MissionMoney {
  const MissionMoney({required this.quotes, required this.payments, required this.paidXof, required this.refundedXof, this.due, this.commissionXof, this.netXof});
  factory MissionMoney.fromJson(Map<String, Object?> j) => MissionMoney(
        quotes: listOf(j, 'quotes').map(Quote.fromJson).toList(),
        payments: listOf(j, 'payments').map(Payment.fromJson).toList(),
        due: mapOrNull(j, 'due') == null ? null : PaymentDue.fromJson(mapOrNull(j, 'due')!),
        paidXof: req<num>(j, 'paidXof').toInt(),
        refundedXof: req<num>(j, 'refundedXof').toInt(),
        commissionXof: intOrNull(j, 'commissionXof'),
        netXof: intOrNull(j, 'netXof'),
      );
  final List<Quote> quotes;
  final List<Payment> payments;
  final PaymentDue? due;
  final int paidXof;
  final int refundedXof;
  final int? commissionXof;
  final int? netXof;

  /// Devis (ou frais supplémentaires) en attente de la réponse du client.
  Quote? get openQuote => quotes.where((q) => q.open).lastOrNull;
  Quote? get latestQuote => quotes.lastOrNull;
  Payment? get pendingPayment => payments.where((p) => p.isPending && p.checkoutUrl != null).lastOrNull;
}

class ReceiptLine {
  const ReceiptLine({required this.label, required this.quantity, required this.amountXof});
  factory ReceiptLine.fromJson(Map<String, Object?> j) =>
      ReceiptLine(label: req<String>(j, 'label'), quantity: req<num>(j, 'quantity').toInt(), amountXof: req<num>(j, 'amountXof').toInt());
  final String label;
  final int quantity;
  final int amountXof;
}

class Receipt {
  const Receipt({
    required this.receiptNumber,
    required this.issuedAt,
    required this.isSandbox,
    required this.notice,
    required this.proName,
    required this.missionReference,
    required this.purpose,
    required this.lines,
    required this.amountXof,
    required this.refunds,
    this.payerPhone,
    this.method,
    this.transactionReference,
  });
  factory Receipt.fromJson(Map<String, Object?> j) => Receipt(
        receiptNumber: req<String>(j, 'receiptNumber'),
        issuedAt: DateTime.parse(req<String>(j, 'issuedAt')),
        isSandbox: j['isSandbox'] == true,
        notice: req<String>(j, 'notice'),
        proName: req<String>(req<Map<String, Object?>>(j, 'pro'), 'businessName'),
        missionReference: req<String>(req<Map<String, Object?>>(j, 'mission'), 'reference'),
        purpose: req<String>(j, 'purpose'),
        lines: listOf(j, 'lines').map(ReceiptLine.fromJson).toList(),
        amountXof: req<num>(j, 'amountXof').toInt(),
        payerPhone: mapOrNull(j, 'payer')?['phone'] as String?,
        method: j['method'] as String?,
        transactionReference: j['transactionReference'] as String?,
        refunds: [for (final r in listOf(j, 'refunds')) req<num>(r, 'amountXof').toInt()],
      );
  final String receiptNumber;
  final DateTime issuedAt;
  final bool isSandbox;
  final String notice;
  final String proName;
  final String missionReference;
  final String purpose;
  final List<ReceiptLine> lines;
  final int amountXof;
  final String? payerPhone;
  final String? method;
  final String? transactionReference;

  /// Montants remboursés.
  final List<int> refunds;
}

class EarningsMission {
  const EarningsMission({required this.missionId, required this.reference, required this.grossXof, required this.commissionXof, required this.netXof, required this.available});
  factory EarningsMission.fromJson(Map<String, Object?> j) => EarningsMission(
        missionId: req<String>(j, 'missionId'),
        reference: req<String>(j, 'reference'),
        grossXof: req<num>(j, 'grossXof').toInt(),
        commissionXof: req<num>(j, 'commissionXof').toInt(),
        netXof: req<num>(j, 'netXof').toInt(),
        available: j['available'] == true,
      );
  final String missionId;
  final String reference;
  final int grossXof;
  final int commissionXof;
  final int netXof;
  final bool available;
}

class Earnings {
  const Earnings({required this.totalDueXof, required this.heldXof, required this.availableXof, required this.missions});
  factory Earnings.fromJson(Map<String, Object?> j) => Earnings(
        totalDueXof: req<num>(j, 'totalDueXof').toInt(),
        heldXof: req<num>(j, 'heldXof').toInt(),
        availableXof: req<num>(j, 'availableXof').toInt(),
        missions: listOf(j, 'missions').map(EarningsMission.fromJson).toList(),
      );
  final int totalDueXof;

  /// Missions pas encore clôturées : fonds conservés chez le prestataire de paiement.
  final int heldXof;
  final int availableXof;
  final List<EarningsMission> missions;
}
