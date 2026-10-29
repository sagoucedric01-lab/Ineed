import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';

import 'dev_status_screen.dart';
import 'l10n/gen/app_localizations.dart';
import 'providers.dart';
import 'screens/activity_screen.dart';
import 'screens/dashboard_screen.dart';
import 'screens/documents_screen.dart';
import 'screens/dossier_screen.dart';
import 'screens/earnings_screen.dart';
import 'screens/mission_screen.dart';
import 'screens/offer_screen.dart';
import 'screens/quote_editor_screen.dart';
import 'screens/reviews_screen.dart';
import 'screens/status_screen.dart';

const publicRoutes = {'/connexion', '/connexion/code'};

class OtpRouteArgs {
  const OtpRouteArgs(this.phone, this.challenge);
  final String phone;
  final OtpChallenge challenge;
}

/// Espace du professionnel selon le statut de son dossier.
String proHome(String? status) => switch (status) {
      'APPROVED' => '/tableau-de-bord',
      'SUBMITTED' || 'REJECTED' || 'SUSPENDED' => '/statut',
      _ => '/dossier',
    };

String? proRedirect(AsyncValue<SessionState> session, String location) {
  if (!session.hasValue) return location == '/' ? null : '/';
  final state = session.requireValue;
  if (state is SignedOut) return publicRoutes.contains(location) ? null : '/connexion';
  final me = (state as SignedIn).me;
  if (!me.profileComplete) return location == '/profil/completer' ? null : '/profil/completer';
  final home = proHome(me.proStatus);
  if (location == '/' || location == '/profil/completer' || publicRoutes.contains(location)) return home;
  // Chaque espace n'est accessible que dans le statut correspondant.
  if (location.startsWith('/dossier') && !isEditableStatus(me.proStatus)) return home;
  if ((location == '/statut' || location == '/tableau-de-bord') && location != home) return home;
  return null;
}

class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider.family<GoRouter, AppEnvironment>((ref, env) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _SessionListenable(ref),
    redirect: (context, state) => proRedirect(ref.read(sessionProvider), state.matchedLocation),
    routes: [
      GoRoute(path: '/', builder: (_, _) => const SplashScreen(pro: true)),
      GoRoute(
        path: '/connexion',
        builder: (context, _) => PhoneScreen(onCodeSent: (phone, challenge) => context.push('/connexion/code', extra: OtpRouteArgs(phone, challenge))),
      ),
      GoRoute(
        path: '/connexion/code',
        redirect: (_, state) => state.extra is OtpRouteArgs ? null : '/connexion',
        builder: (context, state) {
          final args = state.extra! as OtpRouteArgs;
          return OtpScreen(phone: args.phone, challenge: args.challenge, onLoggedIn: (_) => context.go('/'));
        },
      ),
      GoRoute(path: '/profil/completer', builder: (context, _) => CompleteProfileScreen(onDone: () => context.go('/'))),
      GoRoute(path: '/dossier', builder: (_, _) => const DossierScreen()),
      GoRoute(path: '/dossier/activite', builder: (_, _) => const ActivityScreen()),
      GoRoute(path: '/dossier/justificatifs', builder: (_, _) => const DocumentsScreen()),
      GoRoute(path: '/statut', builder: (_, _) => const StatusScreen()),
      GoRoute(path: '/tableau-de-bord', builder: (_, _) => const DashboardScreen()),
      GoRoute(path: '/demandes-recues/:id', builder: (_, state) => OfferScreen(offerId: state.pathParameters['id']!)),
      GoRoute(path: '/missions/:id', builder: (_, state) => ProMissionScreen(missionId: state.pathParameters['id']!)),
      GoRoute(
        path: '/missions/:id/devis',
        builder: (_, state) => QuoteEditorScreen(missionId: state.pathParameters['id']!, supplement: state.uri.queryParameters['supplement'] == '1'),
      ),
      GoRoute(path: '/revenus', builder: (_, _) => const EarningsScreen()),
      GoRoute(path: '/avis', builder: (_, _) => const ProReviewsScreen()),
      ...engagementRoutes(),
      GoRoute(
        path: '/compte',
        builder: (context, _) => AccountScreen(
          onEditName: () => context.push('/compte/nom'),
          onOpenDevices: () => context.push('/compte/appareils'),
          onDeleteAccount: () => context.push('/compte/supprimer'),
          extraTiles: [
            ListTile(
              leading: const Icon(Icons.assignment_ind_outlined),
              title: Text(AppLocalizations.of(context).dossierTitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go('/'),
            ),
            ListTile(
              leading: const Icon(Icons.star_outline),
              title: Text(AppLocalizations.of(context).reviewsTitlePro),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/avis'),
            ),
            ListTile(
              leading: const Icon(Icons.support_agent),
              title: Text(CommonLocalizations.of(context).complaintsTitle),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.push('/reclamations'),
            ),
            if (!env.isProduction)
              ListTile(
                leading: const Icon(Icons.wifi_tethering),
                title: Text(CommonLocalizations.of(context).apiStatusLink),
                onTap: () => context.push('/compte/etat-api'),
              ),
          ],
        ),
      ),
      GoRoute(path: '/compte/nom', builder: (context, _) => CompleteProfileScreen(onDone: () => context.pop())),
      GoRoute(path: '/compte/appareils', builder: (_, _) => const DevicesScreen()),
      GoRoute(path: '/compte/supprimer', builder: (context, _) => DeleteAccountScreen(onDeleted: () => context.go('/connexion'))),
      GoRoute(
        path: '/compte/etat-api',
        builder: (context, _) => Consumer(builder: (context, ref, _) => DevStatusScreen(environment: env, checkApi: ref.read(apiProvider).readiness)),
      ),
    ],
  );
});
