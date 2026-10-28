import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_shared/ineed_shared.dart';

/// Dossier professionnel (null s'il n'est pas commencé).
final proProfileProvider = FutureProvider.autoDispose<ProProfile?>((ref) => ref.read(apiProvider).proProfile());

final categoriesProvider = FutureProvider.autoDispose<List<Category>>((ref) => ref.read(apiProvider).categories());

final zonesProvider = FutureProvider.autoDispose<List<Zone>>((ref) => ref.read(apiProvider).zones());

final documentTypesProvider = FutureProvider.autoDispose<List<DocumentType>>((ref) => ref.read(apiProvider).documentTypes());

/// Sélection d'un justificatif au format PDF. Remplaçable dans les tests.
typedef PdfPicker = Future<Uint8List?> Function();

final pdfPickerProvider = Provider<PdfPicker>((ref) => () async {
      final file = await FilePicker.pickFile(type: FileType.custom, allowedExtensions: ['pdf']);
      return file?.readAsBytes();
    });

/// Statuts dans lesquels le professionnel complète encore son dossier.
bool isEditableStatus(String? status) => status == null || status == 'DRAFT' || status == 'INFO_REQUESTED';
