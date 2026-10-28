/// Outils de test : faux serveur HTTP pour tester applications et écrans sans réseau.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';

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
