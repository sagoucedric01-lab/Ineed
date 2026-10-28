import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:record/record.dart';

class RecordedVoice {
  const RecordedVoice(this.bytes, this.seconds);
  final Uint8List bytes;
  final int seconds;
}

/// Enregistrement d'une note vocale (AAC dans un conteneur M4A, format accepté par le serveur).
abstract class VoiceRecorder {
  /// false si l'accès au micro est refusé.
  Future<bool> start();
  Future<RecordedVoice?> stop();
  Future<void> cancel();
}

/// Durée maximale d'une note vocale (paramètre serveur `request.max_voice_seconds`).
const maxVoiceSeconds = 120;

class DeviceVoiceRecorder implements VoiceRecorder {
  final _recorder = AudioRecorder();
  DateTime? _startedAt;
  String? _path;

  @override
  Future<bool> start() async {
    if (!await _recorder.hasPermission()) return false;
    final dir = await getTemporaryDirectory();
    _path = '${dir.path}/note-vocale-${DateTime.now().millisecondsSinceEpoch}.m4a';
    await _recorder.start(const RecordConfig(encoder: AudioEncoder.aacLc, bitRate: 32000, sampleRate: 16000, numChannels: 1), path: _path!);
    _startedAt = DateTime.now();
    return true;
  }

  @override
  Future<RecordedVoice?> stop() async {
    final path = await _recorder.stop();
    final started = _startedAt;
    _startedAt = null;
    if (path == null || started == null) return null;
    final file = File(path);
    final bytes = await file.readAsBytes();
    await file.delete().catchError((_) => file);
    final seconds = DateTime.now().difference(started).inSeconds.clamp(1, maxVoiceSeconds);
    return RecordedVoice(bytes, seconds);
  }

  @override
  Future<void> cancel() async {
    await _recorder.cancel();
    _startedAt = null;
  }
}

final voiceRecorderProvider = Provider<VoiceRecorder>((ref) => DeviceVoiceRecorder());
