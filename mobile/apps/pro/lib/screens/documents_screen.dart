import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../widgets/async_body.dart';

typedef _DocumentsData = ({ProProfile profile, List<DocumentType> types});

final _documentsDataProvider = FutureProvider.autoDispose<_DocumentsData?>((ref) async {
  final profile = await ref.watch(proProfileProvider.future);
  if (profile == null) return null;
  return (profile: profile, types: await ref.watch(documentTypesProvider.future));
});

enum _Source { camera, gallery, pdf }

/// Même limite que le serveur, vérifiée avant l'envoi pour éviter un transfert inutile.
const _maxBytes = 10 * 1024 * 1024;

bool _isPdf(Uint8List b) => b.length > 4 && String.fromCharCodes(b.sublist(0, 5)) == '%PDF-';

/// P-07 : justificatifs (photo ou PDF), privés et vérifiés par l'équipe Ineed.
class DocumentsScreen extends ConsumerStatefulWidget {
  const DocumentsScreen({super.key});

  @override
  ConsumerState<DocumentsScreen> createState() => _DocumentsScreenState();
}

class _DocumentsScreenState extends ConsumerState<DocumentsScreen> {
  String? _uploading;

  Future<void> _add(DocumentType type) async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final source = await showModalBottomSheet<_Source>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(common.photoTake), onTap: () => Navigator.pop(context, _Source.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(common.photoGallery), onTap: () => Navigator.pop(context, _Source.gallery)),
            ListTile(leading: const Icon(Icons.picture_as_pdf_outlined), title: Text(l.documentChoosePdf), onTap: () => Navigator.pop(context, _Source.pdf)),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = switch (source) {
        _Source.camera => await ref.read(photoPickerProvider)(ImageSource.camera),
        _Source.gallery => await ref.read(photoPickerProvider)(ImageSource.gallery),
        _Source.pdf => await ref.read(pdfPickerProvider)(),
      };
      if (bytes == null) return;
      if (bytes.length > _maxBytes) {
        messenger.showSnackBar(SnackBar(content: Text(common.errorFileTooLarge(_maxBytes ~/ (1024 * 1024)))));
        return;
      }
      final mime = _isPdf(bytes) ? 'application/pdf' : imageMimeType(bytes);
      if (mime == null) {
        messenger.showSnackBar(SnackBar(content: Text(common.errorFileType('PDF, JPG, PNG, WebP'))));
        return;
      }
      setState(() => _uploading = type.code);
      final api = ref.read(apiProvider);
      final fileId = await api.uploadFile(purpose: 'VERIFICATION_DOC', bytes: bytes, mimeType: mime);
      await api.addDocument(type.code, fileId);
      ref.invalidate(proProfileProvider);
      messenger.showSnackBar(SnackBar(content: Text(l.documentAdded)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(common, e))));
    } finally {
      if (mounted) setState(() => _uploading = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    return Scaffold(
      appBar: AppBar(title: Text(l.dossierStepDocuments)),
      body: AsyncBody(
        value: ref.watch(_documentsDataProvider),
        onRetry: () => ref.invalidate(_documentsDataProvider),
        builder: (d) => d == null ? Center(child: Text(l.dossierSubmitHelp)) : _list(context, d),
      ),
    );
  }

  Widget _list(BuildContext context, _DocumentsData d) {
    final l = AppLocalizations.of(context);
    final c = context.ineedColors;
    // Types obligatoires d'abord.
    final types = [...d.types]..sort((a, b) => (b.requiredFor.contains(d.profile.kind) ? 1 : 0) - (a.requiredFor.contains(d.profile.kind) ? 1 : 0));
    return ListView(
      padding: const EdgeInsets.all(IneedSpacing.s4),
      children: [
        Text(l.signupDocumentsHelp, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: c.textMuted)),
        const SizedBox(height: IneedSpacing.s4),
        for (final type in types)
          Builder(builder: (context) {
            // Documents renvoyés du plus ancien au plus récent : le dernier dépôt fait foi.
            final doc = d.profile.documents.where((x) => x.typeCode == type.code).lastOrNull;
            final required = type.requiredFor.contains(d.profile.kind);
            final (label, bg, fg) = switch (doc?.status) {
              'PENDING' => (l.documentStatusPending, c.warningSoft, c.onWarningSoft),
              'APPROVED' => (l.documentStatusApproved, c.successSoft, c.onSuccessSoft),
              'REJECTED' => (l.documentStatusRejected, c.dangerSoft, c.onDangerSoft),
              _ => (l.documentStatusMissing, c.surfaceMuted, c.textMuted),
            };
            return Card(
              child: Padding(
                padding: const EdgeInsets.all(IneedSpacing.s4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        Expanded(child: Text(type.label, style: Theme.of(context).textTheme.titleMedium)),
                        Text(required ? l.signupDocumentRequired : l.signupDocumentOptional, style: Theme.of(context).textTheme.labelSmall),
                      ],
                    ),
                    const SizedBox(height: IneedSpacing.s2),
                    Chip(label: Text(label, style: TextStyle(color: fg)), backgroundColor: bg, side: BorderSide.none),
                    if (doc?.rejectionReason case final reason?) Text(reason, style: TextStyle(color: c.danger)),
                    const SizedBox(height: IneedSpacing.s2),
                    Align(
                      alignment: Alignment.centerRight,
                      child: _uploading == type.code
                          ? const CircularProgressIndicator()
                          : OutlinedButton.icon(
                              onPressed: _uploading == null ? () => _add(type) : null,
                              icon: const Icon(Icons.upload_file),
                              label: Text(doc == null ? l.signupDocumentUpload : l.signupDocumentReplace),
                            ),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
