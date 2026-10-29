/// Outils de test : faux serveur HTTP pour tester applications et écrans sans réseau.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:web_socket_channel/web_socket_channel.dart';

export 'package:dio/dio.dart' show DioException, HttpClientAdapter, RequestOptions, ResponseBody;

/// Réponse JSON neuve (une réponse ne se lit qu'une fois).
ResponseBody jsonResponse(int status, Object body) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

ResponseBody errorResponse(int status, String code, String message, [Object? details]) =>
    jsonResponse(status, {'error': {'code': code, 'message': message, 'details': ?details}});

typedef FakeRoute = Future<ResponseBody> Function(RequestOptions request);

/// Route les requêtes selon « MÉTHODE /chemin ». Les routes peuvent être remplacées en cours de test.
class FakeServer implements HttpClientAdapter {
  FakeServer([Map<String, FakeRoute>? routes]) : routes = {...?routes};
  final Map<String, FakeRoute> routes;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) {
    requests.add(o);
    final handler = routes['${o.method} ${o.uri.path}'];
    if (handler == null) return Future.value(errorResponse(404, 'NOT_FOUND', 'Route absente du faux serveur : ${o.method} ${o.uri.path}'));
    return handler(o);
  }

  int count(String route) => requests.where((r) => '${r.method} ${r.uri.path}' == route).length;

  RequestOptions last(String route) => requests.lastWhere((r) => '${r.method} ${r.uri.path}' == route);

  @override
  void close({bool force = false}) {}
}

/// Faux canal WebSocket : enregistre ce que l'application envoie, et permet de lui pousser des événements.
class FakeWebSocketChannel implements WebSocketChannel {
  final _incoming = StreamController<Object?>();
  final List<Object?> sent = [];
  bool closed = false;

  /// Simule un message du serveur.
  void push(Map<String, Object?> event) => _incoming.add(jsonEncode(event));

  @override
  Stream<Object?> get stream => _incoming.stream;

  @override
  late final WebSocketSink sink = _FakeSink(this);

  @override
  Future<void> get ready => Future.value();

  @override
  String? get protocol => null;

  @override
  int? get closeCode => null;

  @override
  String? get closeReason => null;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

class _FakeSink implements WebSocketSink {
  _FakeSink(this.channel);
  final FakeWebSocketChannel channel;

  @override
  void add(Object? data) => channel.sent.add(data);

  @override
  Future<void> close([int? closeCode, String? closeReason]) async {
    channel.closed = true;
    await channel._incoming.close();
  }

  @override
  Future<void> get done => Future.value();

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}
