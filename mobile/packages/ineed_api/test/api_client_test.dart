import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:test/test.dart';

/// Adaptateur HTTP factice : répond selon [handler] sans réseau.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);
  final Future<ResponseBody> Function(RequestOptions options) handler;
  RequestOptions? last;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) {
    last = options;
    return handler(options);
  }

  @override
  void close({bool force = false}) {}
}

ResponseBody json(int status, Object body) => ResponseBody.fromString(
      jsonEncode(body),
      status,
      headers: {Headers.contentTypeHeader: ['application/json; charset=utf-8']},
    );

Map<String, Object> report(String status, {String redis = 'ok'}) => {
      'status': status,
      'checks': {
        'database': {'status': 'ok', 'latencyMs': 3},
        'redis': {'status': redis, 'latencyMs': 2},
        'storage': {'status': 'ok', 'latencyMs': 5},
      },
      'worker': {'status': 'ok'},
    };

void main() {
  final base = Uri.parse('http://api.test:3000');

  test('readiness : tout est disponible', () async {
    final adapter = FakeAdapter((_) async => json(200, report('ok')));
    final r = await IneedApiClient(baseUrl: base, adapter: adapter).readiness();
    expect(r.ok, isTrue);
    expect(r.unavailable, isEmpty);
    expect(adapter.last!.uri.toString(), 'http://api.test:3000/health/ready');
  });

  test('readiness : un 503 est un rapport et nomme le service en panne', () async {
    final adapter = FakeAdapter((_) async => json(503, report('error', redis: 'error')));
    final r = await IneedApiClient(baseUrl: base, adapter: adapter).readiness();
    expect(r.ok, isFalse);
    expect(r.unavailable, [ApiDependency.redis]);
  });

  test('erreur au format de l’API -> ServerFailure avec le message français', () async {
    final adapter = FakeAdapter((_) async => json(500, {
          'error': {'code': 'INTERNAL_ERROR', 'message': 'Un problème est survenu de notre côté.', 'requestId': 'abc-12345678'},
        }));
    await expectLater(
      IneedApiClient(baseUrl: base, adapter: adapter).readiness(),
      throwsA(isA<ServerFailure>()
          .having((f) => f.code, 'code', 'INTERNAL_ERROR')
          .having((f) => f.requestId, 'requestId', 'abc-12345678')),
    );
  });

  test('réponse HTML d’un proxy -> UnexpectedResponseFailure', () async {
    final adapter = FakeAdapter((_) async => ResponseBody.fromString('<html>Bad gateway</html>', 502));
    await expectLater(
      IneedApiClient(baseUrl: base, adapter: adapter).readiness(),
      throwsA(isA<UnexpectedResponseFailure>().having((f) => f.status, 'status', 502)),
    );
  });

  test('connexion impossible -> NetworkFailure', () async {
    final adapter = FakeAdapter((o) async => throw DioException.connectionError(requestOptions: o, reason: 'refusée'));
    await expectLater(IneedApiClient(baseUrl: base, adapter: adapter).readiness(), throwsA(isA<NetworkFailure>()));
  });

  test('délai dépassé -> TimeoutFailure', () async {
    final adapter = FakeAdapter((o) async => throw DioException.receiveTimeout(timeout: const Duration(seconds: 1), requestOptions: o));
    await expectLater(IneedApiClient(baseUrl: base, adapter: adapter).readiness(), throwsA(isA<TimeoutFailure>()));
  });
}
