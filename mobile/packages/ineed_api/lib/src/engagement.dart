// Messagerie, avis, réclamations, signalements (contrat : docs/api/openapi.json).

import 'dart:math';

import 'json.dart';

/// Identifiant d'un message généré par l'application : renvoyé tel quel après une coupure, il évite les doublons.
String newClientMessageId() {
  final r = Random.secure();
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'm${List.generate(23, (_) => chars[r.nextInt(chars.length)]).join()}';
}

class LastMessage {
  const LastMessage({required this.fromMe, required this.hasPhoto, required this.createdAt, this.body});
  factory LastMessage.fromJson(Map<String, Object?> j) =>
      LastMessage(body: j['body'] as String?, hasPhoto: j['hasPhoto'] == true, fromMe: j['fromMe'] == true, createdAt: DateTime.parse(req<String>(j, 'createdAt')));
  final String? body;
  final bool hasPhoto;
  final bool fromMe;
  final DateTime createdAt;
}

class Conversation {
  const Conversation({required this.id, required this.requestId, required this.subject, required this.otherPartyName, required this.canWrite, required this.unread, this.missionId, this.missionReference, this.lastMessage});
  factory Conversation.fromJson(Map<String, Object?> j) => Conversation(
        id: req<String>(j, 'id'),
        requestId: req<String>(j, 'requestId'),
        missionId: j['missionId'] as String?,
        missionReference: j['missionReference'] as String?,
        subject: req<String>(j, 'subject'),
        otherPartyName: req<String>(req<Map<String, Object?>>(j, 'otherParty'), 'name'),
        canWrite: j['canWrite'] == true,
        unread: intOrNull(j, 'unread') ?? 0,
        lastMessage: mapOrNull(j, 'lastMessage') == null ? null : LastMessage.fromJson(mapOrNull(j, 'lastMessage')!),
      );
  final String id;
  final String requestId;
  final String? missionId;
  final String? missionReference;
  final String subject;
  final String otherPartyName;
  final bool canWrite;
  final int unread;
  final LastMessage? lastMessage;
}

class ChatMessage {
  const ChatMessage({required this.id, required this.clientMsgId, required this.fromMe, required this.hidden, required this.read, required this.createdAt, this.body, this.photoUrl});
  factory ChatMessage.fromJson(Map<String, Object?> j) => ChatMessage(
        id: req<String>(j, 'id'),
        clientMsgId: req<String>(j, 'clientMsgId'),
        fromMe: j['fromMe'] == true,
        body: j['body'] as String?,
        hidden: j['hidden'] == true,
        photoUrl: j['photoUrl'] as String?,
        read: j['read'] == true,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final String clientMsgId;
  final bool fromMe;
  final String? body;

  /// Masqué par la modération.
  final bool hidden;
  final String? photoUrl;

  /// Lu par l'autre participant (pour mes messages).
  final bool read;
  final DateTime createdAt;
}

class MessagesPage {
  const MessagesPage({required this.items, required this.hasMore});
  factory MessagesPage.fromJson(Map<String, Object?> j) => MessagesPage(items: listOf(j, 'items').map(ChatMessage.fromJson).toList(), hasMore: j['hasMore'] == true);
  final List<ChatMessage> items;
  final bool hasMore;
}

class SendMessageResult {
  const SendMessageResult({required this.message, required this.duplicate, this.warning});
  factory SendMessageResult.fromJson(Map<String, Object?> j) =>
      SendMessageResult(message: ChatMessage.fromJson(req<Map<String, Object?>>(j, 'message')), duplicate: j['duplicate'] == true, warning: j['warning'] as String?);
  final ChatMessage message;
  final bool duplicate;

  /// CONTACT_SHARING : des coordonnées ont été repérées dans le message.
  final String? warning;
}

class MyReview {
  const MyReview({required this.id, required this.rating, required this.status, required this.createdAt, this.comment, this.proReply});
  factory MyReview.fromJson(Map<String, Object?> j) => MyReview(
        id: req<String>(j, 'id'),
        rating: req<num>(j, 'rating').toInt(),
        comment: j['comment'] as String?,
        status: req<String>(j, 'status'),
        proReply: j['proReply'] as String?,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final int rating;
  final String? comment;

  /// PUBLISHED ou PENDING_MODERATION.
  final String status;
  final String? proReply;
  final DateTime createdAt;
}

class MissionReviewState {
  const MissionReviewState({required this.canReview, this.review});
  factory MissionReviewState.fromJson(Map<String, Object?> j) =>
      MissionReviewState(canReview: j['canReview'] == true, review: mapOrNull(j, 'review') == null ? null : MyReview.fromJson(mapOrNull(j, 'review')!));
  final bool canReview;
  final MyReview? review;
}

enum ComplaintCategory {
  quality('QUALITY'),
  price('PRICE'),
  noShow('NO_SHOW'),
  damage('DAMAGE'),
  payment('PAYMENT'),
  behaviour('BEHAVIOUR'),
  other('OTHER');

  const ComplaintCategory(this.code);
  final String code;
  static ComplaintCategory parse(String v) => values.firstWhere((c) => c.code == v, orElse: () => ComplaintCategory.other);
}

class ComplaintSummary {
  const ComplaintSummary({required this.id, required this.reference, required this.category, required this.status, required this.createdAt, this.missionReference});
  factory ComplaintSummary.fromJson(Map<String, Object?> j) => ComplaintSummary(
        id: req<String>(j, 'id'),
        reference: req<String>(j, 'reference'),
        category: ComplaintCategory.parse(req<String>(j, 'category')),
        status: req<String>(j, 'status'),
        missionReference: j['missionReference'] as String?,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final String reference;
  final ComplaintCategory category;

  /// OPEN, IN_REVIEW, WAITING_USER, RESOLVED, REJECTED.
  final String status;
  final String? missionReference;
  final DateTime createdAt;
  bool get isOpen => status == 'OPEN' || status == 'IN_REVIEW' || status == 'WAITING_USER';
}

class ComplaintMessage {
  const ComplaintMessage({required this.id, required this.fromSupport, required this.body, required this.createdAt, this.fileUrl});
  factory ComplaintMessage.fromJson(Map<String, Object?> j) => ComplaintMessage(
        id: req<String>(j, 'id'),
        fromSupport: j['fromSupport'] == true,
        body: req<String>(j, 'body'),
        fileUrl: j['fileUrl'] as String?,
        createdAt: DateTime.parse(req<String>(j, 'createdAt')),
      );
  final String id;
  final bool fromSupport;
  final String body;
  final String? fileUrl;
  final DateTime createdAt;
}

class Complaint {
  const Complaint({required this.summary, required this.description, required this.messages, this.resolution});
  factory Complaint.fromJson(Map<String, Object?> j) => Complaint(
        summary: ComplaintSummary.fromJson({...j, 'missionReference': mapOrNull(j, 'mission')?['reference']}),
        description: req<String>(j, 'description'),
        resolution: j['resolution'] as String?,
        messages: listOf(j, 'messages').map(ComplaintMessage.fromJson).toList(),
      );
  final ComplaintSummary summary;
  final String description;
  final String? resolution;
  final List<ComplaintMessage> messages;
}

/// Motifs de signalement.
enum ReportReason {
  spam('SPAM'),
  harassment('HARASSMENT'),
  fraud('FRAUD'),
  offPlatformPayment('OFF_PLATFORM_PAYMENT'),
  inappropriate('INAPPROPRIATE'),
  other('OTHER');

  const ReportReason(this.code);
  final String code;
}
