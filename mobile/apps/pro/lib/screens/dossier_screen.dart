import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

const _activityItems = {'BUSINESS_NAME', 'COMPANY_REG_NUMBER', 'CATEGORY', 'ZONE', 'HOURS'};

/// P-03 à P-08 : liste des étapes du dossier professionnel et envoi pour vérification.
class DossierScreen extends ConsumerStatefulWidget {
  const DossierScreen({super.key});

  @override
  ConsumerState<DossierScreen> createState() => _DossierScreenState();
}

class _DossierScreenState extends ConsumerState<DossierScreen> {
  bool _submitting = false;

  Future<void> _submit() async {
    final messenger = ScaffoldMessenger.of(context);
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    setState(() => _submitting = true);
    try {
      await ref.read(apiProvider).submitProProfile();
      messenger.showSnackBar(SnackBar(content: Text(l.signupSubmitted)));
      // Le nouveau statut fait basculer l'application sur l'écran de suivi.
      await ref.read(sessionProvider.notifier).reloadMe();
    } on Object catch (e) {
      ref.invalidate(proProfileProvider);
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final profile = ref.watch(proProfileProvider);
    // Nom ou photo modifiés : la liste des éléments manquants est recalculée par le serveur.
    ref.listen(sessionProvider, (_, _) => ref.invalidate(proProfileProvider));
    return Scaffold(
      appBar: AppBar(
        title: Text(l.dossierTitle),
        actions: [IconButton(tooltip: CommonLocalizations.of(context).profileTitle, icon: const Icon(Icons.person_outline), onPressed: () => context.push('/compte'))],
      ),
      body: AsyncBody(
        value: profile,
        onRetry: () => ref.invalidate(proProfileProvider),
        builder: (p) => RefreshIndicator(
          onRefresh: () => ref.refresh(proProfileProvider.future),
          child: _Checklist(profile: p, submitting: _submitting, onSubmit: _submit),
        ),
      ),
    );
  }
}

class _Checklist extends ConsumerWidget {
  const _Checklist({required this.profile, required this.submitting, required this.onSubmit});

  final ProProfile? profile;
  final bool submitting;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    final me = (ref.watch(sessionProvider).value as SignedIn?)?.me;
    // Dossier pas encore commencé : seules les informations personnelles peuvent déjà être complètes.
    final missing = profile?.missing ?? [if (me?.avatarUrl == null) 'PHOTO', 'BUSINESS_NAME', 'CATEGORY', 'ZONE', 'HOURS'];
    final initials = [me?.firstName, me?.lastName].whereType<String>().where((s) => s.isNotEmpty).map((s) => s[0].toUpperCase()).join();
    final note = profile?.verificationStatus == 'INFO_REQUESTED' ? profile?.lastDecisionNote : null;

    return ListView(
      padding: const EdgeInsets.all(IneedSpacing.s4),
      children: [
        Text(l.dossierSubtitle, style: Theme.of(context).textTheme.bodyLarge),
        if (note != null) ...[
          const SizedBox(height: IneedSpacing.s4),
          Card(
            color: c.warningSoft,
            child: Padding(
              padding: const EdgeInsets.all(IneedSpacing.s4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l.verificationInfoRequestedTitle, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: c.onWarningSoft)),
                  const SizedBox(height: IneedSpacing.s2),
                  Text(l.verificationInfoRequestedBody(note), style: TextStyle(color: c.onWarningSoft)),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: IneedSpacing.s4),
        _StepTile(
          icon: Icons.badge_outlined,
          title: l.dossierStepInfo,
          done: !missing.contains('NAMES'),
          onTap: () => context.push('/compte/nom'),
        ),
        _StepTile(
          icon: Icons.handyman_outlined,
          title: l.dossierStepActivity,
          done: !missing.any(_activityItems.contains),
          onTap: () => context.push('/dossier/activite'),
        ),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(IneedSpacing.s4),
            child: Row(
              children: [
                AvatarPicker(avatarUrl: me?.avatarUrl, initials: initials.isEmpty ? '?' : initials, size: 64),
                const SizedBox(width: IneedSpacing.s4),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(l.dossierStepPhoto, style: Theme.of(context).textTheme.titleMedium),
                      _StatusLabel(done: !missing.contains('PHOTO')),
                      const SizedBox(height: IneedSpacing.s1),
                      Text(l.signupPhotoHelp, style: Theme.of(context).textTheme.bodySmall),
                    ],
                  ),
                ),
              ],
            ),
          ),
        ),
        _StepTile(
          icon: Icons.description_outlined,
          title: l.dossierStepDocuments,
          done: profile != null && !missing.any((m) => m.startsWith('DOCUMENT:')),
          // Les justificatifs requis dépendent du type de compte choisi dans « Mon activité ».
          onTap: profile == null ? () => context.push('/dossier/activite') : () => context.push('/dossier/justificatifs'),
        ),
        const SizedBox(height: IneedSpacing.s6),
        FilledButton(
          onPressed: profile?.canSubmit == true && !submitting ? onSubmit : null,
          child: submitting ? const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2)) : Text(l.signupSubmit),
        ),
        if (profile?.canSubmit != true) ...[
          const SizedBox(height: IneedSpacing.s2),
          Text(l.dossierSubmitHelp, textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        ],
      ],
    );
  }
}

class _StepTile extends StatelessWidget {
  const _StepTile({required this.icon, required this.title, required this.done, required this.onTap});

  final IconData icon;
  final String title;
  final bool done;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: Icon(icon),
        title: Text(title),
        subtitle: _StatusLabel(done: done),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      ),
    );
  }
}

class _StatusLabel extends StatelessWidget {
  const _StatusLabel({required this.done});

  final bool done;

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(done ? Icons.check_circle : Icons.radio_button_unchecked, size: 16, color: done ? c.success : c.textMuted),
        const SizedBox(width: IneedSpacing.s1),
        Text(done ? l.dossierStepDone : l.dossierStepTodo, style: TextStyle(color: done ? c.success : c.textMuted)),
      ],
    );
  }
}
