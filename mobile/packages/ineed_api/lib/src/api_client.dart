import 'dart:async';
import 'dart:typed_data';

import 'package:dio/dio.dart';

import 'api_failure.dart';
import 'marketplace.dart';
import 'models.dart';
import 'readiness.dart';
import 'tokens.dart';

/// Point d'entrée unique vers l'API Ineed.
///
/// - Ajoute le jeton d'accès aux requêtes authentifiées.
/// - Sur une réponse 401, échange une seule fois le jeton de rafraîchissement (même si plusieurs requêtes
///   échouent en même temps), puis rejoue la requête. Si l'échange échoue, la session est effacée et
///   [onSessionExpired] est appelé.
/// - Convertit toutes les erreurs en [ApiFailure].
class IneedApiClient {
  IneedApiClient({
    required Uri baseUrl,
    TokenStore? tokenStore,
    HttpClientAdapter? adapter,
    HttpClientAdapter? uploadAdapter,
    this.onSessionExpired,
    Duration timeout = const Duration(seconds: 15),
  })  : tokenStore = tokenStore ?? InMemoryTokenStore(),
        _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl.toString(),
            connectTimeout: timeout,
            receiveTimeout: timeout,
            sendTimeout: timeout,
            responseType: ResponseType.json,
            headers: {'accept': 'application/json'},
          ),
        ),
        // Client séparé pour envoyer les fichiers directement au stockage (URL présignées, sans jeton Ineed).
        _upload = Dio(BaseOptions(connectTimeout: timeout, sendTimeout: const Duration(minutes: 2), receiveTimeout: timeout)) {
    if (adapter != null) _dio.httpClientAdapter = adapter;
    if (uploadAdapter != null) _upload.httpClientAdapter = uploadAdapter;
    _dio.interceptors.add(InterceptorsWrapper(onRequest: _attachToken, onError: _refreshOnUnauthorized));
  }

  final TokenStore tokenStore;
  final void Function()? onSessionExpired;
  final Dio _dio;
  final Dio _upload;
  Completer<StoredTokens?>? _refreshing;

  static const _authenticated = 'ineed.authenticated';
  static const _retried = 'ineed.retried';

  Options _auth([Options? o]) => (o ?? Options()).copyWith(extra: {...?o?.extra, _authenticated: true});

  Future<void> _attachToken(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra[_authenticated] == true) {
      final tokens = await tokenStore.read();
      if (tokens != null) options.headers['authorization'] = 'Bearer ${tokens.accessToken}';
    }
    handler.next(options);
  }

  Future<void> _refreshOnUnauthorized(DioException err, ErrorInterceptorHandler handler) async {
    final req = err.requestOptions;
    if (err.response?.statusCode != 401 || req.extra[_authenticated] != true || req.extra[_retried] == true) {
      return handler.next(err);
    }
    final tokens = await _refreshTokens();
    if (tokens == null) return handler.next(err);
    try {
      req.extra[_retried] = true;
      req.headers['authorization'] = 'Bearer ${tokens.accessToken}';
      handler.resolve(await _dio.fetch<Object?>(req));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  /// Un seul échange en cours à la fois : les requêtes concurrentes attendent le même résultat.
  Future<StoredTokens?> _refreshTokens() {
    final pending = _refreshing;
    if (pending != null) return pending.future;
    final completer = _refreshing = Completer<StoredTokens?>();
    () async {
      StoredTokens? result;
      try {
        final current = await tokenStore.read();
        if (current != null) {
          final res = await _dio.post<Map<String, Object?>>('/v1/auth/refresh', data: {'refreshToken': current.refreshToken});
          result = StoredTokens.fromJson(res.data!);
          await tokenStore.write(result);
        }
      } on DioException catch (e) {
        // Seul un refus explicite efface la session ; une coupure réseau la conserve pour plus tard.
        if (e.response?.statusCode == 401) {
          await tokenStore.clear();
          onSessionExpired?.call();
        }
      } finally {
        completer.complete(result);
        _refreshing = null;
      }
    }();
    return completer.future;
  }

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw toApiFailure(e);
    } on FormatException {
      throw const UnexpectedResponseFailure(null);
    }
  }

  Future<Map<String, Object?>> _json(Future<Response<Object?>> request) async {
    final data = (await request).data;
    if (data is! Map<String, Object?>) throw const FormatException('Réponse JSON attendue');
    return data;
  }

  Future<List<Map<String, Object?>>> _jsonList(Future<Response<Object?>> request) async {
    final data = (await request).data;
    if (data is! List<Object?>) throw const FormatException('Liste JSON attendue');
    return data.cast<Map<String, Object?>>();
  }

  // ---------------------------------------------------------------- Santé

  /// GET /health/ready. Un 503 est une réponse valide : l'API répond mais un service est indisponible.
  Future<Readiness> readiness() => _guard(() async {
        final res = await _dio.get<Object?>('/health/ready', options: Options(validateStatus: (s) => s == 200 || s == 503));
        try {
          return Readiness.fromJson(res.data);
        } on FormatException {
          throw UnexpectedResponseFailure(res.statusCode);
        }
      });

  // ---------------------------------------------------------------- Connexion

  Future<OtpChallenge> requestLoginCode(String phone) =>
      _guard(() async => OtpChallenge.fromJson(await _json(_dio.post('/v1/auth/otp/request', data: {'phone': phone}))));

  /// Vérifie le code et enregistre la session.
  Future<LoginResult> verifyLoginCode({required String challengeId, required String code, required String app, String? deviceLabel}) =>
      _guard(() async {
        final j = await _json(_dio.post('/v1/auth/otp/verify', data: {
          'challengeId': challengeId,
          'code': code,
          'app': app,
          'deviceLabel': ?deviceLabel,
        }));
        await tokenStore.write(StoredTokens.fromJson(j['tokens']! as Map<String, Object?>));
        final user = j['user']! as Map<String, Object?>;
        return LoginResult(userId: user['id']! as String, isNewUser: j['isNewUser'] == true, profileComplete: j['profileComplete'] == true);
      });

  /// Déconnecte cet appareil ; la session locale est effacée même si le serveur est injoignable.
  Future<void> logout() async {
    try {
      await _guard(() => _dio.post<void>('/v1/auth/logout', options: _auth()));
    } on ApiFailure {
      // La session expirera côté serveur ; localement, on oublie les jetons dans tous les cas.
    } finally {
      await tokenStore.clear();
    }
  }

  // ---------------------------------------------------------------- Mon compte

  Future<Me> me() => _guard(() async => Me.fromJson(await _json(_dio.get('/v1/me', options: _auth()))));

  Future<Me> updateNames(String firstName, String lastName) => _guard(
        () async => Me.fromJson(await _json(_dio.patch('/v1/me', data: {'firstName': firstName, 'lastName': lastName}, options: _auth()))),
      );

  Future<Me> setAvatar(String fileId) =>
      _guard(() async => Me.fromJson(await _json(_dio.put('/v1/me/avatar', data: {'fileId': fileId}, options: _auth()))));

  Future<List<DeviceSession>> sessions() =>
      _guard(() async => (await _jsonList(_dio.get('/v1/me/sessions', options: _auth()))).map(DeviceSession.fromJson).toList());

  Future<void> revokeSession(String id) => _guard(() => _dio.delete<void>('/v1/me/sessions/$id', options: _auth()));

  Future<OtpChallenge> requestDeletionCode() =>
      _guard(() async => OtpChallenge.fromJson(await _json(_dio.post('/v1/me/deletion/code', options: _auth()))));

  Future<void> confirmDeletion(String challengeId, String code) async {
    await _guard(() => _dio.post<void>('/v1/me/deletion', data: {'challengeId': challengeId, 'code': code}, options: _auth()));
    await tokenStore.clear();
  }

  // ---------------------------------------------------------------- Fichiers

  /// Envoie un fichier : préparation, dépôt direct dans le stockage, puis contrôle par le serveur.
  /// Retourne l'identifiant du fichier prêt à être utilisé.
  Future<String> uploadFile({required String purpose, required Uint8List bytes, required String mimeType}) => _guard(() async {
        final ticket = await _json(_dio.post('/v1/files', data: {'purpose': purpose, 'mimeType': mimeType, 'sizeBytes': bytes.length}, options: _auth()));
        final headers = (ticket['headers']! as Map<String, Object?>).map((k, v) => MapEntry(k, v.toString()));
        await _upload.put<void>(ticket['uploadUrl']! as String, data: Stream.fromIterable([bytes]), options: Options(headers: headers));
        final fileId = ticket['fileId']! as String;
        await _dio.post<void>('/v1/files/$fileId/complete', options: _auth());
        return fileId;
      });

  // ---------------------------------------------------------------- Référentiel

  Future<List<Category>> categories() =>
      _guard(() async => (await _jsonList(_dio.get('/v1/catalog/categories'))).map(Category.fromJson).toList());

  Future<List<Zone>> zones() => _guard(() async => (await _jsonList(_dio.get('/v1/geo/zones'))).map(Zone.fromJson).toList());

  // ---------------------------------------------------------------- Espace professionnel

  /// Dossier du professionnel, ou `null` s'il n'est pas encore commencé.
  Future<ProProfile?> proProfile() => _guard(() async {
        try {
          return ProProfile.fromJson(await _json(_dio.get('/v1/pro/profile', options: _auth())));
        } on DioException catch (e) {
          if (e.response?.statusCode == 404) return null;
          rethrow;
        }
      });

  Future<ProProfile> saveProProfile(ProProfileDraft draft) =>
      _guard(() async => ProProfile.fromJson(await _json(_dio.put('/v1/pro/profile', data: draft.toJson(), options: _auth()))));

  Future<List<DocumentType>> documentTypes() =>
      _guard(() async => (await _jsonList(_dio.get('/v1/pro/document-types', options: _auth()))).map(DocumentType.fromJson).toList());

  Future<ProProfile> addDocument(String typeCode, String fileId) => _guard(
        () async => ProProfile.fromJson(await _json(_dio.post('/v1/pro/documents', data: {'typeCode': typeCode, 'fileId': fileId}, options: _auth()))),
      );

  Future<ProProfile> submitProProfile() =>
      _guard(() async => ProProfile.fromJson(await _json(_dio.post('/v1/pro/profile/submit', options: _auth()))));

  Future<ProProfile> setAvailability({required bool isOnline}) => _guard(
        () async => ProProfile.fromJson(await _json(_dio.patch('/v1/pro/availability', data: {'isOnline': isOnline}, options: _auth()))),
      );

  /// Point de départ et distance maximale (modifiables à tout moment, sans nouvelle vérification).
  Future<ProProfile> setServiceArea({LatLng? baseLocation, int? serviceRadiusM}) => _guard(
        () async => ProProfile.fromJson(await _json(_dio.put('/v1/pro/service-area',
            data: {'baseLocation': ?baseLocation?.toJson(), 'serviceRadiusM': ?serviceRadiusM}, options: _auth()))),
      );

  /// Position du moment, envoyée seulement quand le professionnel est disponible.
  Future<void> updateProLocation(LatLng position) => _guard(() => _dio.put<void>('/v1/pro/location', data: position.toJson(), options: _auth()));

  // ---------------------------------------------------------------- Recherche et lieux (application client)

  Future<CatalogSearchResult> searchCatalog(String query) => _guard(
        () async => CatalogSearchResult.fromJson(await _json(_dio.get('/v1/catalog/search', queryParameters: {'q': query}, options: _auth()))),
      );

  Future<List<RecentSearch>> recentSearches() =>
      _guard(() async => (await _jsonList(_dio.get('/v1/catalog/recent-searches', options: _auth()))).map(RecentSearch.fromJson).toList());

  /// Ville et commune d'un point (calcul fait par le serveur, sans service de géocodage externe).
  Future<Located> locate(LatLng point) =>
      _guard(() async => Located.fromJson(await _json(_dio.get('/v1/geo/locate', queryParameters: point.toJson(), options: _auth()))));

  Future<List<Address>> addresses() => _guard(() async => (await _jsonList(_dio.get('/v1/me/addresses', options: _auth()))).map(Address.fromJson).toList());

  Future<Address> createAddress(PlaceInput place) =>
      _guard(() async => Address.fromJson(await _json(_dio.post('/v1/me/addresses', data: place.toJson(), options: _auth()))));

  Future<Address> updateAddress(String id, PlaceInput place) =>
      _guard(() async => Address.fromJson(await _json(_dio.put('/v1/me/addresses/$id', data: place.toJson(), options: _auth()))));

  Future<void> deleteAddress(String id) => _guard(() => _dio.delete<void>('/v1/me/addresses/$id', options: _auth()));

  Future<ProSearchResult> searchPros({
    required String categoryId,
    required RequestMode mode,
    required LatLng location,
    String? serviceId,
    String? zoneId,
    int? radiusM,
    TimeWindow? window,
  }) =>
      _guard(() async => ProSearchResult.fromJson(await _json(_dio.get('/v1/pros/search',
          queryParameters: {
            'categoryId': categoryId,
            'mode': mode.code,
            ...location.toJson(),
            'serviceId': ?serviceId,
            'zoneId': ?zoneId,
            'radiusM': ?radiusM,
            ...?window?.toJson(),
          },
          options: _auth()))));

  Future<PublicProProfile> publicProProfile(String id) =>
      _guard(() async => PublicProProfile.fromJson(await _json(_dio.get('/v1/pros/$id', options: _auth()))));

  // ---------------------------------------------------------------- Demandes

  Future<ServiceRequest> createRequest(RequestDraft draft) =>
      _guard(() async => ServiceRequest.fromJson(await _json(_dio.post('/v1/requests', data: draft.toJson(), options: _auth()))));

  Future<ServiceRequest> updateRequest(String id, RequestDraft draft) =>
      _guard(() async => ServiceRequest.fromJson(await _json(_dio.put('/v1/requests/$id', data: draft.toJson(), options: _auth()))));

  Future<ServiceRequest> request(String id) => _guard(() async => ServiceRequest.fromJson(await _json(_dio.get('/v1/requests/$id', options: _auth()))));

  /// Mes demandes : `active` (en cours) ou `history` (terminées, annulées).
  Future<List<RequestSummary>> requests({String scope = 'active'}) => _guard(
        () async => (await _jsonList(_dio.get('/v1/requests', queryParameters: {'scope': scope}, options: _auth()))).map(RequestSummary.fromJson).toList(),
      );

  Future<ServiceRequest> publishRequest(String id) =>
      _guard(() async => ServiceRequest.fromJson(await _json(_dio.post('/v1/requests/$id/publish', options: _auth()))));

  Future<ServiceRequest> cancelRequest(String id, {String? reason}) => _guard(
        () async => ServiceRequest.fromJson(await _json(_dio.post('/v1/requests/$id/cancel', data: {'reason': ?reason}, options: _auth()))),
      );

  // ---------------------------------------------------------------- Notifications

  Future<NotificationsPage> notifications() => _guard(() async => NotificationsPage.fromJson(await _json(_dio.get('/v1/me/notifications', options: _auth()))));

  Future<void> markNotificationsRead() => _guard(() => _dio.post<void>('/v1/me/notifications/read', options: _auth()));

  void close() {
    _dio.close(force: true);
    _upload.close(force: true);
  }
}

/// Convertit une erreur Dio en [ApiFailure].
ApiFailure toApiFailure(DioException e) {
  switch (e.type) {
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
    case DioExceptionType.transformTimeout:
      return const TimeoutFailure();
    case DioExceptionType.connectionError:
      return const NetworkFailure();
    case DioExceptionType.badResponse:
      final status = e.response?.statusCode;
      final data = e.response?.data;
      final error = data is Map<String, Object?> ? data['error'] : null;
      if (status != null && error is Map<String, Object?> && error['code'] is String && error['message'] is String) {
        return ServerFailure(
          status: status,
          code: error['code']! as String,
          message: error['message']! as String,
          requestId: error['requestId'] as String?,
          details: error['details'],
        );
      }
      return UnexpectedResponseFailure(status);
    case DioExceptionType.cancel:
    case DioExceptionType.badCertificate:
    case DioExceptionType.unknown:
      return e.error is ApiFailure ? e.error! as ApiFailure : const NetworkFailure();
  }
}
