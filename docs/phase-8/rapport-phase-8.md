# Rapport de fin de phase 8 — Notifications, messagerie, évaluations

Date : 29/10/2026. Branche : `phase-8-messagerie` (construite sur `phase-7-paiements`).

## Point essentiel

Messagerie, avis et réclamations fonctionnent de bout en bout : API, temps réel et applications, tous testés.

Les notifications push sont prêtes côté serveur, avec une file d'envoi, des reprises et l'adaptateur Firebase Cloud Messaging. **Elles ne partent pas encore vers les téléphones** : aucun projet Firebase n'a été fourni. Deux choses manquent donc :

- l'adaptateur FCM n'a fait aucun envoi réel (tests de contrat seulement) ;
- les applications ne demandent pas encore de jeton push, car Firebase n'y est pas ajouté.

Les notifications restent créées en base et visibles dans les applications.

## Critères d'acceptation

| Critère | Résultat | Ce qui est vérifié (`backend/test/integration/engagement.int.spec.ts`, sauf mention) |
|---|---|---|
| T7 — envoi réel vers FCM « si un projet Firebase est fourni » | ⏸️ Non fourni | **Ce qui reste à faire** : un envoi réel, possible dès que le projet et le compte de service sont configurés.<br>**Tests de contrat** (`fcm.provider.spec.ts`) :<br>• assertion JWT RS256 vérifiée avec la clé publique ;<br>• jeton d'accès mis en cache ;<br>• format du message HTTP v1 ;<br>• jeton désinscrit ou invalide : désactivation ;<br>• quota, panne, réseau : nouvel essai ;<br>• jeton d'accès expiré : renouvelé une fois. |
| T22 — évaluation | ✅ | **Refus avant la clôture** : refusée par l'API (409) et par la base (déclencheur).<br>**Après la clôture** : acceptée une seule fois, par le seul client de la mission (un autre client → 404, le professionnel → 403), et dans les 30 jours.<br>**Note du professionnel** : recalculée sur les avis publiés.<br>**Réponse du professionnel** : une seule.<br>**Profil public** : prénom et initiale de l'auteur, sans nom complet ni numéro.<br>**Commentaire avec des coordonnées** : en attente de modération, ni publié ni compté. |
| T23 — réclamation | ✅ | **Ouverture sur une mission terminée** : la mission passe en litige, la clôture automatique ne s'applique pas, le reversement est gelé et le professionnel est prévenu. Une deuxième réclamation sur la même mission est refusée.<br>**Fil avec le support** : la réponse est notifiée au client, la note interne ne lui est jamais montrée, et sa réponse renvoie la réclamation au support.<br>**Décision** : texte obligatoire, remboursement partiel lié à la réclamation, journalisée.<br>**Accès** : un autre client ne voit rien (404) ; le rôle Modération n'accède pas aux réclamations (403).<br>**Réclamation du professionnel** : notifiée dans Ineed Pro ; assistance possible sans mission. |
| Message renvoyé après coupure, non dupliqué | ✅ | **API** : même identifiant côté application → même message, une seule ligne en base, une seule notification.<br>**Application** : le message non envoyé reste affiché et est renvoyé avec le même identifiant (`engagement_flow_test.dart` client). |
| Avis refusé hors mission clôturée | ✅ | Voir T22 (contrôle applicatif et en base). |

Également testé :
- **Messagerie** :
  - ouverture réservée au professionnel ayant accepté la demande ou à la mission (403 pour un professionnel non concerné) ;
  - non-lus et accusés de lecture ;
  - photo visible des deux seuls participants par un lien temporaire, qu'un autre ne peut pas réutiliser ;
  - avertissement à l'expéditeur quand il partage des coordonnées ;
  - lecture seule 7 jours après la fin de la mission.
