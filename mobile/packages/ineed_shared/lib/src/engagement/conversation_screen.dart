import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import '../widgets/avatar_picker.dart';
import 'providers.dart';
import 'report_dialog.dart';

/// Rechargement de secours si le canal temps réel est indisponible.
const chatRefreshInterval = Duration(seconds: 10);

class _Pending {
  _Pending(this.clientMsgId, this.body, {this.fileId});
  final String clientMsgId;
  final String? body;
  final String? fileId;
  bool failed = false;
}

/// C-27 / P-19 : conversation. Les messages non envoyés (coupure réseau) restent affichés et sont renvoyés
/// avec le même identifiant : le serveur ne les enregistre qu'une fois.
class ConversationScreen extends ConsumerStatefulWidget {
  const ConversationScreen({required this.conversationId, super.key});

  final String conversationId;

  @override
  ConsumerState<ConversationScreen> createState() => _ConversationScreenState();
}

class _ConversationScreenState extends ConsumerState<ConversationScreen> {
  final _input = TextEditingController();
  final List<_Pending> _pending = [];
  StreamSubscription<RealtimeEvent>? _sub;
  Timer? _refresh;
  bool _warning = false;
  bool _sendingPhoto = false;

  @override
  void initState() {
    super.initState();
    final rt = ref.read(realtimeProvider);
    _sub = rt.events.listen((e) {
      if (e.conversationId != widget.conversationId) return;
      ref.invalidate(messagesProvider(widget.conversationId));
      if (e.type == 'message') _markRead();
    });
    unawaited(rt.start());
    _refresh = Timer.periodic(chatRefreshInterval, (_) => ref.invalidate(messagesProvider(widget.conversationId)));
    WidgetsBinding.instance.addPostFrameCallback((_) => _markRead());
  }

  @override
  void dispose() {
    _sub?.cancel();
    _refresh?.cancel();
    _input.dispose();
    super.dispose();
  }

  Future<void> _markRead() async {
    try {
      await ref.read(apiProvider).markConversationRead(widget.conversationId);
      ref.invalidate(unreadMessagesProvider);
    } on Object {
      // Sans incidence : nouvel essai à la prochaine ouverture.
    }
  }

  Future<void> _deliver(_Pending p) async {
    final common = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    setState(() => p.failed = false);
    try {
      final r = await ref.read(apiProvider).sendMessage(widget.conversationId, clientMsgId: p.clientMsgId, body: p.body, fileId: p.fileId);
      if (!mounted) return;
      setState(() {
        _pending.remove(p);
        if (r.warning == 'CONTACT_SHARING') _warning = true;
      });
      ref.invalidate(messagesProvider(widget.conversationId));
    } on ServerFailure catch (e) {
      // Refus définitif (conversation close, message vide…) : retiré, avec l'explication du serveur.
      if (!mounted) return;
      setState(() => _pending.remove(p));
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
      ref.invalidate(conversationProvider(widget.conversationId));
    } on Object {
      if (mounted) setState(() => p.failed = true);
    }
  }

  void _send() {
    final text = _input.text.trim();
    if (text.isEmpty) return;
    final p = _Pending(newClientMessageId(), text);
    setState(() => _pending.add(p));
    _input.clear();
    unawaited(_deliver(p));
  }

  Future<void> _sendPhoto() async {
    final common = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    final bytes = await ref.read(photoPickerProvider)(ImageSource.gallery);
    if (bytes == null) return;
    final mime = imageMimeType(bytes);
    if (mime == null) return;
    setState(() => _sendingPhoto = true);
    try {
      final fileId = await ref.read(apiProvider).uploadFile(purpose: 'MESSAGE_PHOTO', bytes: bytes, mimeType: mime);
      final p = _Pending(newClientMessageId(), null, fileId: fileId);
      setState(() => _pending.add(p));
      await _deliver(p);
    } on Object {
      messenger.showSnackBar(SnackBar(content: Text(common.chatPhotoFailed)));
    } finally {
      if (mounted) setState(() => _sendingPhoto = false);
    }
  }

