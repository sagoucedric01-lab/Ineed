# 2. Architecture technique

## 2.1 Vue d'ensemble

```
 ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐
 │ App Ineed        │  │ App Ineed Pro    │  │ Admin web (Next.js)   │
 │ Flutter Android/ │  │ Flutter Android/ │  │ SSR + BFF, cookies    │
 │ iOS              │  │ iOS              │  │ httpOnly              │
 └────────┬─────────┘  └────────┬─────────┘  └──────────┬────────────┘
          │ HTTPS REST (JSON, OpenAPI) + WebSocket (wss)  │
          └──────────────┬──────────────────────────────┘
                         ▼
        ┌────────────────────────────────────────────┐
        │  API Ineed — NestJS (monolithe modulaire)  │
        │  ┌──────────┐ ┌──────────┐ ┌────────────┐  │
        │  │ HTTP API │ │ Gateway  │ │ Webhooks   │  │  ← même image Docker,
        │  │          │ │ WebSocket│ │ paiement   │  │    2 rôles de processus :
        │  └──────────┘ └──────────┘ └────────────┘  │    `api` et `worker`
        │  ┌──────────────────────────────────────┐  │
        │  │ Worker : BullMQ (vagues, expirations,│  │
        │  │ relances paiement, push, purges)     │  │
        │  └──────────────────────────────────────┘  │
        └───┬───────────┬───────────┬────────────┬───┘
            ▼           ▼           ▼            ▼
     PostgreSQL 16   Redis 7    Stockage S3   Prestataires externes
     + PostGIS       (files,    (photos,      (paiement, SMS/OTP,
     (source de      limites,   documents     FCM/APNs, cartes,
     vérité)         pub/sub)   privés)       Sentry)
```

