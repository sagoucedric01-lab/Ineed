import 'package:flutter/material.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';

import 'app.dart';

void main() {
  // Paramètres fournis à la compilation : flutter run --dart-define-from-file=config/dev.json
  final env = AppEnvironment.fromDefines();
  final api = IneedApiClient(baseUrl: env.apiBaseUrl);
  runApp(IneedApp(environment: env, checkApi: api.readiness));
}
