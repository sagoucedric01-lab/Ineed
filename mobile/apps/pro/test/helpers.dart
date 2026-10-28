import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_api/testing.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_pro/app.dart';
import 'package:ineed_pro/location.dart';
import 'package:ineed_pro/providers.dart';
import 'package:ineed_shared/ineed_shared.dart';

final devEnv = AppEnvironment.parse(name: 'dev', apiBaseUrl: 'http://api.test');

final jpegBytes = Uint8List.fromList([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10, 0x4A, 0x46, 0x49, 0x46]);
final pdfBytes = Uint8List.fromList('%PDF-1.4\n%fin'.codeUnits);

Map<String, Object?> challengeJson() => {
      'challengeId': 'ch1',
      'expiresAt': DateTime.now().add(const Duration(minutes: 10)).toUtc().toIso8601String(),
      'resendAvailableAt': DateTime.now().add(const Duration(seconds: 60)).toUtc().toIso8601String(),
      'devMode': true,
    };

final categoriesJson = [
  {
    'id': 'c1', 'slug': 'plomberie', 'name': 'Plomberie', 'iconKey': 'plomberie',
    'skills': [{'id': 's1', 'name': 'Recherche de fuite'}],
  },
  {'id': 'c2', 'slug': 'electricite', 'name': 'Électricité', 'iconKey': 'electricite', 'skills': <Object>[]},
];

final zonesJson = [
  {'id': 'z1', 'name': 'Cocody'},
  {'id': 'z2', 'name': 'Yopougon'},
];

final documentTypesJson = [
  {'code': 'PIECE_IDENTITE', 'label': 'Pièce d’identité', 'requiredFor': ['INDIVIDUAL', 'COMPANY']},
  {'code': 'DIPLOME', 'label': 'Diplôme ou certificat', 'requiredFor': <String>[]},
];

/// Faux serveur Ineed avec un état : compte, dossier professionnel, justificatifs.
class ProBackend {
  ProBackend({this.firstName = 'Koffi', this.lastName = 'Yao', this.avatarUrl, this.proStatus, this.profile});

  String? firstName;
  String? lastName;
  String? avatarUrl;
  String? proStatus;
  Map<String, Object?>? profile;

  /// Positions envoyées par l'application.
  final locations = <Map<String, Object?>>[];

  Map<String, Object?> me() => {
        'id': 'u1',
        'phone': '+2250712345678',
        'firstName': firstName,
        'lastName': lastName,
        'avatarUrl': avatarUrl,
        'roles': ['PRO'],
        'profileComplete': firstName != null && lastName != null,
        'proStatus': proStatus,
        'createdAt': '2026-10-28T10:00:00Z',
      };

  /// Calcul simplifié des éléments manquants, aligné sur le serveur.
  Map<String, Object?> profileJson() {
    final p = profile!;
    final docs = (p['documents']! as List).cast<Map<String, Object?>>();
    final missing = [
      if (firstName == null) 'NAMES',
      if ((p['categories']! as List).isEmpty) 'CATEGORY',
      if ((p['zones']! as List).isEmpty) 'ZONE',
      if ((p['weeklyHours']! as List).isEmpty) 'HOURS',
      if (avatarUrl == null) 'PHOTO',
      if (!docs.any((d) => d['typeCode'] == 'PIECE_IDENTITE' && d['status'] != 'REJECTED')) 'DOCUMENT:PIECE_IDENTITE',
    ];
    return {...p, 'verificationStatus': proStatus ?? 'DRAFT', 'missing': missing, 'canSubmit': missing.isEmpty};
  }

