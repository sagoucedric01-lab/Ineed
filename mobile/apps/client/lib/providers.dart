import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';

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
