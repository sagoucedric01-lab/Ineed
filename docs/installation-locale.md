# Installation locale

Ce guide permet de lancer Ineed sur un poste de développement (Linux, macOS ou Windows avec WSL 2).

## Prérequis

| Outil | Version | Pour |
|---|---|---|
| Node.js | 22 (voir `.nvmrc`) | API, worker, administration, outils de design |
| pnpm | 10.28 (`npm install -g pnpm@10.28.0`) | Dépendances JavaScript |
| Docker + Docker Compose | Docker 24+, Compose v2 | PostgreSQL/PostGIS, Redis, stockage S3 |
| Flutter | 3.47.7 (stable) | Applications mobiles |
| Android Studio / SDK Android, Java 17 | — | Émulateur et APK Android |
| Xcode (macOS uniquement) | — | Application iOS |

## 1. Récupérer le code et les dépendances

```bash
git clone https://github.com/sagoucedric01-lab/Ineed.git
```

```bash
cd Ineed && pnpm install
```

## 2. Option A : tout lancer dans Docker

Générer une fois les secrets locaux (clé de signature des sessions, clé de chiffrement, sel des codes SMS). Le fichier n'est pas versionné :

```bash
node tools/generate-dev-secrets.mjs --write infra/.env.secrets
```

```bash
docker compose -f infra/docker-compose.yml up --build
```

Ce que fait cette commande :

