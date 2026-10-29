import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_shared/ineed_shared.dart';

/// Ouvre la conversation avec le client d'une demande (acceptée ou attribuée).
class OpenChatButton extends ConsumerWidget {
  const OpenChatButton({required this.requestId, super.key});

  final String requestId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final common = CommonLocalizations.of(context);
    return OutlinedButton.icon(
      icon: const Icon(Icons.chat_bubble_outline),
      label: Text(common.chatOpen),
      onPressed: () async {
        final messenger = ScaffoldMessenger.of(context);
        try {
          final conv = await ref.read(apiProvider).openConversation(requestId);
          if (context.mounted) await context.push('/messages/${conv.id}');
        } on Object catch (e) {
          messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
        }
      },
    );
  }
}