**Principe directeur** : *le backend est la seule autorité*. Les applications affichent un état et envoient des intentions (« accepter l'offre X », « soumettre le devis v2 ») ; le serveur vérifie les droits, les transitions et les montants.

## 2.2 Choix techniques

| Couche | Choix | Justification |
|---|---|---|
| Mobile | Flutter 3.x (Dart 3), **Riverpod**, **go_router**, **dio**, client API généré depuis OpenAPI, `flutter_secure_storage`, `firebase_messaging`, `google_maps_flutter`, `geolocator`, `image_picker` + compression, `record` (audio), ARB/`intl` en `fr` | Un seul code pour Android/iOS ; Riverpod testable ; client généré = contrat synchronisé avec le backend |
| Monorepo mobile | **melos** : `apps/client`, `apps/pro`, `packages/ineed_core`, `ineed_ui`, `ineed_api` | Deux apps publiées, design system et logique réseau partagés |
| Backend | **NestJS 11 + TypeScript strict**, Prisma, `class-validator` / `zod` aux frontières, `@nestjs/swagger`, `pino` (logs JSON), BullMQ, Socket.IO, `argon2`, `helmet`, `@nestjs/throttler` (Redis) | Modules = frontières claires du monolithe ; écosystème mature |
| Base | **PostgreSQL 16 + PostGIS 3** | Transactions, contraintes, `geography` + GiST, `tstzrange` pour les créneaux |
| Admin | **Next.js 15 (App Router) + TypeScript**, Tailwind CSS, composants Radix, TanStack Query/Table, client API généré | Rapide à construire, responsive, typage partagé |
| Infra | Docker, docker-compose (local), images identiques pour test/production, reverse proxy TLS (Caddy ou Traefik), CI GitHub Actions | Portabilité entre hébergeurs (cf. décision T1) |
| Observabilité | Logs JSON corrélés (`request_id`), Sentry (backend, admin, mobile), `/health/live` et `/health/ready`, métriques Prometheus | Exigées par le cahier des charges |

## 2.3 Arborescence prévue

```
ineed/
├── README.md
├── package.json / pnpm-workspace.yaml     # workspace backend + admin + outils
├── .github/workflows/                     # ci-backend.yml, ci-admin.yml, ci-mobile.yml
├── docs/
│   ├── phase-1/                           # ce dossier
│   ├── api/                               # openapi.json exporté par la CI
│   ├── adr/                               # Architecture Decision Records
│   ├── deploiement.md, sauvegarde-restauration.md, publication-stores.md
│   └── statut-fonctionnalites.md          # terminé / incomplet / simulé
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── migrations/                    # migrations SQL versionnées (incl. triggers PostGIS)
│   │   └── seed/                          # référentiels + données de démo marquées DEMO
│   ├── src/
│   │   ├── main.ts, app.module.ts, worker.ts
│   │   ├── common/                        # erreurs, pagination, idempotence, guards, money, time
│   │   ├── infra/                         # prisma, redis, queue, storage, logger, config
│   │   └── modules/
│   │       ├── auth/  users/  pros/  catalog/  geo/
│   │       ├── requests/  offers/  dispatch/  missions/  quotes/
│   │       ├── payments/  (providers/cinetpay, providers/sandbox)
│   │       ├── ledger/  payouts/  promotions/
│   │       ├── notifications/  messaging/  reviews/  complaints/  reports/
│   │       ├── files/  admin/  audit/  settings/  health/
│   └── test/
│       ├── unit/  integration/ (Testcontainers PostGIS + Redis)  e2e/
├── admin/
│   ├── src/app/(auth)/  (dashboard)/[module]/...
│   ├── src/lib/api/                       # client généré
│   └── tests/ (Vitest + Playwright)
├── mobile/
│   ├── melos.yaml
│   ├── apps/client/   apps/pro/           # flavors dev / staging / prod
│   ├── packages/ineed_core/               # auth, session, config, erreurs, formatage XOF/+225
│   ├── packages/ineed_ui/                 # design system, icônes métiers, états vides/erreur
│   └── packages/ineed_api/                # client OpenAPI généré
├── infra/
│   ├── docker-compose.yml                 # postgis, redis, minio, mailpit, api, worker, admin
│   ├── docker/                            # Dockerfiles
│   ├── env/  .env.example (local, test, production)
│   └── scripts/ backup.sh, restore.sh, restore-test.sh
└── design/
    ├── logo/, icon/, tokens.json          # tokens partagés Flutter + Tailwind
```

## 2.4 Modules backend

Chaque module expose : contrôleur(s) REST, service(s) métier, dépôt (accès Prisma), DTO validés, événements de domaine. **Les modules communiquent par appel de service explicite ou événement de domaine, jamais en touchant les tables d'un autre module.**

| Module | Responsabilités | Points d'attention |
|---|---|---|
| `auth` | Envoi/vérification OTP, sessions, jetons d'accès (JWT 15 min, ES256) + jetons de rafraîchissement opaques à rotation, détection de réutilisation, connexion admin + TOTP | Limitation par numéro, IP et appareil ; fournisseur OTP derrière interface `OtpProvider` ; mode `dev_console` refusé si `NODE_ENV=production` |
| `users` | Profil client, adresses, suppression/anonymisation | Suppression = anonymisation si obligations comptables (missions payées) |
| `pros` | Inscription pro, documents, catégories/compétences, zones, horaires, disponibilité, statut de vérification | `verified_at` posé uniquement par l'action admin `pro.approve` |
| `catalog` | Catégories, sous-catégories, prestations, compétences, tarifs de référence | Lecture publique mise en cache (Redis, invalidation à la modification) |
| `geo` | Villes, zones, géocodage, distance/ETA (`MapsProvider`), recherche de pros proches | ETA routière ≠ distance à vol d'oiseau ; cache des appels payants |
| `requests` | Création brouillon, médias, publication, annulation, recherche/historique | Coordonnées précises masquées aux pros avant attribution (position arrondie ~500 m + commune) |
| `offers` | Alertes, acceptations/refus, propositions (mode programmé), expirations | Idempotence d'acceptation ; refus si offre expirée |
| `dispatch` | Moteur d'appariement : filtres, score, vagues, élargissement de rayon, règles par catégorie | Fonction pure de scoring testée unitairement ; orchestration par tâches BullMQ |
| `missions` | Machine à états, horodatages, trajet (pings), compte rendu, clôture auto | **Seul point d'écriture du statut** ; verrou optimiste `version` + `SELECT … FOR UPDATE` |
| `quotes` | Versions de devis, lignes, soumission, acceptation/refus, expiration, suppléments | Devis soumis immuable ; toute modification = nouvelle version |
| `payments` | Création de transaction, redirection/USSD, webhooks, vérification serveur-à-serveur, relances, remboursements | `PaymentProvider` : `initiate`, `verify`, `parseWebhook`, `refund` ; adaptateur `sandbox` interdit en production |
| `ledger` | Grand livre en partie double, commissions, soldes dus aux pros, rapprochement | Écritures en ajout seul ; rapport de rapprochement quotidien |
| `payouts` | Comptes de reversement, lots de reversement, validation admin, exécution via `PayoutProvider` | Aucun reversement réel sans fournisseur configuré ; double validation au-delà d'un seuil |
| `promotions` | Codes promo, contrôle d'éligibilité, application au paiement | Remise financée par Ineed : ne réduit pas le dû au pro |
| `notifications` | Gabarits, file d'envoi, FCM (APNs via FCM), SMS de secours, in-app, préférences | `dedupe_key` pour éviter les doublons lors des reprises |
| `messaging` | Conversations par (demande, pro), messages, pièces jointes, lus/non lus, WebSocket | Filtre anti-partage de numéros (avertissement), signalement |
| `reviews` | Avis après clôture, réponse du pro, modération, agrégats de note | Éligibilité vérifiée en service **et** en base |
| `complaints` / `reports` | Réclamations (avec fil support), signalements d'abus | Ouverture d'un litige → mission DISPUTED, gel du reversement |
| `files` | URL de téléversement présignées, contrôle type/taille/magie, nettoyage EXIF, antivirus (ClamAV), URL de lecture courte durée | Documents de vérification : bucket privé, chiffrement côté serveur |
| `admin` | Endpoints back-office, tableaux de bord, exports | Chaque endpoint protégé par une permission explicite |
| `audit` | Journal immuable des actions sensibles | Intercepteur + appels explicites pour avant/après |
| `settings` | Paramètres généraux et règles d'attribution modifiables à chaud | Cache court + invalidation |
| `health` | Sondes de vie/disponibilité (BD, Redis, stockage) | Utilisées par l'orchestrateur et la supervision |

## 2.5 Fiabilité de l'attribution (module critique)

**Acceptation en mode urgence** — une seule transaction :

```sql
BEGIN;
-- 1. verrouiller la demande
SELECT status, version FROM service_requests WHERE id = $req FOR UPDATE;
-- 2. vérifier l'offre du pro : appartient au pro, statut SENT/SEEN, non expirée (now() serveur)
-- 3. réserver de façon conditionnelle
UPDATE service_requests
   SET status = 'PROVISIONALLY_RESERVED', reserved_pro_id = $pro,
       reservation_expires_at = now() + make_interval(secs => $ttl), version = version + 1
 WHERE id = $req AND status IN ('MATCHING','PUBLISHED') ;
-- 0 ligne → 409 « Cette demande vient d'être prise par un autre professionnel »
UPDATE request_offers SET status='ACCEPTED', responded_at=now() WHERE id = $offer;
INSERT INTO request_status_history ...;
COMMIT;
```

Garde-fous complémentaires :
- **Index unique partiel** `missions(request_id) WHERE status <> 'CANCELLED'` : même en cas de bug applicatif, la base refuse une seconde mission active (vérifié par `schema-invariants-check.sql`).
- **Clé d'idempotence** (`Idempotency-Key`) sur accepter / confirmer / payer / soumettre devis : un double clic ou un renvoi après perte réseau renvoie la même réponse.
- **Horloge serveur uniquement** pour les expirations ; une notification reçue en retard mène à un écran « Cette demande n'est plus disponible ».
- **Tâches différées idempotentes** (BullMQ, `jobId` déterministe) pour : expiration de réservation, fin de vague, expiration d'offre, clôture auto. Au redémarrage du worker, un **balayage de rattrapage** traite toute échéance dépassée (`reservation_expires_at < now()`), ce qui couvre la « reprise après interruption du serveur ».
- Un pro ne peut avoir qu'une mission urgente active à la fois (paramétrable).

## 2.6 Paiements

```
App ──POST /missions/:id/payments (Idempotency-Key)──▶ API ──initiate──▶ Prestataire
App ◀── checkout_url / instructions USSD ───────────── API
Client paie sur son téléphone
Prestataire ──webhook signé──▶ API /webhooks/payments/:provider
   API : enregistre l'événement (dédoublonné) → appelle verify() côté serveur
       → si SUCCEEDED confirmé : transaction BD { payment SUCCEEDED, écritures grand livre,
         commission, transition mission } → notifications
Worker : relance verify() pour les paiements PENDING (polling de secours), expiration
```

- Le retour « succès » de l'application n'a **aucune valeur** : seul `verify()` serveur-à-serveur fait foi.
- Notification répétée → `UNIQUE(provider, provider_event_id)` + transition idempotente (SUCCEEDED → SUCCEEDED = no-op).
- L'adaptateur `sandbox` génère des transactions marquées `is_sandbox = true`, affichées « PAIEMENT DE TEST » dans toutes les interfaces, et le démarrage du serveur échoue si `PAYMENT_PROVIDER=sandbox` en production.

## 2.7 Sécurité (résumé)

- Jetons d'accès courts, rafraîchissement à rotation avec révocation de famille ; révocation de toutes les sessions depuis l'admin.
- RBAC : rôles CLIENT, PRO, ADMIN_SUPER, ADMIN_OPS, ADMIN_FINANCE, ADMIN_SUPPORT, ADMIN_MODERATION ; permissions fines vérifiées par un guard. **Contrôle d'appartenance systématique** (un client ne lit que ses demandes, un pro que ses offres/missions) testé par des tests d'accès négatifs.
- Premier administrateur créé par une **commande CLI ponctuelle** (`pnpm admin:bootstrap --email …`), qui exige l'activation TOTP à la première connexion. Aucun compte ni mot de passe dans le code.
- Secrets : variables d'environnement injectées par l'hébergeur / gestionnaire de secrets ; aucune clé secrète dans les apps mobiles (seules les clés publiques restreintes : Maps par empreinte d'application, Firebase).
- Fichiers : URL présignées, liste blanche MIME + vérification de signature, taille max, suppression EXIF/GPS des photos, antivirus, buckets privés pour documents.
- Limitation de débit : OTP (ex. 3/10 min par numéro, 10/h par IP), connexion admin, création de demandes, messages.
- Données de position : seule la dernière position du pro est conservée hors mission ; les pings de trajet sont purgés 30 jours après clôture (paramètre).