- démarre PostgreSQL 16 + PostGIS, Redis et le stockage S3 (SeaweedFS) ;
- applique les migrations, charge le référentiel (communes d'Abidjan, catégories, rôles…) et crée les buckets (service `setup`) ;
- démarre l'API sur http://localhost:3000, le worker et l'administration sur http://localhost:3001.

Vérifications :

- http://localhost:3000/health/ready renvoie `"status":"ok"` ;
- http://localhost:3000/docs affiche la documentation de l'API (Swagger) ;
- http://localhost:3001 affiche « État de la plateforme ».

Pour ajouter les données de démonstration (fictives, marquées « démo ») :

```bash
docker compose -f infra/docker-compose.yml run --rm setup node_modules/.bin/tsx prisma/seed/run.ts --demo
```

Tout arrêter et effacer les données locales :

```bash
docker compose -f infra/docker-compose.yml down -v
```

## 3. Option B : services dans Docker, code en mode développement

Démarrer uniquement PostgreSQL, Redis et le stockage :

```bash
pnpm dev:infra
```

Préparer l'API (une seule fois) :

```bash
cp backend/.env.example backend/.env && node tools/generate-dev-secrets.mjs --write backend/.env
```

```bash
pnpm --filter @ineed/backend build && pnpm migrate && pnpm seed && pnpm --filter @ineed/backend buckets:ensure
```

Lancer l'API, le worker et l'administration (trois terminaux) :

```bash
pnpm --filter @ineed/backend dev
```

```bash
pnpm --filter @ineed/backend dev:worker
```

```bash
cp admin/.env.example admin/.env.local && pnpm --filter @ineed/admin dev
```

> L'API est compilée par `tsc` en continu (`scripts/dev.mjs`) : NestJS a besoin des métadonnées de décorateurs, que `tsx` et esbuild ne produisent pas.

## 4. Connexion en mode développement (codes SMS)

Aucun fournisseur SMS n'est configuré : avec `OTP_PROVIDER=dev_console` (valeur par défaut hors production), **aucun SMS n'est envoyé**.
Le code à 6 chiffres est écrit dans les journaux de l'API, par exemple :

```text
WARN [OTP (développement)] [DÉVELOPPEMENT — aucun SMS envoyé] Code pour +2250712345678 : 483920
```

Les applications affichent « Mode développement » sur l'écran de saisie du code. Ce mode est refusé au démarrage quand `APP_ENV=production`.
Pour de vrais SMS, renseignez `OTP_PROVIDER=twilio_verify` et les trois variables `TWILIO_*` (voir `backend/.env.example`).

## 5. Premier compte administrateur

Aucun compte administrateur n'existe par défaut et aucun mot de passe n'est écrit dans le code. Le premier super-administrateur se crée en ligne de commande (refusé s'il en existe déjà un) :

```bash
pnpm --filter @ineed/backend admin:bootstrap --email exploitation@exemple.ci --first-name Aminata --last-name Diallo
```

Avec Docker :

```bash
docker compose -f infra/docker-compose.yml run --rm setup node dist/cli/admin-bootstrap.js --email exploitation@exemple.ci --first-name Aminata --last-name Diallo
```

Le mot de passe provisoire s'affiche **une seule fois**. À la première connexion (`POST /v1/admin/auth/login`), l'API renvoie une graine TOTP à enregistrer dans une application d'authentification ;
la connexion se termine avec un code TOTP (`POST /v1/admin/auth/totp`). L'interface web de connexion arrive en phase 9 ; d'ici là, ces routes s'utilisent depuis `/docs`.

## 6. Applications mobiles

```bash
cd mobile && flutter pub get
```

Lancer l'application client sur un émulateur Android (l'API locale est joignable à l'adresse `10.0.2.2` depuis l'émulateur) :

```bash
cd mobile/apps/client && flutter run --flavor dev --dart-define-from-file=config/dev.json
```

Même commande dans `mobile/apps/pro` pour Ineed Pro.

- Sur un téléphone réel, remplacez `INEED_API_URL` dans `config/dev.json` par l'adresse IP de votre ordinateur sur le réseau local.
- Fond de carte (`INEED_MAP_TILE_URL`, application client) : en développement et en préproduction, les tuiles publiques
  OpenStreetMap ; elles sont **refusées en production** (règles d'usage d'OpenStreetMap). Sans valeur, la carte est masquée
  et l'adresse se saisit avec la position du téléphone, la commune et un repère.
- La variante « dev » autorise HTTP en clair (API locale) ; staging et production n'acceptent que HTTPS.
- Sur iOS, lancez sans `--flavor` : les variantes iOS (schémas Xcode) seront configurées lors de la préparation de la publication, sur un Mac.

## 7. Tests et vérifications

| Commande | Vérifie |
|---|---|
| `pnpm --filter @ineed/backend test` | Tests unitaires de l'API |
| `pnpm --filter @ineed/backend test:integration` | Tests d'intégration (nécessite `pnpm dev:infra` et des buckets créés ; secrets de test générés automatiquement) |
| `pnpm --filter @ineed/backend migrate:check-drift` | Cohérence migrations SQL ↔ `schema.prisma` (base temporaire `SHADOW_DATABASE_URL`) |
| `pnpm --filter @ineed/admin test` | Tests de l'administration |
| `pnpm --filter @ineed/design run check` | Contrastes, textes, fichiers générés |
| `bash mobile/tool/check.sh` | Analyse et tests Flutter |
| `pnpm audit --audit-level high` | Vulnérabilités connues des dépendances |
| `pnpm lint && pnpm typecheck` | Tous les projets JavaScript |

La CI GitHub (`.github/workflows/ci.yml`) exécute l'ensemble à chaque push, y compris la construction des images Docker et un démarrage complet avec `docker compose`.

## Construire les images derrière un proxy d'entreprise

Si le réseau impose un proxy HTTPS avec un certificat interne :

```bash
docker build --build-arg HTTPS_PROXY="$HTTPS_PROXY" --secret id=extra_ca,src=/chemin/vers/ca.crt -f infra/docker/backend.Dockerfile --target runtime .
```

## Problèmes fréquents

| Symptôme | Cause probable |
|---|---|
| L'API refuse de démarrer avec « Configuration invalide » | Une variable manque ou est invalide dans `backend/.env` : le message nomme la variable |
| `/health/ready` répond 503 | Le rapport JSON indique la dépendance en panne (base, Redis ou stockage) |
| `docker compose` : port 5432 ou 6379 déjà utilisé | Un PostgreSQL ou un Redis local tourne déjà : arrêtez-le ou changez le port dans `infra/docker-compose.yml` |
| Application mobile : « Impossible de joindre l'API » | Mauvaise adresse dans `config/dev.json` (émulateur : `10.0.2.2` ; téléphone : IP du poste) |
