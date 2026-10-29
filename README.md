# Ineed

Marketplace de services de proximité (plombiers, électriciens, mécaniciens…) — marché initial : Abidjan, Côte d'Ivoire.

**État actuel : phase 7 (devis, paiements, remboursements) terminée, en mode développement pour les SMS et les paiements.**
Connexion, inscription et validation des professionnels, recherche, demandes, mise en relation, devis, paiement, suivi des
missions et remboursements fonctionnent et sont testés. **Les paiements passent par un simulateur** (aucun argent réel) tant
que le compte marchand CinetPay n'est pas configuré ; l'adaptateur CinetPay est écrit mais pas encore essayé sur un compte réel.
Détail : [statut des fonctionnalités](docs/statut-fonctionnalites.md).

## Organisation du dépôt

| Dossier | Contenu |
|---|---|
| `backend/` | API et worker NestJS, schéma Prisma, migrations SQL, seeds, tests |
| `admin/` | Administration web Next.js |
| `mobile/` | Applications Flutter Ineed (`apps/client`) et Ineed Pro (`apps/pro`), paquets partagés |
| `design/` | Système de design : tokens, marque, icônes, textes français, maquettes |
| `infra/` | Docker, docker compose, configuration du stockage local |
| `docs/` | Analyse, architecture, rapports de phase, documentation de l'API |

## Démarrer

Voir [docs/installation-locale.md](docs/installation-locale.md). En bref, avec Docker :

```bash
node tools/generate-dev-secrets.mjs --write infra/.env.secrets
```

```bash
docker compose -f infra/docker-compose.yml up --build
```

Puis http://localhost:3000/health/ready (API), http://localhost:3000/docs (documentation de l'API) et http://localhost:3001 (administration).

## Documentation

- Phase 1 : [analyse](docs/phase-1/01-analyse-et-ambiguites.md), [architecture](docs/phase-1/02-architecture.md), [base de données](docs/phase-1/03-base-de-donnees.md), [parcours et états](docs/phase-1/04-parcours-et-etats.md), [prestataires et coûts](docs/phase-1/05-prestataires-externes.md), [plan](docs/phase-1/06-plan-de-developpement.md), [décisions](docs/phase-1/07-decisions-a-valider.md)
- Phase 2 : [rapport](docs/phase-2/rapport-phase-2.md), [inventaire des écrans](docs/phase-2/inventaire-ecrans.md), [système de design](design/README.md)
- Phase 3 : [rapport](docs/phase-3/rapport-phase-3.md), [installation locale](docs/installation-locale.md), [API (OpenAPI)](docs/api/openapi.json)
- Phase 4 : [rapport](docs/phase-4/rapport-phase-4.md)
- Phase 5 : [rapport](docs/phase-5/rapport-phase-5.md)
- Phase 6 : [rapport](docs/phase-6/rapport-phase-6.md)
