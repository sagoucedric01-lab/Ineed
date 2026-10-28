# Ineed

Marketplace de services de proximité (plombiers, électriciens, mécaniciens…) — marché initial : Abidjan, Côte d'Ivoire.

**État actuel : phases 1 (architecture) et 2 (parcours, écrans, système de design) terminées.** Aucun code applicatif (backend, mobile, admin) n'est encore écrit.

## Documentation de la phase 1

1. [Analyse et ambiguïtés](docs/phase-1/01-analyse-et-ambiguites.md)
2. [Architecture technique, arborescence, modules](docs/phase-1/02-architecture.md)
3. [Base de données](docs/phase-1/03-base-de-donnees.md) — schéma exécutable : [schema-initial.sql](docs/phase-1/schema-initial.sql)
4. [Parcours utilisateur et machines à états](docs/phase-1/04-parcours-et-etats.md)
5. [Prestataires externes, coûts, points juridiques](docs/phase-1/05-prestataires-externes.md)
6. [Plan de développement et critères d'acceptation](docs/phase-1/06-plan-de-developpement.md)
7. [Décisions à valider](docs/phase-1/07-decisions-a-valider.md)

## Vérifier le schéma

Prérequis : PostgreSQL 16 avec PostGIS 3.

```bash
createdb ineed_p1
psql -v ON_ERROR_STOP=1 -d ineed_p1 -f docs/phase-1/schema-initial.sql -f docs/phase-1/schema-invariants-check.sql
```

## Phase 2 — Parcours, écrans et système de design

- [Rapport de phase 2](docs/phase-2/rapport-phase-2.md)
- [Inventaire des écrans et de leurs états](docs/phase-2/inventaire-ecrans.md)
- [Système de design](design/README.md) : tokens, logo, icônes, textes FR, maquettes (`design/maquettes/index.html`)
