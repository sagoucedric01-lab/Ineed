import 'package:go_router/go_router.dart';

import 'complaints_screens.dart';
import 'conversation_screen.dart';
import 'conversations_screen.dart';

/// Routes communes aux deux applications : messagerie et réclamations.
/// `/reclamations/nouvelle` accepte en `extra` : `{'missionId': ..., 'missionReference': ...}`.
List<GoRoute> engagementRoutes() => [
      GoRoute(path: '/messages', builder: (_, _) => const ConversationsScreen()),
      GoRoute(path: '/messages/:id', builder: (_, state) => ConversationScreen(conversationId: state.pathParameters['id']!)),
      GoRoute(path: '/reclamations', builder: (_, _) => const ComplaintsScreen()),
      GoRoute(
        path: '/reclamations/nouvelle',
        builder: (_, state) {
          final extra = state.extra is Map<String, String?> ? state.extra! as Map<String, String?> : const <String, String?>{};
          return ComplaintFormScreen(missionId: extra['missionId'], missionReference: extra['missionReference']);
        },
      ),
      GoRoute(path: '/reclamations/:id', builder: (_, state) => ComplaintScreen(complaintId: state.pathParameters['id']!)),
    ];

/// Destination d'une notification selon son lien profond (null : pas de destination).
String? notificationRoute(Map<String, String> data) {
  if (data['conversationId'] != null) return '/messages/${data['conversationId']}';
  if (data['complaintId'] != null) return '/reclamations/${data['complaintId']}';
  if (data['missionId'] != null) return '/missions/${data['missionId']}';
  return null;
}
