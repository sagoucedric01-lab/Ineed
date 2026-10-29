# Rapport de fin de phase 6 — Mise en relation, attribution et missions

Date : 29/10/2026. Branche : `phase-6-missions` (construite sur `phase-5-demandes`).

## Critères d'acceptation (définis en phase 1)

Tous les tests ci-dessous s'exécutent sur PostgreSQL/PostGIS, Redis et le stockage réels (`backend/test/integration/dispatch.int.spec.ts`), sauf mention contraire.

| Test | Résultat | Ce qui est vérifié |
|---|---|---|
| T7 — envoi des alertes | ✅ | Une vague vers les 5 professionnels les mieux classés et disponibles, avec une notification chacun. Avant confirmation, le professionnel ne voit que le quartier et une distance arrondie : ni adresse ni coordonnées. Il ne voit pas l'offre d'un autre. |
| T8 — acceptation simultanée | ✅ | 5 acceptations envoyées en même temps donnent exactement 1 réservation et 4 refus « Un autre professionnel a été plus rapide », par une mise à jour conditionnelle en base. L'acceptation renvoyée par le gagnant est sans effet. |
| T9 — attribution à un seul professionnel | ✅ | La confirmation du client crée la mission dans la même transaction. La confirmation renvoyée renvoie la même mission. Les autres offres sont retirées. L'index unique en base refuse une seconde mission active. Le professionnel retenu voit alors l'adresse précise et le prénom du client, les autres n'y ont pas accès. |
| T10 — expiration d'une proposition | ✅ | Les offres expirent à l'échéance et une acceptation tardive est refusée. Le rayon s'élargit jusqu'au maximum, puis la demande passe en « Aucun professionnel » avec notification. Le client peut relancer en demande programmée. |
| T11 — refus d'une mission | ✅ | Le refus est enregistré avec son motif. Quand tous les sollicités ont répondu, la vague suivante part sans attendre. |
| T18 — annulation avant intervention | ✅ | Sans frais. La demande est annulée et le professionnel prévenu. Annuler pendant une réservation libère le professionnel. |
| T19 — annulation après confirmation | ✅ | Professionnel en route : les conditions enregistrent « frais de déplacement dus ». Une fois les travaux commencés, l'annulation est refusée et le litige reste possible. |
| T20 — suivi du professionnel | ✅ | Positions envoyées par lots, une position à vitesse impossible marquée suspecte, distance et délai calculés pour le client, plus aucune position acceptée après l'arrivée. |
| T21 — fin de prestation | ✅ | Fin déclarée avec compte rendu, clôture par le client, compteur de missions du professionnel incrémenté, chronologie complète demande + mission. La clôture automatique a lieu 48 h après la fin, sans réponse du client. |
| T26 — perte de connexion | ✅ | Étape renvoyée deux fois : une seule entrée d'historique. Lot de positions renvoyé : doublons ignorés. Côté application, les positions sont gardées pendant la coupure puis renvoyées ensemble (test `TripTracker`). |
| T27 — reprise après interruption du serveur | ✅ | Après un redémarrage complet de l'API, sans rien en mémoire, le tick suivant fait expirer l'offre et la réservation et poursuit la recherche. Rejouer le même tick ne change rien. |
| Test exhaustif des paires de transitions | ✅ | `state-machine.spec.ts` énumère les 12 × 12 statuts × 5 acteurs : seules les transitions déclarées passent, aucune ne sort d'un état terminal, aucun saut d'étape, le mauvais acteur est refusé. |

## Ce qui a été construit

### Moteur d'attribution (`backend/src/dispatch`)
- **Piloté par la base**. Les statuts, échéances et la prochaine vague (nouvelle colonne `next_wave_at`) sont en base. Un tick toutes les 5 s, dans le worker et protégé par un verrou Redis, plus un traitement immédiat à la publication, fait avancer toutes les demandes. Chaque demande est traitée sous verrou (`FOR UPDATE SKIP LOCKED`), ce qui permet plusieurs workers en parallèle.
- **Vagues**. Chaque vague sollicite les meilleurs professionnels pas encore sollicités. Les règles de sélection sont les mêmes que pour la recherche du client (phase 5). Le rayon s'élargit d'une vague à l'autre jusqu'au rayon maximal de la règle d'attribution, puis la demande passe en « Aucun professionnel ». La recherche urgente dure au plus 30 minutes (paramètre).
- **Urgence**. Le premier qui accepte est réservé. Le client confirme dans le délai de la règle (2 minutes par défaut) ; il peut aussi refuser, ou laisser expirer, ce qui libère le professionnel et relance la recherche.
- **Programmé**. Les professionnels proposent une heure dans le créneau, et un prix s'ils le souhaitent. Le client compare, choisit et confirme. Au-delà du nombre maximal de propositions, les autres sollicitations sont retirées.
- **Désistement du professionnel après attribution**. Il compte dans son taux de fiabilité. La demande repart en recherche sans lui, et les professionnels dont l'offre avait été retirée peuvent être sollicités de nouveau.

