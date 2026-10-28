import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_shared/ineed_shared.dart';

import 'dev_status_screen.dart';
import 'screens/home_screen.dart';
import 'screens/onboarding_screen.dart';
import 'screens/splash_screen.dart';

/// Écrans accessibles sans être connecté.
const publicRoutes = {'/bienvenue', '/connexion', '/connexion/code'};

class OtpRouteArgs {
  const OtpRouteArgs(this.phone, this.challenge);
  final String phone;
  final OtpChallenge challenge;
}

/// Destination imposée selon l'état de session (null : rester sur place).
String? clientRedirect(AsyncValue<SessionState> session, String location) {
  if (!session.hasValue) return location == '/' ? null : '/';
  final state = session.requireValue;
  if (state is SignedOut) return publicRoutes.contains(location) ? null : '/bienvenue';
  final me = (state as SignedIn).me;
  if (!me.profileComplete) return location == '/profil/completer' ? null : '/profil/completer';
  if (location == '/' || location == '/profil/completer' || publicRoutes.contains(location)) return '/accueil';
  return null;
}

/// Relaie les changements de session au routeur.
class _SessionListenable extends ChangeNotifier {
  _SessionListenable(Ref ref) {
    ref.listen(sessionProvider, (_, _) => notifyListeners());
  }
}

final routerProvider = Provider.family<GoRouter, AppEnvironment>((ref, env) {
  return GoRouter(
    initialLocation: '/',
    refreshListenable: _SessionListenable(ref),
    redirect: (context, state) => clientRedirect(ref.read(sessionProvider), state.matchedLocation),
    routes: [
      GoRoute(path: '/', builder: (_, _) => const SplashScreen()),
      GoRoute(path: '/bienvenue', builder: (context, _) => OnboardingScreen(onStart: () => context.go('/connexion'))),
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
      GoRoute(path: '/profil/completer', builder: (context, _) => CompleteProfileScreen(onDone: () => context.go('/accueil'))),
      GoRoute(path: '/accueil', builder: (_, _) => const HomeScreen()),
      GoRoute(
        path: '/compte',
        builder: (context, _) => AccountScreen(
          onEditName: () => context.push('/compte/nom'),
          onOpenDevices: () => context.push('/compte/appareils'),
          onDeleteAccount: () => context.push('/compte/supprimer'),
          extraTiles: [
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
      GoRoute(path: '/compte/supprimer', builder: (context, _) => DeleteAccountScreen(onDeleted: () => context.go('/bienvenue'))),
      GoRoute(
        path: '/compte/etat-api',
        builder: (context, _) => Consumer(builder: (context, ref, _) => DevStatusScreen(environment: env, checkApi: ref.read(apiProvider).readiness)),
      ),
    ],
  );
});
