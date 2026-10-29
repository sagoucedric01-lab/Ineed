import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';
import '../widgets/avatar_picker.dart';
import 'providers.dart';

String complaintCategoryLabel(CommonLocalizations l, ComplaintCategory c) => switch (c) {
      ComplaintCategory.quality => l.complaintCatQuality,
      ComplaintCategory.price => l.complaintCatPrice,
      ComplaintCategory.noShow => l.complaintCatNoShow,
      ComplaintCategory.damage => l.complaintCatDamage,
      ComplaintCategory.payment => l.complaintCatPayment,
      ComplaintCategory.behaviour => l.complaintCatBehaviour,
      ComplaintCategory.other => l.complaintCatOther,
    };

String complaintStatusLabel(CommonLocalizations l, String status) => switch (status) {
      'IN_REVIEW' => l.complaintStatusInReview,
      'WAITING_USER' => l.complaintStatusWaitingUser,
      'RESOLVED' => l.complaintStatusResolved,
      'REJECTED' => l.complaintStatusRejected,
      _ => l.complaintStatusOpen,
    };

/// C-29 / P-21 : mes réclamations et l'accès à l'assistance.
class ComplaintsScreen extends ConsumerWidget {
  const ComplaintsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l = CommonLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.complaintsTitle)),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () async {
          await context.push('/reclamations/nouvelle');
          ref.invalidate(complaintsProvider);
        },
        icon: const Icon(Icons.support_agent),
        label: Text(l.complaintNewGeneral),
      ),
      body: ref.watch(complaintsProvider).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(l, e), tone: IneedBannerTone.danger, actionLabel: l.actionRetry, onAction: () => ref.invalidate(complaintsProvider))),
            data: (list) => list.isEmpty
                ? Center(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s6), child: Text(l.complaintsEmpty, textAlign: TextAlign.center)))
                : ListView(children: [
                    for (final c in list)
                      ListTile(
                        title: Text(l.complaintReference(c.reference)),
                        subtitle: Text([complaintCategoryLabel(l, c.category), if (c.missionReference != null) l.complaintMission(c.missionReference!), formatAbidjanDateTime(c.createdAt)].join(' · ')),
                        trailing: Text(complaintStatusLabel(l, c.status), style: Theme.of(context).textTheme.labelMedium),
                        onTap: () async {
                          await context.push('/reclamations/${c.id}');
                          ref.invalidate(complaintsProvider);
                        },
                      ),
                  ]),
          ),
    );
  }
}

/// C-28 : nouvelle réclamation, liée à une mission ou générale (assistance).
class ComplaintFormScreen extends ConsumerStatefulWidget {
  const ComplaintFormScreen({this.missionId, this.missionReference, super.key});

  final String? missionId;
  final String? missionReference;

  @override
  ConsumerState<ComplaintFormScreen> createState() => _ComplaintFormScreenState();
}

class _ComplaintFormScreenState extends ConsumerState<ComplaintFormScreen> {
  final _description = TextEditingController();
  late ComplaintCategory _category = widget.missionId == null ? ComplaintCategory.other : ComplaintCategory.quality;
  final List<String> _files = [];
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _description.dispose();
    super.dispose();
  }

  Future<void> _addPhoto() async {
    final l = CommonLocalizations.of(context);
    final bytes = await ref.read(photoPickerProvider)(ImageSource.gallery);
    if (bytes == null) return;
    final mime = imageMimeType(bytes);
    if (mime == null) return;
    setState(() => _busy = true);
    try {
      final id = await ref.read(apiProvider).uploadFile(purpose: 'COMPLAINT_ATTACHMENT', bytes: bytes, mimeType: mime);
      setState(() => _files.add(id));
    } on Object catch (e) {
      setState(() => _error = failureMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _submit() async {
    final l = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (_description.text.trim().length < 10) {
      setState(() => _error = l.complaintDescriptionTooShort);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      final c = await ref.read(apiProvider).createComplaint(category: _category, description: _description.text, missionId: widget.missionId, fileIds: _files);
      messenger.showSnackBar(SnackBar(content: Text(l.complaintSent(c.summary.reference))));
      if (mounted) context.pushReplacement('/reclamations/${c.summary.id}');
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(l, e));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    return Scaffold(
      appBar: AppBar(title: Text(widget.missionId == null ? l.complaintNewGeneral : l.complaintNew)),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          if (widget.missionReference != null) Text(l.complaintMission(widget.missionReference!), style: text.titleMedium),
          if (widget.missionId != null) Padding(padding: const EdgeInsets.symmetric(vertical: IneedSpacing.s2), child: IneedBanner(message: l.complaintDisputeNote)),
          DropdownButtonFormField<ComplaintCategory>(
            initialValue: _category,
            decoration: InputDecoration(labelText: l.complaintCategory),
            items: [for (final c in ComplaintCategory.values) DropdownMenuItem(value: c, child: Text(complaintCategoryLabel(l, c)))],
            onChanged: (c) => setState(() => _category = c ?? _category),
          ),
          const SizedBox(height: IneedSpacing.s3),
          TextField(controller: _description, minLines: 4, maxLines: 8, maxLength: 4000, decoration: InputDecoration(labelText: l.complaintDescription, helperText: l.complaintDescriptionHint, helperMaxLines: 3)),
          const SizedBox(height: IneedSpacing.s2),
          // Les boutons du thème occupent toute la largeur : pas de Row ici.
          OutlinedButton.icon(onPressed: _busy || _files.length >= 5 ? null : _addPhoto, icon: const Icon(Icons.add_a_photo_outlined), label: Text(l.complaintAddPhoto)),
          if (_files.isNotEmpty) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s2), child: Text(l.complaintPhotos('${_files.length}'))),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: IneedBanner(message: _error!, tone: IneedBannerTone.danger)),
          const SizedBox(height: IneedSpacing.s4),
          IneedButton(label: l.complaintSubmit, loading: _busy, onPressed: _submit),
        ],
      ),
    );
  }
}