  late final FakeServer server = FakeServer({
    'POST /v1/auth/otp/request': (_) async => jsonResponse(202, challengeJson()),
    'POST /v1/auth/otp/verify': (_) async =>
        jsonResponse(200, {'tokens': {'accessToken': 'A', 'refreshToken': 'R'}, 'user': {'id': 'u1'}, 'isNewUser': true, 'profileComplete': firstName != null}),
    'GET /v1/me': (_) async => jsonResponse(200, me()),
    'PATCH /v1/me': (o) async {
      final body = o.data as Map;
      firstName = body['firstName'] as String;
      lastName = body['lastName'] as String;
      return jsonResponse(200, me());
    },
    'PUT /v1/me/avatar': (_) async {
      avatarUrl = 'http://storage.test/avatar.jpg';
      return jsonResponse(200, me());
    },
    'GET /v1/catalog/categories': (_) async => jsonResponse(200, categoriesJson),
    'GET /v1/geo/zones': (_) async => jsonResponse(200, zonesJson),
    'GET /v1/pro/document-types': (_) async => jsonResponse(200, documentTypesJson),
    'GET /v1/pro/profile': (_) async => profile == null ? errorResponse(404, 'NOT_FOUND', 'Dossier non commencé') : jsonResponse(200, profileJson()),
    'PUT /v1/pro/profile': (o) async {
      final b = o.data as Map;
      proStatus ??= 'DRAFT';
      profile = {
        'kind': b['kind'],
        'businessName': b['businessName'],
        'companyRegNumber': b['companyRegNumber'],
        'bio': b['bio'],
        'yearsExperience': b['yearsExperience'],
        'categories': [for (final id in b['categoryIds'] as List) {'id': id}],
        'skills': [for (final id in b['skillIds'] as List) {'id': id}],
        'zones': [for (final id in b['zoneIds'] as List) {'id': id}],
        'weeklyHours': b['weeklyHours'],
        'documents': profile?['documents'] ?? <Object>[],
        'lastDecisionNote': null,
        'isOnline': false,
      };
      return jsonResponse(200, profileJson());
    },
    'POST /v1/files': (_) async => jsonResponse(201, {'fileId': 'f1', 'uploadUrl': 'http://storage.test/upload/f1', 'headers': {'content-type': 'application/pdf'}}),
    'PUT /upload/f1': (_) async => ResponseBody.fromString('', 200),
    'POST /v1/files/f1/complete': (_) async => jsonResponse(200, {'fileId': 'f1', 'status': 'READY'}),
    'POST /v1/pro/documents': (o) async {
      final b = o.data as Map;
      (profile!['documents']! as List).add({'id': 'd1', 'typeCode': b['typeCode'], 'typeLabel': 'Pièce d’identité', 'status': 'PENDING', 'rejectionReason': null});
      return jsonResponse(201, profileJson());
    },
    'POST /v1/pro/profile/submit': (_) async {
      proStatus = 'SUBMITTED';
      return jsonResponse(200, profileJson());
    },
    'PUT /v1/pro/location': (o) async {
      locations.add(Map<String, Object?>.from(o.data as Map));
      return jsonResponse(200, {'recordedAt': '2026-10-28T10:00:00.000Z'});
    },
    'PUT /v1/pro/service-area': (o) async {
      final b = o.data as Map;
      if (b['serviceRadiusM'] != null) profile!['serviceRadiusM'] = b['serviceRadiusM'];
      if (b['baseLocation'] != null) profile!['baseLocation'] = b['baseLocation'];
      return jsonResponse(200, profileJson());
    },
    'PATCH /v1/pro/availability': (o) async {
      profile!['isOnline'] = (o.data as Map)['isOnline'];
      return jsonResponse(200, profileJson());
    },
  });
}

/// Dossier déjà rempli (activité), sans justificatif.
Map<String, Object?> filledProfile({List<Map<String, Object?>> documents = const [], String? note, bool online = false}) => {
      'kind': 'INDIVIDUAL',
      'businessName': 'Koffi Plomberie',
      'companyRegNumber': null,
      'bio': null,
      'yearsExperience': 12,
      'categories': [{'id': 'c1'}],
      'skills': <Object>[],
      'zones': [{'id': 'z1'}],
      'weeklyHours': [{'weekday': 1, 'start': '08:00', 'end': '18:00'}],
      'documents': [...documents],
      'lastDecisionNote': note,
      'isOnline': online,
    };

/// Démarre l'application Pro complète sur le faux serveur, sur un écran de téléphone haut.
Future<ProviderContainer> pumpProApp(WidgetTester tester, ProBackend backend, TokenStore store, {PositionFinder? position}) async {
  tester.view.physicalSize = const Size(1080, 2400);
  tester.view.devicePixelRatio = 2;
  addTearDown(tester.view.reset);
  late final ProviderContainer container;
  final api = IneedApiClient(
    baseUrl: devEnv.apiBaseUrl,
    tokenStore: store,
    adapter: backend.server,
    uploadAdapter: backend.server,
    onSessionExpired: () => container.read(sessionProvider.notifier).expired(),
  );
  container = ProviderContainer(retry: (_, _) => null, overrides: [
    apiProvider.overrideWithValue(api),
    appKindProvider.overrideWithValue('PRO'),
    photoPickerProvider.overrideWithValue((_) async => jpegBytes),
    pdfPickerProvider.overrideWithValue(() async => pdfBytes),
    positionFinderProvider.overrideWithValue(position ?? () async => const LatLng(5.36, -3.97)),
  ]);
  addTearDown(container.dispose);
  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: IneedProApp(environment: devEnv)));
  await tester.pumpAndSettle();
  return container;
}

InMemoryTokenStore signedInStore() => InMemoryTokenStore()..tokens = const StoredTokens(accessToken: 'A', refreshToken: 'R');

/// Fait défiler la liste jusqu'à l'élément (les listes ne construisent que ce qui est visible), puis le touche.
Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
  // Un champ encore actif ramènerait la liste vers lui pendant le défilement.
  FocusManager.instance.primaryFocus?.unfocus();
  await tester.pumpAndSettle();
  if (finder.evaluate().isEmpty) await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await tester.pumpAndSettle();
  await tester.tap(finder);
  await tester.pumpAndSettle();
}
