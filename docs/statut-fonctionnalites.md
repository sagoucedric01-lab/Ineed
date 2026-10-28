# Statut des fonctionnalités

Mis à jour à la fin de chaque phase. Légende : ✅ terminé et testé · 🟡 partiel · 🧪 simulé (développement uniquement) · ⏳ pas commencé.

Dernière mise à jour : fin de la phase 3 (28/10/2026).

## Socle technique

| Élément | Statut | Détail |
|---|---|---|
| Monorepo (pnpm, Node 22, TypeScript 6.0) | ✅ | `backend`, `admin`, `design`, `mobile` |
| Base PostgreSQL 16 + PostGIS, migrations versionnées | ✅ | 2 migrations Prisma ; zéro dérive avec `schema.prisma` (vérifié en CI) |
| Invariants critiques en base (attribution unique, devis, paiements, grand livre, avis, audit) | ✅ | 10 vérifications exécutées en test d'intégration |
| Référentiel (communes d'Abidjan, rôles et permissions, catégories, prestations, règles d'attribution, paramètres, gabarits de notification) | 🟡 | Chargé et idempotent. Centroïdes des communes **approximatifs** ; **aucun tarif** saisi (à fixer par l'équipe commerciale) |
| Données de démonstration | ✅ | Fictives, marquées « démo », refusées hors local/test |
| API : configuration validée, garde-fous de production | ✅ | Simulateurs OTP et paiement refusés quand `APP_ENV=production` |
| API : santé (`/health/live`, `/health/ready`) | ✅ | Base + PostGIS, Redis, stockage S3, présence du worker |
| API : format d'erreur français, identifiant de requête, journaux structurés masqués | ✅ | |
| Documentation OpenAPI (`/docs`, `docs/api/openapi.json`) | ✅ | 2 routes pour l'instant (santé) |
| Worker (tâches de fond) | 🟡 | Démarre et signale sa présence ; aucune file de tâches métier avant la phase 6 |
| Stockage S3 | 🟡 | Connexion et buckets vérifiés ; téléversement de fichiers en phase 4–5 |
| Administration web | 🟡 | Page « État de la plateforme » uniquement ; connexion et modules en phase 9 |
| Applications mobiles Ineed et Ineed Pro | 🟡 | Thème, polices, textes, icônes, environnements, client API ; un seul écran technique (vérification de l'API) |
| Variantes Android dev / staging / prod | ✅ | Construction APK vérifiée en CI |
| Variantes iOS | ⏳ | Schémas Xcode à créer sur un Mac (phase 10) |
| Images Docker et `docker compose` | ✅ | Voir le rapport de phase 3 |
| CI GitHub Actions | ✅ | Design, audit, backend, admin, mobile, Docker |

## Fonctionnalités métier

| Fonctionnalité | Statut | Phase prévue |
|---|---|---|
| Inscription / connexion par SMS, profils, suppression de compte | ⏳ | 4 |
| Inscription et vérification des professionnels | ⏳ | 4 |
| Catalogue, recherche, géolocalisation, création de demande | ⏳ | 5 |
| Propositions, attribution, suivi de mission | ⏳ | 6 |
| Devis, paiements, remboursements, reversements | ⏳ | 7 |
| Notifications, messagerie, avis, réclamations | ⏳ | 8 |
| Administration (23 modules) | ⏳ | 9 |

## Simulations en place

| Simulation | Où | Garde-fou |
|---|---|---|
| Codes SMS affichés dans les journaux (`OTP_PROVIDER=dev_console`) | Valeur par défaut hors production (utilisée à partir de la phase 4) | Démarrage refusé en production |
| Paiements simulés (`PAYMENT_PROVIDER=sandbox`) | Valeur par défaut hors production (utilisée à partir de la phase 7) | Démarrage refusé en production ; transactions marquées `is_sandbox` |
