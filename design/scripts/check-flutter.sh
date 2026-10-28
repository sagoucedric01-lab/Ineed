#!/usr/bin/env bash
# Valide avec la chaîne Flutter : (1) les tokens Dart générés compilent sans avertissement,
# (2) les fichiers ARB fusionnés (communs + application) passent `flutter gen-l10n` (syntaxe ICU, paramètres).
# Prérequis : flutter dans le PATH. Usage : bash design/scripts/check-flutter.sh
set -euo pipefail
DESIGN="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/lib/tokens"
cat > "$WORK/pubspec.yaml" <<'YAML'
name: ineed_design_check
publish_to: none
environment:
  sdk: ^3.9.0
dependencies:
  flutter: { sdk: flutter }
  flutter_localizations: { sdk: flutter }
  intl: any
flutter:
  generate: true
YAML
cp "$DESIGN/generated/flutter/ineed_tokens.dart" "$WORK/lib/tokens/"
node "$DESIGN/scripts/merge-arb.mjs" "$WORK/lib"
cd "$WORK"
flutter pub get >/dev/null
for app in client pro; do
  flutter gen-l10n --arb-dir "lib/l10n_$app" --template-arb-file app_fr.arb \
    --output-dir "lib/gen_$app" --output-localization-file "${app}_l10n.dart" >/dev/null
  echo "gen-l10n $app : OK ($(grep -cE '^  String (get )?[a-zA-Z]+' "lib/gen_$app/${app}_l10n_fr.dart") textes)"
done
dart analyze --fatal-infos lib
