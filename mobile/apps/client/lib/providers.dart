import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:url_launcher/url_launcher.dart';

final categoriesProvider = FutureProvider.autoDispose<List<Category>>((ref) => ref.read(apiProvider).categories());

final zonesProvider = FutureProvider.autoDispose<List<Zone>>((ref) => ref.read(apiProvider).zones());

final addressesProvider = FutureProvider.autoDispose<List<Address>>((ref) => ref.read(apiProvider).addresses());

final recentSearchesProvider = FutureProvider.autoDispose<List<RecentSearch>>((ref) => ref.read(apiProvider).recentSearches());

final activeRequestsProvider = FutureProvider.autoDispose<List<RequestSummary>>((ref) => ref.read(apiProvider).requests());

final requestProvider = FutureProvider.autoDispose.family<ServiceRequest, String>((ref, id) => ref.read(apiProvider).request(id));

final notificationsProvider = FutureProvider.autoDispose<NotificationsPage>((ref) => ref.read(apiProvider).notifications());

/// Adresse d'intervention choisie sur l'accueil (par défaut : la plus récente des adresses enregistrées).
class SelectedAddress extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String id) => state = id;
}

final selectedAddressIdProvider = NotifierProvider<SelectedAddress, String?>(SelectedAddress.new);

final selectedAddressProvider = Provider.autoDispose<AsyncValue<Address?>>((ref) {
  final id = ref.watch(selectedAddressIdProvider);
  return ref.watch(addressesProvider).whenData((list) => list.where((a) => a.id == id).firstOrNull ?? list.firstOrNull);
});

final requestOffersProvider = FutureProvider.autoDispose.family<RequestOffers, String>((ref, id) => ref.read(apiProvider).requestOffers(id));

final activeMissionsProvider = FutureProvider.autoDispose<List<MissionSummary>>((ref) => ref.read(apiProvider).missions());

final missionProvider = FutureProvider.autoDispose.family<Mission, String>((ref, id) => ref.read(apiProvider).mission(id));

/// Statuts pendant lesquels l'écran d'une demande se rafraîchit seul.
const liveRequestStatuses = {'PUBLISHED', 'MATCHING', 'OFFERS_RECEIVED', 'PROVISIONALLY_RESERVED', 'AWAITING_CLIENT_CONFIRMATION'};

/// Rafraîchissement automatique (en attendant les notifications push de la phase 8).
const liveRefreshInterval = Duration(seconds: 5);

/// Ouvre la page de paiement du prestataire (navigateur ou application de l'opérateur). Remplacé dans les tests.
typedef CheckoutLauncher = Future<bool> Function(Uri url);

final checkoutLauncherProvider = Provider<CheckoutLauncher>((ref) => (url) => launchUrl(url, mode: LaunchMode.externalApplication));
