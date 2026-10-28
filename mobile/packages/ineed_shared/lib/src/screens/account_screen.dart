import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../session/session.dart';
import '../widgets/avatar_picker.dart';

/// C-29 : mon compte (photo, nom, téléphone, appareils, déconnexion, suppression).
class AccountScreen extends ConsumerWidget {
  const AccountScreen({required this.onEditName, required this.onOpenDevices, required this.onDeleteAccount, this.extraTiles = const [], super.key});

  final VoidCallback onEditName;
  final VoidCallback onOpenDevices;
  final VoidCallback onDeleteAccount;

  /// Entrées propres à l'application (ex. « Mon dossier professionnel »).
  final List<Widget> extraTiles;

  Future<void> _logout(BuildContext context, WidgetRef ref) async {
    final l = CommonLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        content: Text(l.profileLogoutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l.actionCancel)),
          TextButton(onPressed: () => Navigator.pop(context, true), child: Text(l.profileLogout)),
        ],
      ),
    );
    if (ok == true) await ref.read(sessionProvider.notifier).logout();
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = CommonLocalizations.of(context);
    final session = ref.watch(sessionProvider).value;
    if (session is! SignedIn) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final me = session.me;
    final initials = [me.firstName, me.lastName].whereType<String>().where((s) => s.isNotEmpty).map((s) => s[0].toUpperCase()).join();
    final name = [me.firstName, me.lastName].whereType<String>().join(' ');
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.profileTitle)),
      body: ListView(
        padding: const EdgeInsets.symmetric(vertical: IneedSpacing.s4),
        children: [
          Center(child: AvatarPicker(avatarUrl: me.avatarUrl, initials: initials.isEmpty ? '?' : initials)),
          const SizedBox(height: IneedSpacing.s3),
          Center(child: Text(name, style: Theme.of(context).textTheme.titleLarge)),
          const SizedBox(height: IneedSpacing.s4),
          ListTile(leading: const Icon(Icons.badge_outlined), title: Text('${l.profileFirstName} et ${l.profileLastName.toLowerCase()}'), subtitle: Text(name), trailing: const Icon(Icons.chevron_right), onTap: onEditName),
          ListTile(leading: const Icon(Icons.phone_outlined), title: Text(l.profilePhone), subtitle: Text(me.phone == null ? '' : formatPhone(me.phone!))),
          ...extraTiles,
          ListTile(leading: const Icon(Icons.devices_outlined), title: Text(l.profileDevices), trailing: const Icon(Icons.chevron_right), onTap: onOpenDevices),
          const Divider(),
          ListTile(leading: const Icon(Icons.logout), title: Text(l.profileLogout), onTap: () => _logout(context, ref)),
          ListTile(
            leading: Icon(Icons.delete_outline, color: c.danger),
            title: Text(l.profileDeleteAccount, style: TextStyle(color: c.danger)),
            onTap: onDeleteAccount,
          ),
        ],
      ),
    );
  }
}
