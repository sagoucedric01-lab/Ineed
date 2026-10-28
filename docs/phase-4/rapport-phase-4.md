# Rapport de fin de phase 4 — Authentification, profils et inscription des professionnels

Date : 28/10/2026. Branche : `phase-4-auth` (construite sur `phase-3-socle`).

**Mode de travail : développement pour les SMS.** Aucun fournisseur SMS n'étant configuré, les codes de connexion sont écrits
dans les journaux de l'API (`OTP_PROVIDER=dev_console`). Ce mode est signalé dans les applications (« Mode développement »)
et refusé au démarrage en production.

## Critères d'acceptation (définis en phase 1)

| Critère | Résultat | Preuve |
|---|---|---|
| T1 — inscription d'un client | ✅ | `auth.int.spec.ts` (création au premier code, profil, numéro reconnu sous une autre écriture, refus des saisies invalides) ; parcours complet dans l'application client (`app_flow_test.dart`) |
| T2 — inscription d'un professionnel | ✅ | `pro-onboarding.int.spec.ts` (brouillon, manques listés, refus d'un dossier incomplet, soumission, verrouillage) ; parcours complet dans Ineed Pro |
| T3 — validation administrative | ✅ | `pro-onboarding.int.spec.ts` : file d'attente, consultation journalisée des justificatifs privés, refus motivé, demande de compléments, validation, décisions concurrentes, suspension |
| T24 — accès non autorisé | ✅ | `access-control.int.spec.ts` : matrice 13 routes × 7 profils (91 cas), garde sur la liste des routes publiques et sur la règle de chaque route admin/pro |
| T25 — suppression de compte | ✅ | `account-deletion.int.spec.ts` : code SMS dédié, anonymisation, photo effacée, tous les appareils déconnectés, refus si une demande est en cours |
| Limitation de débit des codes testée | ✅ | Délai de 60 s, 3 codes par numéro / 10 min, 10 demandes par IP / heure, blocage au 5ᵉ essai, code à usage unique même en requêtes simultanées |
| Mode OTP de développement refusé en production | ✅ | `env.spec.ts` : démarrage refusé avec `dev_console` quand `APP_ENV=production` |

## Ce qui a été construit

### API (NestJS)

- **Codes SMS** : fournisseur interchangeable. `dev_console` (développement, codes dans les journaux) et `twilio_verify`
  (adaptateur écrit et testé sur les réponses documentées par Twilio, **jamais essayé avec un vrai compte**).
  Codes stockés hachés (HMAC avec un sel secret), réponse identique que le numéro ait un compte ou non.
- **Sessions** : jeton d'accès ES256 de 15 minutes et jeton de rafraîchissement opaque, stocké haché, renouvelé à chaque usage.
  La réutilisation d'un ancien jeton (hors délai de grâce de 10 s) déconnecte l'appareil. Liste des appareils, déconnexion à distance.
  Le statut du compte, les rôles et les permissions sont relus à chaque requête : un compte suspendu est refusé immédiatement.
- **Contrôle d'accès** : garde globale ; chaque route est publique, ou réservée à une application (client, pro, admin), un rôle et une permission.
  Un jeton de l'application client ne donne pas accès à l'espace pro, et une session admin ne sert pas sur mobile.
- **Compte** : profil (prénom, nom, photo), suppression avec un code SMS dédié et anonymisation.
- **Fichiers** : dépôt direct dans le stockage par URL présignée. À la finalisation, le serveur vérifie le contenu réel
  (pas seulement le type annoncé) et ré-encode les images, ce qui supprime les métadonnées, position GPS comprise.
  Les justificatifs vont dans un bucket privé, lisible seulement par un lien de quelques minutes dont chaque ouverture est journalisée.
- **Espace professionnel** : dossier (type de compte, nom affiché, RCCM pour une entreprise, métiers 1 à 3, spécialités,
  communes, horaires), justificatifs, liste des manques calculée par le serveur, envoi, disponibilité.