### Missions (`backend/src/missions`)
- **Machine à états déclarative** (`state-machine.ts`). C'est le tableau du document de phase 1, avec ses gardes : diagnostic sur place, devis en attente, échéance de clôture.
- **Référence lisible** : `IN-AAAA-NNNNNN`.
- **Étapes du professionnel** : départ, arrivée, début, fin avec compte rendu. Désistement possible avec motif.
- **Côté client** : suivi en direct avec position, distance, délai et alerte si la position est ancienne ; confirmation de fin ; signalement d'un problème ; annulation avec ses conditions affichées.
- **Positions du trajet** : acceptées seulement pendant le trajet, dédoublonnées par horodatage, celles imprécises ou à vitesse impossible marquées suspectes. Elles sont purgées 30 jours après la fin de la mission (paramètre `location.ping_retention_days`).
- **Administration (API)** : liste, détail, annulation, clôture d'un litige.
- **Actions idempotentes** : renvoyer une action déjà faite ne crée aucun doublon.

### Applications
- **Ineed (client)** :
  - suivi de la demande selon son état : recherche en cours, professionnel réservé avec confirmation, propositions reçues, aucun professionnel avec relance ou passage en programmé ;
  - écran de mission : étapes, trajet du professionnel, fin d'intervention, problème, annulation ;
  - missions en cours sur l'accueil.

  L'écran se rafraîchit toutes les 5 s, en attendant les notifications push.
- **Ineed Pro** :
  - demandes reçues sur le tableau de bord, rafraîchies toutes les 10 s quand le professionnel est disponible ;
  - écran de demande avec compte à rebours : accepter, refuser avec motif, ou proposer en mode programmé ;
  - écran de mission avec adresse précise, prénom du client et étapes ;
  - partage de position pendant le trajet, positions gardées en cas de coupure.

## Corrections faites pendant la phase
- **Annulation d'une mission attribuée** : la demande gardait le professionnel réservé, ce que la base refuse, et l'opération échouait. Corrigé.
- **Professionnel désisté** : son offre restait « retenue », ce qui bloquait la sélection du professionnel suivant. Elle est maintenant marquée refusée.
- **Ordre de la chronologie** : des horodatages de sources différentes dans une même transaction pouvaient l'inverser. Ils sont maintenant uniformes et départagés par l'ordre d'enregistrement.
- **Upsert Prisma** : l'`ON CONFLICT` généré était incompatible avec l'index partiel des offres. Il est remplacé par une lecture suivie d'une écriture, sous le verrou de la demande.
- **Écran de mission Pro** : il se reconstruisait en boucle. Détecté par les tests et corrigé.

## Tests exécutés dans cet environnement

| Suite | Résultat |
|---|---|
| Backend — unitaires (dont machine à états exhaustive) | 94 / 94 |
| Backend — intégration (PostgreSQL/PostGIS, Redis, S3) | 362 / 362, dont 18 scénarios de la phase 6 et la matrice d'accès étendue (34 routes × 7 profils) |
| Mobile — `flutter analyze --fatal-infos` | aucune remarque |
| Mobile — `flutter test` (core 19, api 17, ui 6, shared 3, client 25, pro 20) | 90 / 90 |
| Dérive schéma Prisma ↔ migrations | aucune |

Les tests mobiles utilisent un faux serveur et une fausse position. Rien n'a été essayé sur un téléphone.

## Limitations connues
- **Devis et paiement (phase 7)**. Une mission créée s'arrête à « En attente de devis » (prestations sur devis : tout le catalogue actuel) ou à « Paiement en attente ». Les applications l'indiquent. Le trajet, la fin et la clôture sont testés en simulant un paiement confirmé (`simulateConfirmedPayment`, réservé aux tests et clairement nommé).
- **Pas de notification push (phase 8)**. Un professionnel ne voit une demande que lorsque Ineed Pro est ouverte ; les notifications sont enregistrées en base et listées dans l'application. La pertinence des délais (60 s pour répondre à une urgence) dépend de cette livraison.
- **Position du professionnel** : envoyée seulement quand l'application est au premier plan. Le partage en arrière-plan demande une configuration native (Android : service au premier plan ; iOS : mode arrière-plan) et des essais sur appareil.
- **Délai d'arrivée** : estimation à vol d'oiseau et vitesse moyenne, pas un itinéraire.
- **Barème d'annulation** : les conditions (gratuite ou frais de déplacement dus) sont enregistrées ; le montant et le remboursement sont calculés en phase 7.
- **Écrans d'administration des missions** : phase 9 ; l'API existe.

## Variables et paramètres

| Paramètre | Défaut | Rôle |
|---|---|---|
| Règles d'attribution (`/v1/admin/dispatch-rules`) | Urgence : 3 km → 15 km par pas de 3 km, 5 professionnels par vague, 60 s pour répondre, 2 min pour confirmer. Programmé : 5 km → 20 km, 10 par vague, 2 h, 1 h | Ajustables sans redéploiement |
| `dispatch.urgent_max_minutes` | 30 | Durée maximale de recherche d'une urgence |
| `mission.auto_close_hours` | 48 | Clôture automatique après la fin déclarée |
| `mission.reassign_on_pro_cancel` | `true` | Relance de la recherche après le désistement d'un professionnel |
| `location.ping_retention_days` | 30 | Conservation des positions de trajet |

Aucune nouvelle variable d'environnement ni aucun nouvel accès externe n'est nécessaire pour cette phase.

## Non-régression
- Les suites des phases 3 à 5 passent toujours. Les tests de la phase 5 sont mis à jour pour l'effet voulu : une demande publiée passe aussitôt par la recherche.
- `docs/api/openapi.json` est régénéré (90 routes).
- Migration ajoutée : `20261029000000_dispatch`, sans dérive avec le schéma.
