import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:image_picker/image_picker.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';
import 'package:ineed_ui/ineed_ui.dart';

import '../l10n/gen/app_localizations.dart';
import '../providers.dart';
import '../services/voice_recorder.dart';
import '../widgets/slot_picker.dart';

/// Point d'entrée du formulaire : depuis l'accueil (mode seul), un métier, ou un brouillon à modifier.
class RequestFormArgs {
  const RequestFormArgs({required this.mode, this.categoryId, this.serviceId, this.window, this.draft});
  final RequestMode mode;
  final String? categoryId;
  final String? serviceId;
  final TimeWindow? window;
  final ServiceRequest? draft;
}

const _maxPhotos = 5;

/// Photo déjà envoyée (brouillon existant) ou choisie sur le téléphone.
class _Photo {
  _Photo.remote(RequestMedia m)
      : fileId = m.fileId,
        url = m.url,
        bytes = null;
  _Photo.local(Uint8List this.bytes)
      : fileId = null,
        url = null;
  String? fileId;
  final String? url;
  final Uint8List? bytes;
}

/// C-12 à C-15 : description du besoin, photos, note vocale, lieu, moment, budget ; puis relecture.
class RequestFormScreen extends ConsumerStatefulWidget {
  const RequestFormScreen({required this.args, super.key});

  final RequestFormArgs args;

  @override
  ConsumerState<RequestFormScreen> createState() => _RequestFormScreenState();
}

