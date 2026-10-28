# 7. Décisions et livrables à valider avant la phase 2

## 7.1 Décisions (ma recommandation en premier)

| # | Décision | Recommandation | Impact si différent |
|---|---|---|---|
| **D1** | Moment du paiement | Paiement avant exécution, fonds chez le prestataire agréé, reversement après clôture (ou clôture auto 48 h) | Paiement après prestation = risque d'impayés et de contournement de la plateforme |
| **D2** | Montage financier | Encaissement via compte marchand + grand livre + reversements, **sous réserve d'avis juridique** ; repli : paiement fractionné (split) chez le prestataire | Change le module `payouts` et le choix du prestataire |
| **D3** | Prestataire de paiement | CinetPay en premier adaptateur, Wave direct en second | Seul l'adaptateur change, pas le cœur métier |
| **D4** | Authentification clients/pros | Téléphone + OTP SMS, sans mot de passe | Mot de passe = flux de réinitialisation supplémentaire, plus de support |
| **D5** | Fournisseur SMS | Agrégateur local (coût) avec Twilio Verify en secours | Coût par connexion |
| **D6** | Deux applications publiées (Ineed / Ineed Pro) dans un monorepo Flutter | Oui | Une seule app = parcours et permissions mélangés |
| **D7** | Cartographie | Google Maps Platform | Mapbox/OSM : coût moindre, qualité des lieux à Abidjan à vérifier |
| **D8** | Hébergement / localisation des données | Hébergeur à choisir après avis ARTCI ; architecture portable | Peut imposer un hébergement en Côte d'Ivoire |
| **D9** | Taux de commission de départ et assiette (déplacement ? matériaux ?) | Taux unique par défaut, hors matériaux, à chiffrer avec vous | Paramétrable, sans impact technique |
| **D10** | Barème d'annulation | Gratuit avant départ ; frais de déplacement retenus après départ | Paramétrable |
| **D11** | Entreprises multi-techniciens dès la V1 ? | Non (V2) | Ajout de comptes équipe + dispatch interne : +1 phase |
| **D12** | Pièces justificatives exigées par catégorie | CNI/passeport pour tous, RCCM pour entreprises, autres selon métier (électricité ?) | Paramétrable |

## 7.2 Accès à fournir (au fur et à mesure, pas tous maintenant)

| Pour la phase | Accès |
|---|---|
| 3 | Un **dépôt Git (GitHub) sous votre contrôle** où pousser le code — actuellement le projet est dans `/home/user/ineed` (dépôt git local, non poussé) |
| 4 | Compte fournisseur SMS/OTP (identifiants de test) |
| 5 | Clés Google Maps Platform (projet de développement) |
| 7 | Compte marchand de test du prestataire de paiement + documentation de signature des notifications |
| 8 | Projet Firebase, clé APNs (compte Apple Developer) |
| 10 | Hébergeur, domaine, comptes Google Play Console et Apple Developer, DSN Sentry |

## 7.3 Livrables de la phase 1 (à valider)

| Livrable | Fichier |
|---|---|
| Analyse et ambiguïtés | `01-analyse-et-ambiguites.md` |
| Architecture, arborescence, modules backend | `02-architecture.md` |
| Schéma initial de base de données (exécutable) | `schema-initial.sql`, `03-base-de-donnees.md` |
| Vérification des invariants du schéma | `schema-invariants-check.sql` (10/10 passés) |
| Parcours, machines à états, direction visuelle | `04-parcours-et-etats.md` |
| Prestataires, accès, coûts, points juridiques | `05-prestataires-externes.md` |
| Plan de développement et critères d'acceptation | `06-plan-de-developpement.md` |

## 7.4 Ce qui n'a PAS été fait en phase 1

- Aucun code applicatif (backend, admin, mobile) : c'est volontaire, conformément au §20.
- Aucune intégration externe testée (aucun accès fourni).
- Flutter n'est pas encore installé dans l'environnement.
- Les coûts sont des ordres de grandeur, pas des devis.
