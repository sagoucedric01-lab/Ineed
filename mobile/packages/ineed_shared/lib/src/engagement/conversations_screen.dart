import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import 'providers.dart';

/// Liste des conversations (C-26 / P-18), avec le nombre de messages non lus.
class ConversationsScreen extends ConsumerWidget {
  const ConversationsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = CommonLocalizations.of(context);
    final c = context.ineedColors;
    final pro = ref.watch(appKindProvider) == 'PRO';
    return Scaffold(
      appBar: AppBar(title: Text(l.chatListTitle)),
      body: ref.watch(conversationsProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(l, e), tone: IneedBannerTone.danger, actionLabel: l.actionRetry, onAction: () => ref.invalidate(conversationsProvider))),
            data: (list) => list.isEmpty
                ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(pro ? l.chatListEmptyPro : l.chatListEmpty, textAlign: TextAlign.center)))
                : RefreshIndicator(
                    onRefresh: () async => ref.invalidate(conversationsProvider),
                    child: ListView(children: [
                      for (final conv in list)
                        ListTile(
                          leading: CircleAvatar(child: Text(conv.otherPartyName.characters.first.toUpperCase())),
                          title: Text(conv.otherPartyName, style: TextStyle(fontWeight: conv.unread > 0 ? FontWeight.w700 : FontWeight.normal)),
                          subtitle: Text(
                            [
                              conv.subject,
                              if (conv.lastMessage != null)
                                () {
                                  final text = conv.lastMessage!.body ?? (conv.lastMessage!.hasPhoto ? l.chatPhotoPreview : l.chatHidden);
                                  return conv.lastMessage!.fromMe ? l.chatYou(text) : text;
                                }(),
                            ].join(' · '),
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          trailing: conv.unread > 0
                              ? Badge(label: Text('${conv.unread}'), backgroundColor: c.action)
                              : (conv.lastMessage == null ? null : Text(formatAbidjanTime(conv.lastMessage!.createdAt), style: Theme.of(context).textTheme.bodySmall)),
                          onTap: () async {
                            await context.push('/messages/${conv.id}');
                            ref.invalidate(conversationsProvider);
                          },
                        ),
                    ]),
                  ),
          ),
    );
  }
}
