import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';

/// C-07 : mes adresses. En mode sélection ([select]), toucher une adresse la choisit et revient à l'écran précédent.
class AddressesScreen extends ConsumerWidget {
  const AddressesScreen({this.select = false, super.key});

  final bool select;

  Future<void> _delete(BuildContext context, WidgetRef ref, Address a) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l.addressDeleteConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(common.actionCancel)),
          TextButton(onPressed: () => Navigator.pop(context, true), child: Text(common.actionDelete)),
        ],
      ),
    );
    if (ok != true || !context.mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(apiProvider).deleteAddress(a.id);
      ref.invalidate(addressesProvider);
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    }
  }

  Future<void> _add(BuildContext context, WidgetRef ref) async {
    final created = await context.push<Address>('/adresses/nouvelle');
    if (created == null) return;
    ref.invalidate(addressesProvider);
    if (select) {
      ref.read(selectedAddressIdProvider.notifier).select(created.id);
      if (context.mounted) context.pop(created);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final selected = ref.watch(selectedAddressProvider).value;
    return Scaffold(
      appBar: AppBar(title: Text(l.addressesTitle)),
      floatingActionButton: FloatingActionButton.extended(onPressed: () => _add(context, ref), icon: const Icon(Icons.add_location_alt_outlined), label: Text(l.addressAdd)),
      body: ref.watch(addressesProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(common, e), tone: IneedBannerTone.danger, actionLabel: common.actionRetry, onAction: () => ref.invalidate(addressesProvider))),
            data: (list) => list.isEmpty
                ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(l.addressesEmpty, textAlign: TextAlign.center)))
                : ListView(
                    padding: const EdgeInsets.only(bottom: 96),
                    children: [
                      for (final a in list)
                        ListTile(
                          leading: Icon(select && selected?.id == a.id ? Icons.radio_button_checked : Icons.place_outlined),
                          title: Text(a.title),
                          subtitle: Text([a.zoneName ?? a.cityName, if (a.landmark != null && a.landmark != a.title) a.landmark!].join(' · '), maxLines: 2),
                          onTap: () async {
                            if (select) {
                              ref.read(selectedAddressIdProvider.notifier).select(a.id);
                              context.pop(a);
                            } else {
                              final edited = await context.push<Address>('/adresses/${a.id}', extra: a);
                              if (edited != null) ref.invalidate(addressesProvider);
                            }
                          },
                          trailing: PopupMenuButton<String>(
                            onSelected: (v) async {
                              if (v == 'edit') {
                                final edited = await context.push<Address>('/adresses/${a.id}', extra: a);
                                if (edited != null) ref.invalidate(addressesProvider);
                              } else {
                                if (context.mounted) await _delete(context, ref, a);
                              }
                            },
                            itemBuilder: (_) => [
                              PopupMenuItem(value: 'edit', child: Text(common.actionEdit)),
                              PopupMenuItem(value: 'delete', child: Text(l.addressDelete)),
                            ],
                          ),
                        ),
                    ],
                  ),
          ),
    );
  }
}
