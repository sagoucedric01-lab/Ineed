import 'dart:convert';
import 'dart:typed_data';

import 'package:dio/dio.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:test/test.dart';

/// Faux serveur : route les requêtes selon méthode et chemin.
class FakeServer implements HttpClientAdapter {
  FakeServer(this.routes);
  final Map<String, Future<ResponseBody> Function(RequestOptions o)> routes;
  final List<RequestOptions> requests = [];

  @override
  Future<ResponseBody> fetch(RequestOptions o, Stream<Uint8List>? body, Future<void>? cancel) {
    requests.add(o);
    final handler = routes['${o.method} ${o.uri.path}'];
    if (handler == null) return Future.value(json(404, {'error': {'code': 'NOT_FOUND', 'message': 'introuvable'}}));
    return handler(o);
  }

  int count(String route) => requests.where((r) => '${r.method} ${r.uri.path}' == route).length;

  @override
  void close({bool force = false}) {}
}

ResponseBody json(int status, Object body) =>
    ResponseBody.fromString(jsonEncode(body), status, headers: {Headers.contentTypeHeader: ['application/json']});

// Une réponse factice ne se lit qu'une fois : on en crée une neuve à chaque appel.
ResponseBody unauthorized() => json(401, {'error': {'code': 'TOKEN_EXPIRED', 'message': 'Votre session a expiré.'}});
Map<String, Object?> meBody(String name) => {'id': 'u1', 'phone': '+2250712345678', 'firstName': name, 'lastName': 'K', 'roles': ['CLIENT'], 'profileComplete': true};

void main() {
  final base = Uri.parse('http://api.test');

  test('la connexion enregistre les jetons, puis ils sont envoyés sur les routes protégées uniquement', () async {
    final store = InMemoryTokenStore();
    final server = FakeServer({
      'POST /v1/auth/otp/verify': (_) async => json(200, {
            'tokens': {'accessToken': 'A1', 'refreshToken': 'R1'},
            'user': {'id': 'u1'},
            'isNewUser': true,
            'profileComplete': false,
          }),
      'GET /v1/me': (o) async => json(200, meBody('Awa')),
      'GET /v1/catalog/categories': (o) async => json(200, []),
    });
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server);
    final r = await api.verifyLoginCode(challengeId: 'c', code: '123456', app: 'CLIENT');
    expect(r.isNewUser, isTrue);
    expect(store.tokens!.refreshToken, 'R1');
    await api.me();
    await api.categories();
    expect(server.requests.firstWhere((o) => o.path == '/v1/me').headers['authorization'], 'Bearer A1');
    expect(server.requests.firstWhere((o) => o.path == '/v1/catalog/categories').headers['authorization'], isNull);
  });

  test('plusieurs 401 simultanés déclenchent un seul échange de jeton, puis les requêtes sont rejouées', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'vieux', refreshToken: 'R1');
    final server = FakeServer({
      'GET /v1/me': (o) async => o.headers['authorization'] == 'Bearer neuf' ? json(200, meBody('Awa')) : unauthorized(),
      'POST /v1/auth/refresh': (o) async {
        await Future<void>.delayed(const Duration(milliseconds: 30));
        return json(200, {'accessToken': 'neuf', 'refreshToken': 'R2'});
      },
    });
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server);
    final results = await Future.wait([api.me(), api.me(), api.me()]);
    expect(results.map((m) => m.firstName), everyElement('Awa'));
    expect(server.count('POST /v1/auth/refresh'), 1);
    expect(store.tokens!.refreshToken, 'R2');
  });

  test('échange refusé : session effacée, rappel unique, erreur 401 remontée', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'vieux', refreshToken: 'R1');
    var expired = 0;
    final server = FakeServer({'GET /v1/me': (_) async => unauthorized(), 'POST /v1/auth/refresh': (_) async => unauthorized()});
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server, onSessionExpired: () => expired++);
    await expectLater(api.me(), throwsA(isA<ServerFailure>().having((f) => f.status, 'status', 401)));
    expect(store.tokens, isNull);
    expect(expired, 1);
  });

  test('coupure réseau pendant l’échange : la session est conservée', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'vieux', refreshToken: 'R1');
    final server = FakeServer({
      'GET /v1/me': (_) async => unauthorized(),
      'POST /v1/auth/refresh': (o) async => throw DioException.connectionError(requestOptions: o, reason: 'réseau'),
    });
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server);
    await expectLater(api.me(), throwsA(isA<ServerFailure>()));
    expect(store.tokens!.refreshToken, 'R1');
  });

  test('la déconnexion efface la session même si le serveur est injoignable', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    final server = FakeServer({'POST /v1/auth/logout': (o) async => throw DioException.connectionError(requestOptions: o, reason: 'réseau')});
    await IneedApiClient(baseUrl: base, tokenStore: store, adapter: server).logout();
    expect(store.tokens, isNull);
  });

  test('envoi de fichier : préparation, dépôt direct sans jeton Ineed, finalisation', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    final server = FakeServer({
      'POST /v1/files': (_) async => json(201, {
            'fileId': 'f1',
            'uploadUrl': 'http://stockage.test/ineed-public/avatar/u1/f1?X-Amz-Signature=abc',
            'method': 'PUT',
            'headers': {'content-type': 'image/jpeg', 'content-length': '3'},
            'expiresAt': '2026-10-28T12:00:00Z',
          }),
      'POST /v1/files/f1/complete': (_) async => json(200, {'id': 'f1', 'status': 'READY', 'mimeType': 'image/jpeg', 'sizeBytes': 3}),
    });
    final storage = FakeServer({'PUT /ineed-public/avatar/u1/f1': (_) async => ResponseBody.fromString('', 200)});
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server, uploadAdapter: storage);
    final id = await api.uploadFile(purpose: 'AVATAR', bytes: Uint8List.fromList([1, 2, 3]), mimeType: 'image/jpeg');
    expect(id, 'f1');
    final put = storage.requests.single;
    expect(put.headers['authorization'], isNull);
    expect(put.headers['content-type'], 'image/jpeg');
    expect(server.count('POST /v1/files/f1/complete'), 1);
  });

  test('les détails d’erreur sont exposés (essais restants, éléments manquants)', () async {
    final store = InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');
    final server = FakeServer({
      'POST /v1/auth/otp/verify': (_) async => json(400, {'error': {'code': 'OTP_INVALID', 'message': 'Code incorrect.', 'details': {'attemptsLeft': 3}}}),
      'POST /v1/pro/profile/submit': (_) async =>
          json(422, {'error': {'code': 'PROFILE_INCOMPLETE', 'message': 'Votre dossier est incomplet.', 'details': {'missing': ['PHOTO']}}}),
    });
    final api = IneedApiClient(baseUrl: base, tokenStore: store, adapter: server);
    await expectLater(api.verifyLoginCode(challengeId: 'c', code: '000000', app: 'CLIENT'), throwsA(isA<ServerFailure>().having((f) => f.attemptsLeft, 'attemptsLeft', 3)));
    await expectLater(api.submitProProfile(), throwsA(isA<ServerFailure>().having((f) => f.missing, 'missing', ['PHOTO'])));
  });
}