class _RequestFormScreenState extends ConsumerState<RequestFormScreen> {
  late String? _categoryId;
  late String? _serviceId;
  late RequestMode _mode;
  late TimeWindow _slot;
  late final TextEditingController _description;
  late final TextEditingController _budget;
  final List<_Photo> _photos = [];
  String? _voiceFileId;
  RecordedVoice? _voice;
  int? _voiceSeconds;
  bool _recording = false;
  int _recordingSeconds = 0;
  Timer? _recordTimer;
  Address? _address;
  String? _error;
  String? _progress;
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    final a = widget.args;
    final d = a.draft;
    _categoryId = d?.category.id ?? a.categoryId;
    _serviceId = d?.service?.id ?? a.serviceId;
    _mode = d?.mode ?? a.mode;
    _slot = d?.window ?? a.window ?? defaultSlot();
    _description = TextEditingController(text: d?.description);
    _budget = TextEditingController(text: d?.budgetXof?.toString());
    if (d != null) {
      _photos.addAll(d.media.where((m) => m.kind == 'PHOTO').map(_Photo.remote));
      final voice = d.media.where((m) => m.kind == 'VOICE').firstOrNull;
      _voiceFileId = voice?.fileId;
    }
  }

  @override
  void dispose() {
    _recordTimer?.cancel();
    if (_recording) unawaited(ref.read(voiceRecorderProvider).cancel());
    _description.dispose();
    _budget.dispose();
    super.dispose();
  }

  // ---------------------------------------------------------------- photos

  Future<void> _addPhoto() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_camera_outlined), title: Text(l.requestPhotoTake), onTap: () => Navigator.pop(context, ImageSource.camera)),
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: Text(l.requestPhotoGallery), onTap: () => Navigator.pop(context, ImageSource.gallery)),
        ]),
      ),
    );
    if (source == null || !mounted) return;
    final bytes = await ref.read(photoPickerProvider)(source);
    if (bytes == null || !mounted) return;
    if (imageMimeType(bytes) == null) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(common.errorFileType('JPG, PNG, WebP'))));
      return;
    }
    setState(() => _photos.add(_Photo.local(bytes)));
  }

  // ---------------------------------------------------------------- note vocale

  Future<void> _toggleRecording() async {
    final l = AppLocalizations.of(context);
    final recorder = ref.read(voiceRecorderProvider);
    if (_recording) {
      _recordTimer?.cancel();
      final voice = await recorder.stop();
      if (!mounted) return;
      setState(() {
        _recording = false;
        if (voice != null) {
          _voice = voice;
          _voiceSeconds = voice.seconds;
          _voiceFileId = null;
        }
      });
      return;
    }
    if (!await recorder.start()) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(l.requestMicDenied)));
      return;
    }
    setState(() {
      _recording = true;
      _recordingSeconds = 0;
    });
    _recordTimer = Timer.periodic(const Duration(seconds: 1), (t) {
      if (!mounted) return;
      setState(() => _recordingSeconds++);
      if (_recordingSeconds >= maxVoiceSeconds) _toggleRecording();
    });
  }

  // ---------------------------------------------------------------- envoi

  Future<void> _submit() async {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final address = _address ?? ref.read(selectedAddressProvider).value;
    final budgetText = _budget.text.trim();
    final budget = budgetText.isEmpty ? null : int.tryParse(budgetText);
    String? error;
    if (_categoryId == null) {
      error = common.errorRequired;
    } else if (_description.text.trim().length < 10) {
      error = l.requestDescriptionTooShort;
    } else if (address == null) {
      error = l.resultsNeedAddress;
    } else if (_mode == RequestMode.scheduled && !isValidSlot(_slot)) {
      error = l.requestSlotInvalid;
    } else if (budgetText.isNotEmpty && (budget == null || budget < 500)) {
      error = l.requestBudgetInvalid;
    }
    setState(() => _error = error);
    if (error != null) return;
    if (_recording) await _toggleRecording();

    setState(() => _saving = true);
    final api = ref.read(apiProvider);
    try {
      // Fichiers envoyés d'abord (contrôlés par le serveur), puis le brouillon qui les référence.
      final toUpload = _photos.where((p) => p.fileId == null).toList();
      final total = toUpload.length + (_voice != null && _voiceFileId == null ? 1 : 0);
      var done = 0;
      for (final p in toUpload) {
        setState(() => _progress = l.requestUploading(done, total));
        p.fileId = await api.uploadFile(purpose: 'REQUEST_PHOTO', bytes: p.bytes!, mimeType: imageMimeType(p.bytes!)!);
        done++;
      }
      if (_voice != null && _voiceFileId == null) {
        setState(() => _progress = l.requestUploading(done, total));
        _voiceFileId = await api.uploadFile(purpose: 'REQUEST_VOICE', bytes: _voice!.bytes, mimeType: 'audio/mp4');
      }
      final draft = RequestDraft(
        categoryId: _categoryId!,
        serviceId: _serviceId,
        mode: _mode,
        description: _description.text,
        addressId: address!.id,
        window: _mode == RequestMode.scheduled ? _slot : null,
        budgetXof: budget,
        photoFileIds: [for (final p in _photos) p.fileId!],
        voiceFileId: _voiceFileId,
      );
      final existing = widget.args.draft;
      final saved = existing == null ? await api.createRequest(draft) : await api.updateRequest(existing.id, draft);
      ref.invalidate(activeRequestsProvider);
      ref.invalidate(requestProvider(saved.id));
      if (!mounted) return;
      if (existing == null) {
        context.pushReplacement('/demandes/${saved.id}');
      } else {
        context.pop(saved);
      }
    } on Object catch (e) {
      if (mounted) setState(() => _error = failureMessage(common, e));
    } finally {
      if (mounted) {
        setState(() {
          _saving = false;
          _progress = null;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final l = AppLocalizations.of(context);
    final common = CommonLocalizations.of(context);
    final text = Theme.of(context).textTheme;
    final c = context.ineedColors;
    final categories = ref.watch(categoriesProvider).value ?? const <Category>[];
    final category = categories.where((x) => x.id == _categoryId).firstOrNull;
    final address = _address ?? ref.watch(selectedAddressProvider).value;
    Widget section(String title, [String? help]) => Padding(
          padding: const EdgeInsets.only(top: IneedSpacing.s6, bottom: IneedSpacing.s2),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text(title, style: text.titleMedium),
            if (help != null) Text(help, style: text.bodySmall?.copyWith(color: c.textMuted)),
          ]),
        );

    return Scaffold(
      appBar: AppBar(title: Text(widget.args.draft == null ? l.requestNewTitle : l.requestEditDraft)),
      body: ListView(
        padding: const EdgeInsets.all(IneedSpacing.s4),
        children: [
          DropdownButtonFormField<String>(
            initialValue: category?.id,
            decoration: InputDecoration(labelText: l.requestCategoryLabel),
            items: [for (final cat in categories) DropdownMenuItem(value: cat.id, child: Text(cat.name))],
            onChanged: (id) => setState(() {
              _categoryId = id;
              _serviceId = null;
            }),
          ),
          if (category != null && category.services.isNotEmpty) ...[
            section(l.serviceChooseTitle),
            Wrap(
              spacing: IneedSpacing.s2,
              runSpacing: IneedSpacing.s2,
              children: [
                for (final s in category.services)
                  ChoiceChip(label: Text(s.name), selected: _serviceId == s.id, onSelected: (on) => setState(() => _serviceId = on ? s.id : null)),
              ],
            ),
          ],
          section(l.requestDescribeTitle),
          TextField(
            controller: _description,
            minLines: 3,
            maxLines: 8,
            maxLength: 2000,
            decoration: InputDecoration(labelText: l.requestDescriptionLabel, hintText: l.requestDescriptionHint),
          ),
          section(l.requestPhotos, l.requestPhotosHelp),
          Wrap(
            spacing: IneedSpacing.s2,
            runSpacing: IneedSpacing.s2,
            children: [
              for (final p in _photos)
                Stack(
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(IneedRadius.sm),
                      child: SizedBox.square(
                        dimension: 84,
                        child: p.bytes != null
                            ? Image.memory(p.bytes!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.image_outlined))
                            : Image.network(p.url!, fit: BoxFit.cover, errorBuilder: (_, _, _) => const Icon(Icons.image_outlined)),
                      ),
                    ),
                    Positioned(
                      right: 0,
                      top: 0,
                      child: IconButton.filledTonal(
                        iconSize: 16,
                        tooltip: l.requestPhotoRemove,
                        onPressed: () => setState(() => _photos.remove(p)),
                        icon: const Icon(Icons.close),
                      ),
                    ),
                  ],
                ),
              if (_photos.length < _maxPhotos)
                SizedBox.square(
                  dimension: 84,
                  child: OutlinedButton(onPressed: _addPhoto, child: Icon(Icons.add_a_photo_outlined, semanticLabel: l.requestPhotoAdd)),
                ),
            ],
          ),
          section(l.requestVoiceNote, l.requestVoiceMax),
          if (_voiceSeconds != null || _voiceFileId != null)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.mic_none),
              title: Text(_voiceSeconds == null ? l.requestVoiceNote : l.requestVoiceRecorded(_voiceSeconds!)),
              trailing: IconButton(
                tooltip: l.requestVoiceDelete,
                icon: const Icon(Icons.delete_outline),
                onPressed: () => setState(() {
                  _voice = null;
                  _voiceSeconds = null;
                  _voiceFileId = null;
                }),
              ),
            )
          else
            OutlinedButton.icon(
              onPressed: _toggleRecording,
              icon: Icon(_recording ? Icons.stop_circle_outlined : Icons.mic_none, color: _recording ? c.urgent : null),
              label: Text(_recording ? '${l.requestVoiceRecording(_recordingSeconds)} · ${l.requestVoiceStop}' : l.requestVoiceStart),
            ),
          section(l.requestWhereLabel),
          Card(
            child: ListTile(
              leading: const Icon(Icons.place_outlined),
              title: Text(address?.title ?? l.homeNoAddress),
              subtitle: address == null ? null : Text([address.zoneName ?? address.cityName, if (address.landmark != null && address.landmark != address.title) address.landmark!].join(' · ')),
              trailing: Text(common.actionEdit),
              onTap: () async {
                final picked = await context.push<Address>('/adresses', extra: true);
                if (picked != null) setState(() => _address = picked);
              },
            ),
          ),
          section(l.requestModeTitle),
          RadioGroup<RequestMode>(
            groupValue: _mode,
            onChanged: (m) => setState(() => _mode = m!),
            child: Column(children: [
              RadioListTile(value: RequestMode.urgent, title: Text(l.requestModeUrgent), subtitle: Text(l.requestModeUrgentHelp)),
              RadioListTile(value: RequestMode.scheduled, title: Text(l.requestModeScheduled), subtitle: Text(l.requestModeScheduledHelp)),
            ]),
          ),
          if (_mode == RequestMode.scheduled)
            ListTile(
              leading: const Icon(Icons.schedule),
              title: Text(l.requestSlotTitle),
              subtitle: Text(slotLabel(l, _slot)),
              trailing: Text(common.actionEdit),
              onTap: () async {
                final picked = await pickSlot(context, _slot);
                if (picked != null) setState(() => _slot = picked);
              },
            ),
          section(l.requestBudget, l.requestBudgetHelp),
          TextField(
            controller: _budget,
            keyboardType: TextInputType.number,
            inputFormatters: [FilteringTextInputFormatter.digitsOnly, LengthLimitingTextInputFormatter(8)],
            decoration: const InputDecoration(suffixText: 'F CFA'),
          ),
          if (_error != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: Text(_error!, style: TextStyle(color: c.danger))),
          if (_progress != null) Padding(padding: const EdgeInsets.only(top: IneedSpacing.s3), child: Text(_progress!)),
          const SizedBox(height: IneedSpacing.s4),
          IneedButton(label: l.requestReviewCta, loading: _saving, onPressed: _submit),
          const SizedBox(height: IneedSpacing.s6),
        ],
      ),
    );
  }
}