- **Temps réel** : un message arrive par WebSocket ; un jeton invalide est refusé (code 4401).
- **Signalement** : enregistré une fois ; on ne peut pas signaler son propre message, ni un message qu'on n'a pas vu.
- **Push** :
  - seule l'application concernée reçoit la notification (les notifications « pro » ne vont pas à l'application client) ;
  - un tick rejoué ne renvoie rien ;
  - erreur passagère : nouvel essai à 30 s, 1 min, 2 min, 4 min, puis abandon ;
  - jeton périmé désactivé ;
  - jeton repris par un autre compte ;
  - déconnexion de l'appareil.
- **Gabarits** : modifiables, variable inconnue refusée, modification journalisée, réservés à la permission `notification.write`.

## Ce qui a été construit

### Notifications (`backend/src/notifications`, `src/worker/notifications-loop.ts`)
- **File d'envoi** : la notification est créée dans la même transaction que l'événement, donc rien n'est perdu si le serveur s'arrête. Le worker l'envoie toutes les 3 s.
- **Prise en charge** : exclusive, si bien que plusieurs workers ne font pas de double envoi. Elle est libérée si le worker s'arrête.
- **Envoi** : 5 essais au plus, avec un délai croissant. Une notification restée plus de 24 h en attente n'est plus envoyée.
- **Fournisseurs** :
  - FCM (HTTP v1, Android, et iOS via APNs) ;
  - mode développement `dev_log`, clairement identifié et refusé en production.
- **Appareils** : `PUT /v1/me/devices` et `DELETE /v1/me/devices/:token`.
- **Gabarits administrables** : `GET` et `PUT /v1/admin/notification-templates`.
- **Nouvelles notifications** : demande d'évaluation à la clôture, réclamation ouverte (professionnel), réponse du support (client ou professionnel).
- **Nouveaux messages** : une seule notification tant que les précédents ne sont pas lus.

