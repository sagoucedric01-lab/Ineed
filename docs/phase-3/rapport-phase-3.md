# Rapport de fin de phase 3 — Projets, base de données et migrations

Date : 28/10/2026. Branche : `phase-3-socle`.

## Critères d'acceptation (définis en phase 1)

| Critère | Résultat | Preuve |
|---|---|---|
| `docker compose up` démarre PostGIS, Redis, stockage S3, API et admin | ✅ | Exécuté dans cet environnement avec `--wait` : 6 services sains, `setup` terminé avec le code 0 ; également en CI (job « docker ») |
| `pnpm migrate` sur base vide passe | ✅ | Test d'intégration + CI + service `setup` de docker compose |
| `/health/ready` = 200 | ✅ | `{"status":"ok"}` avec PostGIS 3.5.2, Redis, S3 et worker actif ; 503 qui nomme la dépendance en panne |
| CI verte (lint, typage, tests) | voir § CI | `.github/workflows/ci.yml` |
| `flutter analyze` et `flutter test` passent | ✅ | Aucune remarque ; 40 tests |
| Swagger servi sur `/docs` | ✅ | Hors production uniquement (testé) ; export `docs/api/openapi.json` vérifié à jour en CI |

## Ce qui a été construit

**Backend** (`backend/`, NestJS 12, modules ES, TypeScript 6.0)
- Configuration validée au démarrage (zod). En `APP_ENV=production`, le serveur refuse de démarrer avec le simulateur de SMS, le simulateur de paiement, ou un bucket privé confondu avec le bucket public.
- Santé : `/health/live`, `/health/ready` (base + PostGIS, Redis, S3, battement du worker), chaque contrôle étant limité à 2 s.
- Erreurs au format unique `{ error: { code, message, details, requestId } }`, messages en français, aucun détail interne divulgué ; identifiant de requête propagé ; journaux JSON avec masquage des en-têtes d'authentification, cookies, codes et téléphones ; en-têtes de sécurité (helmet).
- Utilitaires partagés : montants XOF entiers (`17 500 F CFA`), téléphones +225 (E.164), heure d'Abidjan.
- Worker séparé (même image) qui signale sa présence ; les files de tâches arrivent en phase 6.

**Base de données** (Prisma 7.10.1)
- Migration initiale = schéma validé en phase 1, appliquée telle quelle (contraintes, triggers, index partiels, PostGIS).
- `schema.prisma` obtenu par introspection puis converti en noms TypeScript idiomatiques (`ServiceRequest`, `clientId`) ; **zéro dérive** avec les migrations, vérifié en CI.
- Migration corrective : unicité des communes (`NULLS NOT DISTINCT`), défaut détecté en écrivant les seeds.
- Seeds : référentiel idempotent qui n'écrase pas les réglages modifiés par l'administration ; démonstration marquée et refusée hors local/test.

**Administration** (`admin/`, Next.js 16.4.3, Tailwind 4 alimenté par les tokens) : page « État de la plateforme » rendue côté serveur.

**Mobile** (`mobile/`, Flutter 3.47.7, pub workspaces) : applications Ineed et Ineed Pro, paquets `ineed_core`, `ineed_api`, `ineed_ui` ; thème clair/sombre issu des tokens, polices embarquées, textes générés depuis `design/copy`, icônes, variantes Android dev/staging/prod, identifiants `ci.ineed.app` et `ci.ineed.pro`.

**Infrastructure** : images Docker (utilisateur non root, healthchecks), docker compose, CI GitHub Actions (7 jobs).

## Tests exécutés dans cet environnement

| Suite | Résultat |
|---|---|
| Backend — unitaires (Vitest) | 50 / 50 |
| Backend — intégration sur vrais PostgreSQL/PostGIS, Redis, S3 | 20 / 20 |
| Administration (Vitest) | 5 / 5 |
| Design (contrastes, textes, fichiers générés, tests) | 7 / 7 + contrôles OK |
| Mobile (`flutter test`, 5 projets) | 40 / 40 ; `flutter analyze` : aucune remarque |
| Lint et typage (backend, admin) | OK |
| `pnpm audit` | 0 vulnérabilité |
| docker compose complet, redémarrage de l'API, coupure puis retour de Redis | OK (voir ci-dessous) |

Scénarios de reprise vérifiés manuellement sur la pile Docker :
- redémarrage du conteneur API → de nouveau prêt sans intervention ;
- arrêt de Redis → `/health/ready` répond 503 en nommant Redis ; redémarrage de Redis → retour à 200 sans redémarrer l'API.

## CI GitHub

Résultat de la première exécution : voir § Résultat CI en fin de document.

## Écarts par rapport au plan, et pourquoi

| Plan | Réalisé | Raison |
|---|---|---|
| MinIO comme stockage S3 local | SeaweedFS 4.46 | MinIO ne publie plus d'images Docker communautaires (`minio/minio` introuvable) |
| Mailpit dans docker compose | Non inclus | Aucun e-mail avant la phase 9 ; sera ajouté à ce moment-là |
| melos pour le monorepo Flutter | Pub workspaces natifs de Dart | Une dépendance de moins ; la version de melos disponible avait un jour |
| TypeScript « dernière version » | 6.0.3 | TypeScript 7 n'a plus d'API JavaScript : typescript-eslint, Next.js et l'outillage de typage ne fonctionnent pas avec |
| ESLint 10 | 9.39 | Le plugin React utilisé par Next.js ne prend pas encore en charge ESLint 10 |
| Règle « versions publiées depuis au moins 2 semaines » | Exception pour Next.js 16.4.3, Prisma 7.10.1, multer 2.5.0 | Correctifs de failles de sécurité, dont deux critiques (exécution de code à distance) dans Next.js 16.4.0, révélées par `pnpm audit` |
| Client API mobile généré depuis OpenAPI | Client Dio écrit à la main | Une seule route existe ; la génération sera mise en place en phase 4, avec les premières routes métier |

## Limites restantes

- **iOS** : identifiants et noms configurés, mais ni variantes (schémas Xcode), ni build, ni test sur iPhone : un Mac est nécessaire (phase 10).
- **Android** : APK de développement construit en CI uniquement (le SDK Android n'est pas installé dans cet environnement). Aucun test sur un téléphone réel.
- **Image Docker de l'API** : 804 Mo, à alléger avant la production.
- **Communes d'Abidjan** : centroïdes approximatifs, contours non saisis.
- **Catalogue** : aucune prestation n'a de prix ; les tarifs restent à fixer par l'équipe commerciale (décision D9).
- **Données de démonstration** : des numéros fictifs au format ivoirien (+225 07 00 00 00 xx) ; ils ne servent qu'en local et en test.

## Variables et accès à configurer

Aucun accès externe n'est nécessaire pour cette phase. Pour la **phase 4 (authentification)** : un compte chez le fournisseur de SMS retenu (décision D5) ; sans lui, la connexion fonctionnera uniquement en mode développement (code affiché dans les journaux), signalé comme tel.

## Résultat CI
