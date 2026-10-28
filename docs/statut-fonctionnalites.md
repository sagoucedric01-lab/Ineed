# Statut des fonctionnalités

Mis à jour à la fin de chaque phase. Légende : ✅ terminé et testé · 🟡 partiel · 🧪 simulé (développement uniquement) · ⏳ pas commencé.

Dernière mise à jour : fin de la phase 5 (28/10/2026).

## Socle technique

| Élément | Statut | Détail |
|---|---|---|
| Monorepo (pnpm, Node 22, TypeScript 6.0) | ✅ | `backend`, `admin`, `design`, `mobile` |
| Base PostgreSQL 16 + PostGIS, migrations versionnées | ✅ | 2 migrations Prisma ; zéro dérive avec `schema.prisma` (vérifié en CI) |
| Invariants critiques en base (attribution unique, devis, paiements, grand livre, avis, audit) | ✅ | 10 vérifications exécutées en test d'intégration |
| Référentiel (communes d'Abidjan, rôles et permissions, catégories, prestations, règles d'attribution, paramètres, gabarits de notification) | 🟡 | Chargé et idempotent. Centres des communes **approximatifs** et **aucun contour** saisi (la commune d'un point est déduite du centre le plus proche) ; **aucun tarif** saisi |
| Données de démonstration | ✅ | Fictives, marquées « démo », refusées hors local/test |
| API : configuration validée, garde-fous de production | ✅ | Simulateurs OTP et paiement refusés quand `APP_ENV=production` |
| API : santé (`/health/live`, `/health/ready`) | ✅ | Base + PostGIS, Redis, stockage S3, présence du worker |
| API : format d'erreur français, identifiant de requête, journaux structurés masqués | ✅ | |
| Documentation OpenAPI (`/docs`, `docs/api/openapi.json`) | ✅ | 63 routes |
| Worker (tâches de fond) | 🟡 | Démarre et signale sa présence ; aucune file de tâches métier avant la phase 6 |
| Stockage S3 | ✅ | Dépôt direct par URL présignée, contrôle du contenu réel, photos ré-encodées sans métadonnées (GPS compris), justificatifs dans un bucket privé |
| Administration web | 🟡 | Page « État de la plateforme » uniquement. L'API d'administration (connexion avec TOTP, file de validation des pros) existe ; l'interface arrive en phase 9 |
| Applications mobiles Ineed et Ineed Pro | 🟡 | Connexion, compte et inscription pro (voir ci-dessous). Testées sur faux serveur uniquement : **aucun essai sur téléphone ou émulateur** dans cet environnement |
| Variantes Android dev / staging / prod | ✅ | Construction APK vérifiée en CI |
| Variantes iOS | ⏳ | Schémas Xcode à créer sur un Mac (phase 10) |
| Images Docker et `docker compose` | ✅ | Voir le rapport de phase 3 |
| CI GitHub Actions | ✅ | Design, audit, backend, admin, mobile, Docker |

## Fonctionnalités métier

| Fonctionnalité | Statut | Détail |
|---|---|---|
| Connexion par code SMS (clients et pros) | 🧪 | Complète côté API et applications, mais **en mode développement** : aucun SMS n'est envoyé, le code est écrit dans les journaux de l'API. Adaptateur Twilio Verify écrit et testé sur réponses documentées, **jamais essayé avec un vrai compte** |
| Sessions : rotation, détection de réutilisation, liste et déconnexion des appareils | ✅ | Jetons d'accès de 15 min (ES256), jetons de rafraîchissement stockés hachés |
| Limitation des abus (codes SMS, vérifications, connexions admin) | ✅ | Délai de 60 s, 3 codes par numéro / 10 min, 10 par adresse IP / heure, 5 essais par code |
| Contrôle d'accès par application, rôle et permission | ✅ | Matrice de 91 cas testée (T24) ; un test vérifie la liste exacte des routes publiques et la règle de chaque route admin et pro |
| Profil (prénom, nom, photo) | ✅ | |
| Suppression de compte avec code SMS dédié, anonymisation | ✅ | Refusée tant qu'une demande est en cours (T25) |
| Inscription professionnelle : dossier, métiers, communes, horaires, photo, justificatifs, envoi | ✅ | API (T2) et application Ineed Pro |
| Validation des professionnels (approuver, refuser, demander des compléments, suspendre, réactiver) | 🟡 | API terminée et testée (T3), avec journal d'audit ; **pas encore d'écran d'administration** (phase 9) |
| Statut « vérifié » d'un professionnel | ✅ | Posé uniquement par la validation d'un administrateur (date et auteur enregistrés) ; affichage côté client à partir de la phase 5 |
| Disponibilité du professionnel | 🟡 | Enregistrée sur le serveur ; les demandes reçues arrivent en phase 6 |
| Connexion administrateur (mot de passe argon2id + TOTP obligatoire) | ✅ | API uniquement ; premier compte créé en ligne de commande |
| Création des autres comptes administrateurs | ⏳ | Phase 9 (interface d'administration) |
| Catalogue administrable (métiers, prestations, compétences, désactivation immédiate) | 🟡 | API terminée et testée ; écrans d'administration en phase 9 |
| Villes, communes, quartiers, contours GeoJSON | 🟡 | API d'administration terminée ; contours officiels à saisir |
| Recherche par mots du client (synonymes, sans accents), recherches récentes | ✅ | |
| Adresses avec repère, commune vérifiée, point sur la carte | ✅ | Carte affichée seulement si un fond de carte est configuré (`INEED_MAP_TILE_URL`) ; **aucun géocodage d'adresse textuelle** (pas de clé Google Maps) |
| Recherche de professionnels proches (urgence et programmé), classement, délai estimé, pistes sans résultat | ✅ | T4, T6. Délai = estimation à vitesse urbaine moyenne, pas un calcul d'itinéraire |
| Profil public d'un professionnel | 🟡 | Sans avis (phase 8) |
| Création de demande (photos, note vocale, budget, relecture, publication, annulation) | ✅ | T5. **Une demande publiée n'est encore transmise à aucun professionnel** : la mise en relation arrive en phase 6, et l'application le dit |
| Position du professionnel disponible, point de départ, rayon | ✅ | Une seule position conservée, effacée au passage hors ligne |
| Notifications dans l'application (liste, lecture) | 🟡 | Sans push (phase 8) |
| Propositions, attribution, suivi de mission | ⏳ | Phase 6 |
| Devis, paiements, remboursements, reversements | ⏳ | Phase 7 |
| Notifications push, messagerie, avis, réclamations | ⏳ | Phase 8 |
| Administration (23 modules) | ⏳ | Phase 9 |

## Simulations en place

| Simulation | Où | Garde-fou |
|---|---|---|
| Codes SMS affichés dans les journaux (`OTP_PROVIDER=dev_console`) | **Actif** : valeur par défaut hors production ; les applications affichent « Mode développement » | Démarrage refusé en production |
| Paiements simulés (`PAYMENT_PROVIDER=sandbox`) | Valeur par défaut hors production (utilisée à partir de la phase 7) | Démarrage refusé en production ; transactions marquées `is_sandbox` |
