#!/usr/bin/env bash
# Vérifications mobiles (CI et poste local) : textes à jour, dépendances, analyse statique, tests.
# Usage : bash mobile/tool/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
node ../design/scripts/merge-arb.mjs --check
node ../design/scripts/build-tokens.mjs --check
flutter pub get
for app in apps/client apps/pro; do (cd "$app" && flutter gen-l10n); done
flutter analyze --fatal-infos
for dir in packages/ineed_core packages/ineed_api packages/ineed_ui apps/client apps/pro; do
  echo "== Tests : $dir"
  (cd "$dir" && flutter test)
done
