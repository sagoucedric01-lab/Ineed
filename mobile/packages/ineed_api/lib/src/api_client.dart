import 'package:dio/dio.dart';

import 'api_failure.dart';
import 'readiness.dart';

/// Point d'entrée unique vers l'API. Les appels métier (authentification, demandes, missions…)
/// seront ajoutés à partir de la phase 4, sur le même modèle : erreurs converties en [ApiFailure].
class IneedApiClient {
  IneedApiClient({required Uri baseUrl, HttpClientAdapter? adapter, Duration timeout = const Duration(seconds: 10)})
      : _dio = Dio(
          BaseOptions(
            baseUrl: baseUrl.toString(),
            connectTimeout: timeout,
            receiveTimeout: timeout,
            sendTimeout: timeout,
            responseType: ResponseType.json,
            headers: {'accept': 'application/json'},
          ),
        ) {
    if (adapter != null) _dio.httpClientAdapter = adapter;
  }

  final Dio _dio;

  /// GET /health/ready. Un 503 est une réponse valide : l'API répond mais un service est indisponible.
  Future<Readiness> readiness() => _guard(() async {
        final res = await _dio.get<Object?>(
          '/health/ready',
          options: Options(validateStatus: (s) => s == 200 || s == 503),
        );
        try {
          return Readiness.fromJson(res.data);
        } on FormatException {
          throw UnexpectedResponseFailure(res.statusCode);
        }
      });

  Future<T> _guard<T>(Future<T> Function() call) async {
    try {
      return await call();
    } on DioException catch (e) {
      throw toApiFailure(e);
    }
  }

  void close() => _dio.close(force: true);
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
        );
      }
      return UnexpectedResponseFailure(status);
    case DioExceptionType.cancel:
    case DioExceptionType.badCertificate:
    case DioExceptionType.unknown:
      return e.error is ApiFailure ? e.error! as ApiFailure : const NetworkFailure();
  }
}