  Widget _bubble(BuildContext context, {required bool mine, required Widget child, String? meta, VoidCallback? onLongPress, VoidCallback? onTap}) {
    final c = context.ineedColors;
    return Align(
      alignment: mine ? Alignment.centerRight : Alignment.centerLeft,
      child: GestureDetector(
        onLongPress: onLongPress,
        onTap: onTap,
        child: Container(
          margin: const EdgeInsets.symmetric(vertical: 3),
          padding: const EdgeInsets.symmetric(horizontal: IneedSpacing.s3, vertical: IneedSpacing.s2),
          constraints: BoxConstraints(maxWidth: MediaQuery.sizeOf(context).width * 0.78),
          decoration: BoxDecoration(color: mine ? c.actionSoft : c.surfaceMuted, borderRadius: BorderRadius.circular(14)),
          child: Column(crossAxisAlignment: CrossAxisAlignment.end, mainAxisSize: MainAxisSize.min, children: [
            child,
            if (meta != null) Text(meta, style: Theme.of(context).textTheme.labelSmall?.copyWith(color: c.textMuted)),
          ]),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final conv = ref.watch(conversationProvider(widget.conversationId));
    final page = ref.watch(messagesProvider(widget.conversationId));
    final canWrite = conv.value?.canWrite ?? false;
    return Scaffold(
      appBar: AppBar(
        title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(conv.value?.otherPartyName ?? l.chatListTitle),
          if (conv.value != null) Text(conv.value!.subject, style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
      body: Column(children: [
        if (_warning) Padding(padding: const EdgeInsets.all(IneedSpacing.s2), child: IneedBanner(message: l.chatContactWarning, tone: IneedBannerTone.warning)),
        Expanded(
          child: page.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(l, e), tone: IneedBannerTone.danger, actionLabel: l.actionRetry, onAction: () => ref.invalidate(messagesProvider(widget.conversationId)))),
            data: (p) => ListView(
              reverse: true,
              padding: const EdgeInsets.all(IneedSpacing.s3),
              children: [
                for (final m in _pending.reversed)
                  _bubble(
                    context,
                    mine: true,
                    onTap: m.failed ? () => _deliver(m) : null,
                    meta: m.failed ? l.chatNotSent : l.chatSending,
                    child: Text(m.body ?? l.chatPhotoPreview),
                  ),
                for (final m in p.items.reversed)
                  _bubble(
                    context,
                    mine: m.fromMe,
                    meta: [formatAbidjanTime(m.createdAt), if (m.fromMe && m.read) l.chatRead].join(' · '),
                    onLongPress: m.fromMe || m.hidden ? null : () => showReportDialog(context, ref, targetType: 'MESSAGE', targetId: m.id),
                    child: m.hidden
                        ? Text(l.chatHidden, style: TextStyle(fontStyle: FontStyle.italic, color: c.textMuted))
                        : Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                            if (m.photoUrl != null) ClipRRect(borderRadius: BorderRadius.circular(8), child: Image.network(m.photoUrl!, width: 220, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.broken_image_outlined))),
                            if (m.body != null) Text(m.body!),
                          ]),
                  ),
                Padding(padding: const EdgeInsets.all(IneedSpacing.s2), child: Text(l.chatPrivacyNote, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: c.textMuted))),
              ],
            ),
          ),
        ),
        if (conv.hasValue && !canWrite)
          Padding(padding: const EdgeInsets.all(IneedSpacing.s3), child: IneedBanner(message: l.chatReadOnly))
        else
          SafeArea(
            top: false,
            child: Padding(
              padding: const EdgeInsets.fromLTRB(IneedSpacing.s2, 0, IneedSpacing.s2, IneedSpacing.s2),
              child: Row(children: [
                IconButton(tooltip: l.chatAddPhoto, onPressed: _sendingPhoto || !canWrite ? null : _sendPhoto, icon: const Icon(Icons.photo_camera_outlined)),
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    maxLength: 2000,
                    textCapitalization: TextCapitalization.sentences,
                    decoration: InputDecoration(hintText: l.chatInputHint, counterText: ''),
                    onSubmitted: (_) => _send(),
                  ),
                ),
                IconButton(tooltip: l.chatSend, onPressed: canWrite ? _send : null, icon: Icon(Icons.send, color: c.action)),
              ]),
            ),
          ),
      ]),
    );
  }
}