### Messagerie (`backend/src/messaging`, `src/realtime`)
- **Conversation** : une par (demande, professionnel), ouverte dès l'acceptation ou dès la mission. Seuls le prénom du client et le nom commercial du professionnel sont montrés ; aucune coordonnée.
- **Messages** : texte, photo (fichier privé, lien de 10 minutes), dédoublonnage par identifiant, 30 messages par minute au plus, lecture seule après la mission, messages masqués par la modération.
- **Canal temps réel** `/v1/realtime` (WebSocket) :
  - authentification par le premier message (le jeton ne passe pas dans l'URL) ;
  - diffusion entre instances par Redis ;
  - battement toutes les 30 s ;
  - ce n'est qu'une accélération : tout reste disponible en REST.
- **Signalements** : `POST /v1/reports` (message, utilisateur, profil, avis, demande).

### Avis (`backend/src/reviews`) et réclamations (`backend/src/complaints`)
- **Avis** : note de 1 à 5 et commentaire, délai de 30 jours, réponse publique du professionnel, avis publiés sur le profil public.
- **Réclamations** :
  - référence `REC-AAAA-NNNNNN`, pièces jointes, litige sur une mission en cours ou terminée ;
  - gel du reversement dans les revenus du professionnel ;
  - routes du support (permission `complaint.handle`) : liste, détail avec notes internes, réponse, statut, décision liée à un remboursement.

### Applications
- **Écrans communs** (`ineed_shared`) :
  - conversations et conversation : bulles, lu, photo, appui long pour signaler, message non envoyé à renvoyer, lecture seule ;
  - réclamations : liste, formulaire, fil avec le support ;
  - canal temps réel avec reconnexion automatique.
- **Ineed (client)** :
  - messages depuis l'accueil et depuis la mission ;
  - avis après la clôture ;
  - réclamation depuis la mission ou depuis le compte ;
  - avis vérifiés sur le profil d'un professionnel ;
  - notifications qui ouvrent l'écran concerné.
- **Ineed Pro** :
  - message au client dès l'acceptation, et depuis la mission ;
  - « Mes avis » avec réponse ;
  - réclamations et assistance depuis le compte.

## Corrections faites pendant la phase
- **Contrainte en base sur l'usage des fichiers** : elle refusait les pièces jointes de réclamation (erreur 500, détectée par T23). La migration l'élargit.
- **Abonnement Redis du temps réel** : la connexion partagée refuse les commandes avant d'être ouverte, donc l'abonnement échouait silencieusement. Il utilise maintenant une connexion dédiée qui se réabonne seule après une coupure.
- **Arrêt de l'API** : les connexions WebSocket ouvertes bloquaient l'arrêt. Elles sont maintenant fermées.
- **Détection de numéros** : elle prenait les références de mission (`IN-2026-000042`) pour des numéros. Elle est restreinte aux formats ivoiriens à 10 chiffres et internationaux.
- **Formulaire de réclamation** : un bouton pleine largeur placé dans une ligne cassait la mise en page (détecté par les tests mobiles).

## Tests exécutés dans cet environnement

| Suite | Résultat |
|---|---|
| Backend — unitaires | 127 / 127 (dont FCM, filtre de coordonnées, configuration) |
| Backend — intégration (PostgreSQL/PostGIS, Redis, S3) | 547 / 547, dont 15 scénarios de la phase 8 et la matrice d'accès étendue (57 routes × 7 profils) |
| Backend — lint, typage, dérive schéma ↔ migrations | aucune erreur, aucune dérive |
| Mobile — `flutter analyze --fatal-infos` | aucune remarque |
| Mobile — `flutter test` (core 19, api 22, ui 6, shared 3, client 35, pro 30) | 115 / 115 |
| Âge des dépendances | npm : `ws` 8.22.0 et `@types/ws` 8.18.2 publiés depuis plus de 14 jours, audit sans vulnérabilité ; mobile : 163 paquets, aucun trop récent |

Non fait :
- aucun envoi réel de notification push ;
- aucun essai sur téléphone.

Les tests mobiles utilisent un faux serveur et un faux canal WebSocket.

## Limitations connues
- **Notifications push sur les téléphones** : bloquées tant que Firebase n'est pas configuré. Le code des applications prévoit l'enregistrement de l'appareil, mais la source du jeton renvoie « aucun » tant que `firebase_messaging` n'est pas ajouté, avec ses fichiers de configuration. Je ne l'ai pas ajouté : sans ces fichiers, l'application Android ne se construirait plus.
- **Modération** (signalements, avis en attente, messages masqués) et **écran du support pour les réclamations** : l'API existe, l'interface d'administration arrive en phase 9.
- **Pas de SMS de secours** ni de préférences de notification par type.
- **Canal temps réel** : il ne fonctionne que lorsque l'application est ouverte ; sinon, ce sont les notifications push qui prennent le relais (une fois Firebase configuré).
- **Message avant le choix du professionnel en mode programmé** : possible par l'API dès que le professionnel a fait une proposition, mais l'application client ne l'ouvre que depuis la mission.

## Variables et accès à configurer

| Variable | Rôle |
|---|---|
| `PUSH_PROVIDER` | `dev_log` (défaut hors production, refusé en production) ou `fcm` |
| `FCM_SERVICE_ACCOUNT_B64` | Compte de service Firebase (JSON encodé en base64), **à fournir**, jamais dans le dépôt |

| Paramètre (table `settings`) | Défaut | Rôle |
|---|---|---|
| `review.window_days` | 30 | Délai pour donner son avis |
| `messages.write_after_close_days` | 7 | Écriture possible après la fin de la mission |

**À fournir** :
- un projet Firebase où sont déclarées les applications Android et iOS ;
- les fichiers `google-services.json` et `GoogleService-Info.plist` ;
- la clé APNs (`.p8`) du compte Apple Developer ;
- le compte de service pour le serveur.

## Non-régression
- Les suites des phases 3 à 7 passent toujours.
- La vérification du jeton d'accès est factorisée (`AccessGuard.authenticate`), sans changement de comportement : les tests d'accès sont inchangés et verts.
- Migration ajoutée : `20261031000000_messaging`, sans dérive avec le schéma.
- `docs/api/openapi.json` est régénéré (125 chemins).
