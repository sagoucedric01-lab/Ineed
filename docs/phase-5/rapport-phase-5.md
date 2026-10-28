# Rapport de fin de phase 5 — Catalogue, géolocalisation et demandes

Date : 28/10/2026. Branche : `phase-5-demandes` (construite sur `phase-4-auth`).

## Critères d'acceptation (définis en phase 1)

| Critère | Résultat | Preuve |
|---|---|---|
| T4 — recherche par catégorie et proximité | ✅ | `search.int.spec.ts` sur PostGIS réel : 11 professionnels de test (dont non validé, en pause, autre métier, sans position, position trop ancienne, refus des urgences, rayon personnel), urgence et programmé, absences, élargissement, rayon maximal ; parcours dans l'application client |
| T5 — création d'une demande | ✅ | `requests.int.spec.ts` : brouillon complet (photos, note vocale réelle de 2 s, lieu avec repère), modification, publication, annulation, droits d'accès, limite de demandes sous publications simultanées ; parcours complet dans l'application client |
| T6 — absence de professionnels disponibles | ✅ | Pistes proposées par l'API (élargir le rayon, programmer, changer de créneau) et boutons correspondants dans l'application |
| Désactiver une catégorie depuis l'API d'administration la retire de l'accueil sans redéploiement | ✅ | Test : métier désactivé, absent du catalogue immédiatement, recherche et publication refusées ; réactivé ; 2 entrées d'audit |
| Fichier non autorisé refusé | ✅ | Note vocale de 300 s refusée (durée lue dans l'en-tête), image déguisée en audio refusée, OGG et PDF refusés dès la préparation |
| Coordonnées hors ville refusées | ✅ | Adresse, recherche, demande, point de départ et position du professionnel : `OUTSIDE_SERVICE_AREA` / `LOCATION_OUTSIDE_CITY` |

## Ce qui a été construit

### API
- **Géographie**. Le serveur détermine la ville et la commune d'un point lui-même :
  - par les contours, quand ils sont saisis (secteur, puis quartier, puis commune) ;
  - sinon par la commune dont le centre est le plus proche, signalée comme approximative.

  La zone desservie est un rayon autour du centre de la ville, réglable dans les paramètres. L'administration gère les villes, les communes, les quartiers et leurs contours GeoJSON, contrôlés par PostGIS.
- **Catalogue**. Les métiers et leurs prestations (sous-catégories) sont relus en base à chaque appel. La recherche par mots du client ignore accents et apostrophes, et utilise les synonymes saisis. Les recherches récentes sont conservées (20 au plus par client). L'administration peut créer, modifier ou désactiver un métier, une prestation ou une compétence, et chaque action est inscrite au journal d'audit.
- **Adresses**. Un point sur la carte, une commune vérifiée, et un repère ou une rue obligatoire. La suppression est douce : une demande garde sa propre copie de l'adresse.
- **Recherche de professionnels**. Seuls apparaissent les professionnels réellement validés, du métier demandé et non suspendus :
  - en urgence : disponibles maintenant, sans mission en cours ;
  - en mode programmé : selon leurs horaires, absences exclues.

  Le rayon vient de la règle d'attribution, réglable depuis l'administration, et le rayon personnel du professionnel est respecté. La position prise en compte est celle du moment si elle date de moins de 30 minutes, sinon le point de départ habituel, sinon la commune desservie. Le classement est testé : distance 50 %, note vérifiée 20 % à partir de 3 avis, acceptation 15 %, annulations 15 %. Le délai d'arrivée est estimé à vitesse urbaine moyenne. Les cartes de résultats ne contiennent ni téléphone ni position.
- **Position du professionnel**. Une seule position est conservée, acceptée uniquement s'il est disponible, et effacée quand il passe hors ligne : aucun historique. Le point de départ et le rayon restent modifiables après validation, sans nouvelle vérification.
- **Demandes**. Le cycle est : brouillon, relecture, publication, annulation.
  - Photos privées. Note vocale AAC/M4A dont la durée est lue dans le fichier.
  - Toutes les règles sont revérifiées à la publication : métier actif, lieu desservi, créneau valide, fichiers prêts.
  - Au plus 3 demandes en cours par client, garanti sous verrou même avec des publications simultanées.
  - Historique des statuts. L'administration consulte les demandes sans les photos du domicile.
- **Paramètres et règles d'attribution** : modifiables depuis l'administration, la valeur garde son type, chaque modification est auditée.
- **Notifications dans l'application** : liste et marquage comme lues, séparées entre l'application client et Ineed Pro.

### Applications
- **Ineed (client)** :
  - **Accueil** : adresse, recherche, « Intervention immédiate », « Programmer une intervention », métiers, recherches récentes, demandes en cours, notifications avec pastille.
  - **Adresses** : carte avec repère fixe, position du téléphone (autorisation demandée au moment du clic), commune, repère et indications.
  - **Résultats** : choix de la prestation et de son prix, urgence ou créneau, pistes quand rien n'est trouvé.
  - **Profil public** d'un professionnel.
  - **Création de demande** : jusqu'à 5 photos, note vocale de 2 min au plus, budget, relecture, publication, annulation.
  - **Mes demandes** et **notifications**.
- **Ineed Pro** :
  - position du moment envoyée quand le professionnel se déclare disponible, puis toutes les 5 minutes tant que l'écran est ouvert ;
  - point de départ défini depuis la position actuelle ;
  - distance maximale réglable.
- **Relance automatique** des chargements (Riverpod) limitée aux coupures réseau, 3 fois au plus. Les erreurs du serveur ne sont jamais relancées.

### Corrections de défauts des phases précédentes, trouvés pendant cette phase
- **Android** : la permission `INTERNET` manquait dans le manifeste principal. Une version de production n'aurait pas pu joindre l'API. Elle est ajoutée.
- **Android, variante dev** : l'API locale en HTTP était bloquée par Android 9 et plus. HTTP est maintenant autorisé, mais uniquement dans la variante `dev`.
- **iOS** : il manquait les textes d'autorisation de l'appareil photo et de la galerie, ce qui fait planter le choix de photo. Ils sont ajoutés, avec ceux de la localisation et du micro.
- **Politique de versions** : seules les dépendances directes étaient contrôlées. Le verrou npm contenait une quarantaine de dépendances indirectes de moins de 14 jours, et le verrou Dart 18. Corrigé :
  - `minimumReleaseAge` est activé dans pnpm et le verrou entièrement re-résolu ;
  - pour Dart, les paquets concernés sont épinglés dans `dependency_overrides` ;
  - deux scripts vérifient désormais chaque paquet en CI.

  La re-résolution a fait réapparaître 3 vulnérabilités connues, dont une haute dans body-parser. Elles sont corrigées par des exceptions de sécurité déclarées : body-parser 2.4.0, fast-uri 3.1.9, qs 6.16.1. `pnpm audit` ne signale aucune vulnérabilité.

## Tests exécutés dans cet environnement

| Suite | Résultat |
|---|---|
| Backend — unitaires | 87 / 87 |
| Backend — intégration (PostgreSQL/PostGIS, Redis, S3 réels) | 295 / 295, dont matrice d'accès étendue à 27 routes × 7 profils (189 cas) |
| Administration (tests, lint, build) | 5 / 5, OK |
| Design (contrastes, textes, fichiers générés) | OK |
| Mobile — `flutter analyze --fatal-infos` | aucune remarque |
| Mobile — `flutter test` (core 19, api 17, ui 6, shared 3, client 18, pro 11 + 2) | 76 / 76 |
| `pnpm audit` / âge des paquets npm (870) et Dart (155) | 0 vulnérabilité / conformes |
| Dérive schéma Prisma ↔ migrations | aucune |

Les tests mobiles utilisent un faux serveur, ainsi que des fausses position, photo et note vocale. La carte, le GPS, le micro et l'appareil photo **n'ont été essayés sur aucun téléphone ni émulateur**.

## Limitations connues
- **Aucune transmission aux professionnels** : une demande publiée reste « Publiée ». La mise en relation (vagues d'alertes, acceptation, réservation) est l'objet de la phase 6, et l'application l'indique au client.
- **Aucun géocodage d'adresse textuelle**, faute de clé Google Maps. Le client place un repère sur la carte, utilise sa position ou choisit sa commune.
- **Fond de carte** : en développement, ce sont les tuiles publiques OpenStreetMap. Elles sont interdites en production par l'application elle-même : un fournisseur sous contrat sera à configurer.
- **Communes** : centres approximatifs et aucun contour saisi, donc la commune déduite d'un point peut être fausse près d'une limite. Le client peut la corriger.
- **Délai d'arrivée** : estimation à 18 km/h plus 10 min de préparation (réglable), pas un calcul d'itinéraire.
- **Note vocale** : elle ne peut pas être réécoutée avant envoi. La durée maximale est contrôlée par le serveur.
- **Écrans d'administration** (catalogue, zones, règles) : phase 9 ; l'API existe.
- **Position du professionnel** : envoyée seulement quand l'application est ouverte. L'envoi en arrière-plan sera traité avec le suivi de trajet (phase 6).

## Variables et accès à configurer

| Variable / accès | Où | Commentaire |
|---|---|---|
| `INEED_MAP_TILE_URL` | Applications (config/*.json) | Modèle d'URL HTTPS `{z}/{x}/{y}` d'un fournisseur de cartes ; vide en production tant qu'aucun contrat n'est signé |
| Clé Google Maps Platform (ou autre géocodeur) | À fournir | Pour la saisie d'adresse textuelle et les itinéraires (non utilisée à ce stade) |
| Paramètres `geo.service_area_radius_m`, `pro.location_fresh_minutes`, `search.eta_*`, `request.*`, `address.max_per_user` | Administration (`PUT /v1/admin/settings/:key`) | Valeurs par défaut chargées par le référentiel |
| Contours officiels des communes | Administration (`PATCH /v1/admin/geo/zones/:id`) | GeoJSON Polygon/MultiPolygon |
| Tarifs de référence des prestations | Administration (`PATCH /v1/admin/catalog/services/:id`) | Aucun tarif saisi à ce jour |

## Non-régression
- Toutes les suites des phases 3 et 4 passent toujours, après la re-résolution complète des dépendances.
- `docs/api/openapi.json` est régénéré (63 routes).
- Le schéma de base n'a pas changé : aucune migration.
