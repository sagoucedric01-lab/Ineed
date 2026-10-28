# Rapport de fin de phase 2 — Parcours, écrans et système de design

Date : 28/10/2026.

## Critères d'acceptation (définis en phase 1)

| Critère | Résultat | Preuve |
|---|---|---|
| Tokens JSON consommés par Flutter et Tailwind | ✅ | `design/generated/` ; `dart analyze --fatal-infos` : *No issues found* ; preset Tailwind généré (consommé en phase 3 par l'admin) |
| Contrastes AA vérifiés par script | ✅ | `check-contrast.mjs` : 23 paires × 2 thèmes conformes. Le script a détecté un vrai défaut (orange sur orange pâle, 4,40), corrigé |
| Inventaire des écrans avec leurs états | ✅ | `docs/phase-2/inventaire-ecrans.md` : 32 écrans client, 22 pro, 25 modules admin, états C/V/E/H/S |
| Aucun texte factice | ✅ | `check-copy.mjs` (texte factice, typographie, doublons, paramètres) sur 696 textes ; `flutter gen-l10n` : 380 textes client et 322 pro compilés |
| Maquettes des écrans clés, logo, icônes, icônes métiers | ✅ | 24 écrans (16 client, 6 pro, 2 admin) en thèmes clair et sombre (48 PNG), logo, 2 icônes d'application, 12 icônes métiers, 20 icônes d'interface |

## Commandes exécutées et résultats

```text
$ pnpm run check
Toutes les paires respectent leur seuil.
Tous les textes sont conformes.
Fichiers générés à jour.
# pass 7
# fail 0

$ bash scripts/check-flutter.sh        (Flutter 3.35.7, Dart 3.9.2)
gen-l10n client : OK (380 textes)
gen-l10n pro : OK (322 textes)
No issues found!

$ node scripts/render.mjs
Débordement horizontal à 390 px : 0 px
48 captures d'écran dans maquettes/png/
```

Non-régression phase 1 : le schéma et ses 10 vérifications d'invariants n'ont pas été modifiés.

## Fichiers créés

- `design/` : `README.md`, `package.json`, `tokens.json`, `generated/` (3 fichiers), `brand/` (7 SVG + 4 PNG), `icons/categories/` (12), `icons/ui/` (20), `copy/` (5 fichiers), `maquettes/` (`src.html`, `index.html`, `png/` ×48), `scripts/` (9 fichiers).
- `docs/phase-2/` : `inventaire-ecrans.md`, ce rapport.

## Ce qui fonctionne réellement

- La chaîne tokens → Dart / CSS / Tailwind, avec contrôle « fichiers à jour » utilisable en CI.
- Les contrôles automatiques (contrastes, textes, compilation Flutter des traductions).
- Les maquettes sont rendues avec les vrais tokens, icônes et textes : ce que montrent les captures correspond aux valeurs que les applications utiliseront.

## Limites

- **Les maquettes sont des pages HTML statiques**, pas des écrans Flutter : aucune interaction, aucune donnée réelle. Les noms, adresses et montants sont des exemples, signalés comme tels sur la page.
- Les **cartes** des maquettes sont des dessins schématiques ; le vrai fournisseur cartographique arrive en phase 5.
- Les **pastilles des opérateurs** (Orange Money, MTN, Wave) sont des initiales colorées : les logos officiels devront venir des kits fournis par le prestataire de paiement ou les opérateurs, avec leur accord.
- Le **logo** est provisoire : le mot-symbole est du texte SVG (à vectoriser par un graphiste) et aucune recherche d'antériorité de marque n'a été faite.
- Le **taux de commission de 10 %** affiché dans P-16 est un exemple : la décision D9 reste à chiffrer.
- **Flutter 3.35.7** est installé dans l'environnement (hors dépôt, `/opt/flutter`). En phase 3, je vérifierai la dernière version stable avant de créer les projets.
- Tests sur appareils réels et build iOS : toujours impossibles dans cet environnement.

## Variables et accès à configurer

Aucun pour cette phase. La phase 3 nécessite **un dépôt Git à votre nom** pour pousser le code : le projet n'existe pour l'instant que dans ce conteneur temporaire.