- **Validation (API d'administration)** : file d'attente, fiche, approuver, refuser (motif obligatoire), demander des compléments,
  suspendre, réactiver. Les transitions sont contrôlées, une décision ne peut pas s'appliquer deux fois, et chaque action est
  inscrite au journal d'audit et crée une notification dans l'application.
- **Connexion administrateur** : mot de passe argon2id puis code TOTP obligatoire, la graine étant fournie à la première connexion.
  Un code TOTP ne peut pas être rejoué ; le compte est bloqué 15 min après 5 échecs ; la réponse est identique pour un e-mail inconnu.
- **Premier administrateur** : outil en ligne de commande `admin:bootstrap`, avec un mot de passe aléatoire affiché une fois.
  Il refuse d'agir si un super-administrateur existe. Aucun compte ni mot de passe n'est écrit dans le code.
- **Socle transverse** : journal d'audit (ajout seul), paramètres administrables avec cache de 30 s, notifications
  (gabarits, enregistrement en base ; l'envoi push arrive en phase 8) et limiteur de débit sur Redis.
  Les erreurs de validation renvoient `422 VALIDATION_FAILED`, avec le détail par champ.

### Applications mobiles (Flutter)

- **Paquet `ineed_api`** :
  - client de l'API ;
  - renouvellement de session unique, même si plusieurs requêtes échouent en même temps ;
  - session effacée seulement sur un refus explicite (une coupure réseau la conserve) ;
  - erreurs typées.
- **Paquet `ineed_shared`**, parcours communs aux deux applications :
  - numéro de téléphone, saisie du code, prénom et nom ;
  - compte, appareils connectés, suppression du compte ;
  - écran de démarrage.

  Les jetons sont rangés dans le stockage sécurisé du téléphone, sous une clé distincte pour chaque application.
- **Ineed (client)** : présentation, connexion, profil, accueil avec les métiers (non cliquables avant la phase 5), compte.
- **Ineed Pro** :
  - connexion et dossier en 4 étapes (informations, activité, photo, justificatifs), avec le message de l'équipe quand des compléments sont demandés ;
  - justificatifs en photo ou en PDF, contrôlés avant l'envoi : type et 10 Mo au plus ;
  - envoi du dossier, puis écran de suivi (en vérification, refusé, suspendu) ;
  - tableau de bord du professionnel validé, avec la disponibilité enregistrée sur le serveur.

### Documentation et outillage

- `tools/generate-dev-secrets.mjs` : génère les secrets locaux (clé de signature, clé de chiffrement, sel des codes). Ils ne sont pas versionnés ; la CI génère les siens.
- `docs/installation-locale.md` : secrets, codes SMS de développement, premier administrateur.
- `docs/api/openapi.json` : 32 routes, vérifié à jour en CI.
- `mobile/tool/check.sh` couvre désormais `ineed_shared`.

## Fichiers créés ou modifiés (principaux)

| Zone | Fichiers |
|---|---|
| API | `backend/src/auth/**` (garde, décorateurs, jetons, sessions, fournisseurs de codes), `users/`, `files/`, `catalog/`, `pros/`, `admin-auth/`, `audit/`, `settings/`, `notifications/`, `common/crypto/` (chiffrement, TOTP, jetons), `common/rate-limit/`, `common/http/`, `config/env.ts`, `cli/admin-bootstrap.ts` |
| Tests API | `backend/test/helpers/*`, `backend/test/integration/{auth,pro-onboarding,access-control,account-deletion}.int.spec.ts`, `src/**/*.spec.ts` |
| Mobile | `mobile/packages/ineed_api/**`, `mobile/packages/ineed_shared/**` (nouveau), `mobile/apps/client/lib/**`, `mobile/apps/pro/lib/**`, tests de chaque projet |
| Design | `design/copy/*` (textes des nouveaux écrans), icônes des métiers copiées dans `ineed_ui` |
| Outillage | `tools/generate-dev-secrets.mjs`, `infra/docker-compose.yml` (secrets hors dépôt), `.github/workflows/ci.yml`, `mobile/tool/check.sh` |
| Docs | `docs/phase-4/rapport-phase-4.md`, `docs/statut-fonctionnalites.md`, `docs/installation-locale.md`, `README.md`, `docs/api/openapi.json` |

Aucune migration de base n'a été nécessaire : le schéma validé en phase 1 couvrait déjà ces fonctionnalités.

## Tests exécutés

Dans cet environnement (PostgreSQL 16 + PostGIS, Redis et stockage S3 SeaweedFS réels pour l'intégration) :

| Suite | Résultat |
|---|---|
| Backend — unitaires (Vitest) | 72 / 72 |
| Backend — intégration | 161 / 161 |
| Administration (Vitest) | 5 / 5 |
| Mobile — `flutter analyze --fatal-infos` | aucune remarque |
| Mobile — `flutter test` : ineed_core 18, ineed_api 13, ineed_ui 6, ineed_shared 3, client 8, pro 11 | 59 / 59 |
| Lint et typage (backend, admin) | OK |
| Outil `admin:bootstrap` sur une base temporaire | Compte créé (hachage argon2id, entrée d'audit) ; deuxième exécution refusée (code 1) |

Les tests mobiles s'exécutent sur un **faux serveur** : ils vérifient les écrans, la navigation et les requêtes envoyées.
Les échanges réels application ↔ API ne sont pas couverts par ces tests.

CI GitHub : voir la section suivante.

## CI GitHub

Les 7 jobs (design, audit, backend, administration, mobile avec APK de développement, images Docker et démarrage complet) sont
exécutés à chaque push ; résultat de l'exécution finale indiqué dans la demande de fusion.

## Limitations connues

- **Aucun SMS réel** : connexion uniquement en mode développement tant qu'un compte Twilio Verify (ou autre fournisseur) n'est pas fourni.
  L'adaptateur Twilio n'a jamais été essayé contre le vrai service.
- **Aucun essai sur téléphone, émulateur ou iOS** : les APK de développement sont construits en CI, mais aucune application n'a été lancée sur un appareil.
- **Interface d'administration** : connexion et validation des professionnels disponibles par l'API seulement (via `/docs`) ; les écrans arrivent en phase 9.
  La création d'autres comptes administrateurs n'existe pas encore.
- **Notifications** : enregistrées en base, sans envoi push (phase 8).
- **Changement d'un dossier validé** (ajout d'un métier, nouvelle vérification) : prévu avec les réglages du professionnel (phase 5–6).
- **Point de départ et rayon d'intervention** : acceptés par l'API, pas encore saisis dans l'application (ils arrivent avec la géolocalisation en phase 5).

## Variables et accès à configurer

| Variable / accès | Où | Commentaire |
|---|---|---|
| `JWT_PRIVATE_KEY_B64`, `DATA_ENCRYPTION_KEY_B64`, `OTP_PEPPER` | API | Générés par `tools/generate-dev-secrets.mjs` en local ; **en production, à créer dans le gestionnaire de secrets de l'hébergeur** |
| `OTP_PROVIDER=twilio_verify`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID` | API | Obligatoires pour envoyer de vrais SMS (et pour la production) |
| `JWT_ISSUER`, `ACCESS_TOKEN_TTL_S`, `REFRESH_TOKEN_TTL_DAYS`, `ADMIN_REFRESH_TOKEN_TTL_HOURS` | API | Valeurs par défaut raisonnables (15 min, 60 jours, 12 h) |
| `TRUST_PROXY_HOPS` | API | Nombre de proxys devant l'API, pour que la limitation par adresse IP voie la vraie adresse |
| `S3_PUBLIC_ENDPOINT` | API | Adresse du stockage vue par les téléphones (URL présignées) |
| Premier super-administrateur | Exploitation | `pnpm --filter @ineed/backend admin:bootstrap --email … --first-name … --last-name …` |

## Non-régression

- Les tests de la phase 3 passent toujours, notamment les migrations, les invariants, le référentiel et la santé.
- `docs/api/openapi.json` est régénéré, et sa mise à jour est vérifiée en CI.
- Le schéma Prisma n'a pas dérivé des migrations (vérifié en CI).
