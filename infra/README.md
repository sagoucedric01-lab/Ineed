# Infrastructure

| Fichier | Rôle |
|---|---|
| `docker-compose.yml` | Environnement local complet : PostgreSQL/PostGIS, Redis, stockage S3 (SeaweedFS), migrations et référentiel (`setup`), API, worker, administration |
| `docker/backend.Dockerfile` | Image de l'API et du worker (`runtime`) et image des migrations/seeds (`tools`) |
| `docker/admin.Dockerfile` | Image de l'administration (Next.js autonome) |
| `seaweedfs/s3.json` | Identifiants S3 **de développement** du stockage local |

Les procédures de déploiement, de sauvegarde et de restauration en production seront rédigées en phase 10
(`docs/deploiement.md`, `docs/sauvegarde-restauration.md`), une fois l'hébergeur choisi (décision D8).

Voir `docs/installation-locale.md` pour l'utilisation.
