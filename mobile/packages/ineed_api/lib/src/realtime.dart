import 'dart:async';
import 'dart:convert';

import 'package:web_socket_channel/web_socket_channel.dart';

/// Ouvre un canal WebSocket (remplaçable dans les tests).
typedef ChannelFactory = WebSocketChannel Function(Uri uri);

/// Événement temps réel : `message` (nouveau message d'une conversation) ou `read` (accusé de lecture).
class RealtimeEvent {
  const RealtimeEvent(this.type, this.data);
  final String type;
  final Map<String, Object?> data;
  String? get conversationId => data['conversationId'] as String?;
}

/// Canal temps réel de l'API (`/v1/realtime`). Authentification par le premier message (le jeton ne passe pas
/// dans l'URL). Reconnexion automatique avec délai croissant. Ce canal n'est qu'une accélération : les écrans
/// rechargent aussi les données en REST.
class RealtimeClient {
  RealtimeClient({required Uri apiBaseUrl, required Future<String?> Function() accessToken, ChannelFactory? connect})
      : _uri = apiBaseUrl.replace(scheme: apiBaseUrl.scheme == 'https' ? 'wss' : 'ws', path: '${apiBaseUrl.path.replaceAll(RegExp(r'/$'), '')}/v1/realtime'),
        _token = accessToken,
        _connect = connect ?? WebSocketChannel.connect;

  final Uri _uri;
  final Future<String?> Function() _token;
  final ChannelFactory _connect;
  final _events = StreamController<RealtimeEvent>.broadcast();
  WebSocketChannel? _channel;
  Timer? _retry;
  int _attempt = 0;
  bool _closed = false;

  Uri get uri => _uri;
  Stream<RealtimeEvent> get events => _events.stream;
  bool get connected => _channel != null;

  Future<void> start() async {
    if (_closed || _channel != null) return;
    final token = await _token();
    if (token == null || _closed) return;
    try {
      final ch = _connect(_uri);
      _channel = ch;
      ch.sink.add(jsonEncode({'type': 'auth', 'token': token}));
      ch.stream.listen(
        (raw) {
          if (raw is! String) return;
          final j = jsonDecode(raw);
          if (j is! Map<String, Object?> || j['type'] is! String) return;
          if (j['type'] == 'ready') _attempt = 0;
          _events.add(RealtimeEvent(j['type']! as String, j));
        },
        onDone: _reconnect,
        onError: (_) => _reconnect(),
        cancelOnError: true,
      );
    } on Object {
      _reconnect();
    }
  }

  void _reconnect() {
    _channel = null;
    if (_closed) return;
    final delay = Duration(seconds: [1, 2, 5, 10, 30][_attempt.clamp(0, 4)]);
    _attempt++;
    _retry?.cancel();
    _retry = Timer(delay, start);
  }

  Future<void> close() async {
    _closed = true;
    _retry?.cancel();
    await _channel?.sink.close();
    _channel = null;
    await _events.close();
  }
}
