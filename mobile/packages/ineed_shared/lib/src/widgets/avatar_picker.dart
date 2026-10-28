import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../../l10n/gen/common_localizations.dart';
import '../errors.dart';
import '../session/session.dart';

/// Sélection d'une photo (appareil photo ou galerie). Remplaçable dans les tests.
typedef PhotoPicker = Future<Uint8List?> Function(ImageSource source);

final photoPickerProvider = Provider<PhotoPicker>((ref) => (source) async {
      // Photo réduite et compressée avant envoi ; le serveur la ré-encode et retire ses métadonnées.
      final file = await ImagePicker().pickImage(source: source, maxWidth: 1600, maxHeight: 1600, imageQuality: 85);
      return file?.readAsBytes();
    });

/// Type d'image d'après sa signature binaire (le serveur refuse tout type annoncé qui ne correspond pas).
String? imageMimeType(Uint8List b) {
  if (b.length > 3 && b[0] == 0xFF && b[1] == 0xD8 && b[2] == 0xFF) return 'image/jpeg';
  if (b.length > 8 && b[0] == 0x89 && b[1] == 0x50 && b[2] == 0x4E && b[3] == 0x47) return 'image/png';
  if (b.length > 12 && String.fromCharCodes(b.sublist(0, 4)) == 'RIFF' && String.fromCharCodes(b.sublist(8, 12)) == 'WEBP') return 'image/webp';
  return null;
}

/// Photo de profil : affiche la photo ou les initiales, et permet de la changer.
class AvatarPicker extends ConsumerStatefulWidget {
  const AvatarPicker({required this.avatarUrl, required this.initials, this.size = 88, super.key});

  final String? avatarUrl;
  final String initials;
  final double size;

  @override
  ConsumerState<AvatarPicker> createState() => _AvatarPickerState();
}

class _AvatarPickerState extends ConsumerState<AvatarPicker> {
  bool _busy = false;

  Future<void> _change() async {
    final l = CommonLocalizations.of(context);
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(l.photoTake), onTap: () => Navigator.pop(context, ImageSource.camera)),
            ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(l.photoGallery), onTap: () => Navigator.pop(context, ImageSource.gallery)),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;
    final messenger = ScaffoldMessenger.of(context);
    try {
      final bytes = await ref.read(photoPickerProvider)(source);
      if (bytes == null) return;
      final mime = imageMimeType(bytes);
      if (mime == null) {
        messenger.showSnackBar(SnackBar(content: Text(l.errorFileType('JPG, PNG, WebP'))));
        return;
      }
      setState(() => _busy = true);
      final api = ref.read(apiProvider);
      final fileId = await api.uploadFile(purpose: 'AVATAR', bytes: bytes, mimeType: mime);
      ref.read(sessionProvider.notifier).updateMe(await api.setAvatar(fileId));
      messenger.showSnackBar(SnackBar(content: Text(l.profileSaved)));
    } on Object catch (e) {
      messenger.showSnackBar(SnackBar(content: Text(failureMessage(l, e))));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = CommonLocalizations.of(context);
    final c = context.ineedColors;
    return Semantics(
      button: true,
      label: l.profilePhotoChange,
      child: InkWell(
        customBorder: const CircleBorder(),
        onTap: _busy ? null : _change,
        child: Stack(
          alignment: Alignment.center,
          children: [
            CircleAvatar(
              radius: widget.size / 2,
              backgroundColor: c.actionSoft,
              foregroundImage: widget.avatarUrl != null ? NetworkImage(widget.avatarUrl!) : null,
              // Photo injoignable (réseau faible) : les initiales restent affichées.
              onForegroundImageError: widget.avatarUrl != null ? (_, _) {} : null,
              child: Text(widget.initials, style: Theme.of(context).textTheme.titleLarge?.copyWith(color: c.onActionSoft)),
            ),
            if (_busy) const CircularProgressIndicator(),
            Positioned(
              right: 0,
              bottom: 0,
              child: CircleAvatar(radius: 16, backgroundColor: c.action, child: Icon(Icons.photo_camera_outlined, size: 18, color: c.onAction)),
            ),
          ],
        ),
      ),
    );
  }
}