/// C-30 : fil d'une réclamation avec le support Ineed.
class ComplaintScreen extends ConsumerStatefulWidget {
  const ComplaintScreen({required this.complaintId, super.key});

  final String complaintId;

  @override
  ConsumerState<ComplaintScreen> createState() => _ComplaintScreenState();
}

class _ComplaintScreenState extends ConsumerState<ComplaintScreen> {
  final _reply = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _reply.dispose();
    super.dispose();
  }

  Future<void> _send() async {
    final l = CommonLocalizations.of(context);
    final messenger = ScaffoldMessenger.of(context);
    if (_reply.text.trim().isEmpty) return;
    setState(() => _busy = true);
    try {
      await ref.read(apiProvider).replyToComplaint(widget.complaintId, _reply.text);
      _reply.clear();
      ref.invalidate(complaintProvider(widget.complaintId));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(l, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    return Scaffold(
      appBar: AppBar(title: Text(l.complaintsTitle)),
      body: ref.watch(complaintProvider(widget.complaintId)).when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => Center(child: IneedBanner(message: failureMessage(l, e), tone: IneedBannerTone.danger, actionLabel: l.actionRetry, onAction: () => ref.invalidate(complaintProvider(widget.complaintId)))),
            data: (cp) => ListView(
              padding: const EdgeInsets.all(IneedSpacing.s4),
              children: [
                Text(l.complaintReference(cp.summary.reference), style: text.titleMedium),
                Text([complaintCategoryLabel(l, cp.summary.category), complaintStatusLabel(l, cp.summary.status), if (cp.summary.missionReference != null) l.complaintMission(cp.summary.missionReference!)].join(' · '), style: text.bodySmall?.copyWith(color: c.textMuted)),
                const SizedBox(height: IneedSpacing.s3),
                Card(child: Padding(padding: const EdgeInsets.all(IneedSpacing.s3), child: Text(cp.description))),
                for (final m in cp.messages)
                  ListTile(
                    contentPadding: EdgeInsets.zero,
                    leading: Icon(m.fromSupport ? Icons.support_agent : Icons.person_outline, color: m.fromSupport ? c.action : c.textMuted),
                    title: Text(m.fromSupport ? l.complaintSupport : l.complaintMe, style: text.labelLarge),
                    subtitle: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                      if (m.body.isNotEmpty) Text(m.body),
                      if (m.fileUrl != null) Padding(padding: const EdgeInsets.only(top: 4), child: Image.network(m.fileUrl!, height: 140, errorBuilder: (_, _, _) => Text(l.complaintAttachment))),
                      Text(formatAbidjanDateTime(m.createdAt), style: text.bodySmall),
                    ]),
                  ),
                if (cp.resolution != null && !cp.summary.isOpen) IneedBanner(message: l.complaintDecision(cp.resolution!), tone: IneedBannerTone.success),
                const SizedBox(height: IneedSpacing.s3),
                if (cp.summary.isOpen) ...[
                  TextField(controller: _reply, minLines: 2, maxLines: 6, maxLength: 4000, decoration: InputDecoration(labelText: l.complaintReplyHint)),
                  IneedButton(label: l.complaintReply, loading: _busy, onPressed: _send),
                ] else
                  Text(l.complaintClosed, style: text.bodySmall),
              ],
            ),
          ),
    );
  }
}
