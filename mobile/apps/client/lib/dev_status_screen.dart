import 'package:flutter/material.dart';
import 'package:ineed_api/ineed_api.dart';
import 'package:ineed_core/ineed_core.dart';
import 'package:ineed_ui/ineed_ui.dart';

import 'l10n/gen/app_localizations.dart';

/// Écran technique de la phase 3 : vérifie la connexion à l'API. Remplacé par l'accueil en phase 4.
class DevStatusScreen extends StatefulWidget {
  const DevStatusScreen({required this.environment, required this.checkApi, super.key});

  final AppEnvironment environment;
  final Future<Readiness> Function() checkApi;

  @override
  State<DevStatusScreen> createState() => _DevStatusScreenState();
}

class _DevStatusScreenState extends State<DevStatusScreen> {
  DevStatusState _state = DevStatusState.checking;
  Readiness? _readiness;
  ApiFailure? _failure;

  @override
  void initState() {
    super.initState();
    _check();
  }

  Future<void> _check() async {
    setState(() => _state = DevStatusState.checking);
    try {
      final r = await widget.checkApi();
      if (!mounted) return;
      setState(() {
        _readiness = r;
        _failure = null;
        _state = r.ok ? DevStatusState.ok : DevStatusState.degraded;
      });
    } on ApiFailure catch (f) {
      if (!mounted) return;
      setState(() {
        _failure = f;
        _state = DevStatusState.unreachable;
      });
    }
  }

  String _message(AppLocalizations l10n) {
    String dependency(ApiDependency d) => switch (d) {
          ApiDependency.database => l10n.dependencyDatabase,
          ApiDependency.redis => l10n.dependencyRedis,
          ApiDependency.storage => l10n.dependencyStorage,
        };
    return switch (_state) {
      DevStatusState.checking => l10n.devScreenApiChecking,
      DevStatusState.ok => l10n.devScreenApiOk,
      DevStatusState.degraded => l10n.devScreenApiDegraded(_readiness!.unavailable.map(dependency).join(', ')),
      DevStatusState.unreachable => switch (_failure) {
          TimeoutFailure() => l10n.errorTimeout,
          ServerFailure(:final message) => message,
          _ => l10n.devScreenApiUnreachable(widget.environment.apiBaseUrl.toString()),
        },
    };
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final env = widget.environment;
    return DevStatusView(
      appName: l10n.appNameClient,
      pro: false,
      title: l10n.devScreenTitle,
      body: l10n.devScreenBody,
      environmentLabel: switch (env.name) {
        AppEnvironmentName.dev => l10n.environmentBadge(l10n.environmentDev),
        AppEnvironmentName.staging => l10n.environmentBadge(l10n.environmentStaging),
        AppEnvironmentName.prod => null,
      },
      state: _state,
      message: _message(l10n),
      retryLabel: l10n.actionRetry,
      onRetry: _check,
    );
  }
}
