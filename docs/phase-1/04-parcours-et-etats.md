# 4. Parcours utilisateur et machines à états

## 4.1 Parcours client (application « Ineed »)

1. **Premier lancement** : présentation (3 écrans max) → saisie du numéro (+225 prérempli) → code SMS → prénom/nom → accueil. La localisation n'est **pas** demandée à ce stade.
2. **Accueil** : logo, « Bonjour Awa », adresse courante (tap = changer), barre « Décrivez votre problème ou cherchez un métier », boutons **Intervention immédiate** / **Programmer une intervention**, grille des catégories (backend), recherches récentes, missions en cours, cloche de notifications, avatar → profil.
3. **Choix du besoin** : catégorie → sous-catégorie / prestation (affiche le modèle de prix : « Prix fixe 15 000 F CFA », « Sur devis », « Déplacement 3 000 F CFA + devis sur place »).
4. **Localisation** : demande d'autorisation *à ce moment* ; si refus → saisie manuelle (commune, quartier, repère) + marqueur déplaçable sur la carte ; adresses enregistrées.
5. **Description** : texte, jusqu'à 5 photos, 1 note vocale (2 min), budget indicatif facultatif ; créneau (programmé).
6. **Récapitulatif** → **Publier**.
7. **Urgence** : écran de recherche animé avec progression réelle (vagues, rayon) → « Koffi (Plomberie) a accepté — arrivée estimée 18 min » → client confirme dans le délai → mission.
   **Programmé** : réception de propositions (profil, note, prix proposé, créneau) → comparaison → choix.
   **Aucun pro** : écran avec 3 actions : *Élargir la zone*, *Changer d'horaire*, *Passer en demande programmée*.
8. **Devis** (selon modèle) : détail des lignes, validité, conditions → *Accepter* / *Refuser (motif)*.
9. **Paiement** : choix du moyen (Orange Money, MTN MoMo, Moov Money, Wave, carte selon prestataire) → instructions → écran « Paiement en cours de vérification » → confirmation **après validation serveur**.
10. **Suivi** : chronologie de la mission, carte du trajet (EN_ROUTE), messagerie, appel masqué (V2), bouton d'aide.
11. **Fin** : « Le professionnel a déclaré l'intervention terminée » → *Confirmer* / *Signaler un problème* (→ litige).
12. **Reçu** (PDF + écran) et **évaluation** (1–5 étoiles + commentaire).

## 4.2 Parcours professionnel (application « Ineed Pro »)

1. Numéro + code → type de compte (indépendant / entreprise) → identité, photo → métiers, spécialités, expérience → zones (communes) + rayon → horaires → documents (CNI/passeport, RCCM si entreprise, autres selon catégorie) → compte de reversement (Mobile Money) → **Soumettre**. Statut affiché : *En cours de vérification* / *Informations complémentaires demandées (message de l'admin)* / *Refusé (motif)* / *Validé*.
2. **Tableau de bord** : interrupteur *Disponible maintenant*, pause temporaire, demandes reçues, missions du jour, revenus de la semaine.
3. **Alerte** (push haute priorité + écran plein) : catégorie, résumé, photos, distance approximative (« environ 2,4 km — Cocody, Riviera 2 »), modèle de prix, créneau, compte à rebours → *Accepter* / *Refuser (motif rapide)*. L'adresse exacte, le repère et le téléphone ne sont révélés qu'après confirmation du client.
4. **Mission** : *Je pars* (partage de position activé, premier plan) → *Je suis arrivé* → *Soumettre un devis* (lignes, validité, conditions) → attente d'acceptation/paiement → *Commencer les travaux* → *Ajouter des frais* (supplément soumis au client) → *Terminer* (+ compte rendu, photos).
5. **Revenus** : prestations, commissions, remboursements, montant dû, reversements effectués/en attente, historique.

## 4.3 Parcours administrateur

Connexion e-mail + mot de passe + TOTP → tableau de bord (demandes ouvertes, missions en cours, paiements en attente, pros à valider, litiges) → modules (cf. cahier des charges §8). Toute action sensible demande un motif et est journalisée.

## 4.4 Machine à états — Demande (`service_requests.status`)

| De | Vers | Déclencheur | Garde |
|---|---|---|---|
| DRAFT | PUBLISHED | Client publie | Catégorie active, position dans une ville active, créneau si programmé |
| PUBLISHED | MATCHING | Système (immédiat) | — |
| MATCHING | PROVISIONALLY_RESERVED | Pro accepte (urgence) | Offre valide non expirée ; mise à jour conditionnelle atomique |
| MATCHING | OFFERS_RECEIVED | 1ʳᵉ proposition (programmé) | — |
| MATCHING | NO_PROVIDER_FOUND | Rayon max atteint sans acceptation | — |
| NO_PROVIDER_FOUND | MATCHING | Client élargit / change d'horaire / passe en programmé | — |
| OFFERS_RECEIVED | AWAITING_CLIENT_CONFIRMATION | Client choisit une proposition | Proposition encore valide |
| PROVISIONALLY_RESERVED | AWAITING_CLIENT_CONFIRMATION | Système (notification client envoyée) | — |
| PROVISIONALLY_RESERVED / AWAITING_CLIENT_CONFIRMATION | MATCHING | Expiration, refus du client, désistement du pro | Libère `reserved_pro_id` ; pro suivant ou nouvelle vague |
| AWAITING_CLIENT_CONFIRMATION | ASSIGNED | Client confirme les conditions | Crée la mission dans la même transaction ; autres offres → NOT_SELECTED + notification |
| ASSIGNED | MATCHING | Mission annulée par le pro avant départ | Réattribution autorisée par paramètre |
| tout état non terminal | CANCELLED | Client annule | Barème d'annulation |
| MATCHING / OFFERS_RECEIVED / NO_PROVIDER_FOUND | EXPIRED | Échéance | — |

États terminaux : ASSIGNED (la suite vit dans la mission), EXPIRED, CANCELLED.

## 4.5 Machine à états — Mission (`missions.status`)

État initial selon le modèle de prix :
- `FIXED` → **CONFIRMED** (le prix est déjà accepté) ;
- `QUOTE` → **AWAITING_QUOTE** (devis à distance avant déplacement) ;
- `TRAVEL_PLUS_DIAGNOSIS` → **CONFIRMED** (frais de déplacement acceptés ; devis travaux sur place).

| De | Vers | Acteur | Garde |
|---|---|---|---|
| AWAITING_QUOTE | QUOTE_PENDING_APPROVAL | Pro soumet devis | Total = somme des lignes, validité future |
| QUOTE_PENDING_APPROVAL | CONFIRMED | Client accepte (devis initial) | Devis non expiré, version courante |
| QUOTE_PENDING_APPROVAL | AWAITING_QUOTE | Client refuse / devis expire | Si le client veut une nouvelle version |
| QUOTE_PENDING_APPROVAL | PAYMENT_PENDING | Client accepte (devis travaux sur place) | Pro arrivé |
| CONFIRMED | PAYMENT_PENDING | Système | Montant à payer > 0 |
| PAYMENT_PENDING | PAYMENT_CONFIRMED | **Webhook + vérification serveur** | Jamais sur déclaration de l'application |
| PAYMENT_PENDING | PAYMENT_PENDING | Échec de paiement | Nouvelle tentative possible ; après N échecs ou délai → CANCELLED |
| PAYMENT_CONFIRMED | EN_ROUTE | Pro « Je pars » | Pas encore arrivé |
| PAYMENT_CONFIRMED | IN_PROGRESS | Pro « Commencer » | Pro déjà arrivé (paiement des travaux sur place) |
| EN_ROUTE | ARRIVED | Pro « Je suis arrivé » | Position contrôlée (indice, pas preuve) |
| ARRIVED | AWAITING_QUOTE | Système | Modèle TRAVEL_PLUS_DIAGNOSIS sans devis travaux accepté |
| ARRIVED | IN_PROGRESS | Pro « Commencer » | Devis accepté **et** payé (ou FIXED payé) |
| IN_PROGRESS | IN_PROGRESS | Supplément soumis/accepté | Nouvelle version de devis `SUPPLEMENT` ; paiement exigé avant clôture |
| IN_PROGRESS | WORK_COMPLETED | Pro « Terminer » | Aucun devis en attente ; `auto_close_at` = now + délai |
| WORK_COMPLETED | CLOSED | Client confirme / clôture auto | Suppléments payés ; écritures « dû au pro » libérées |
| WORK_COMPLETED | DISPUTED | Client signale un problème | Avant `auto_close_at` ; gel du reversement |
| DISPUTED | CLOSED | Admin résout (avec ou sans remboursement partiel) | Permission `dispute.resolve` |
| AWAITING_QUOTE, QUOTE_PENDING_APPROVAL, CONFIRMED, PAYMENT_PENDING, PAYMENT_CONFIRMED, EN_ROUTE, ARRIVED | CANCELLED | Client, pro ou admin | Barème d'annulation → remboursement total/partiel calculé |
| IN_PROGRESS | DISPUTED | Client ou pro | Annulation impossible une fois les travaux commencés : passe par un litige |

**Transitions explicitement interdites (testées)** : CANCELLED → tout état ; CLOSED → tout état sauf ouverture d'une réclamation (qui ne change pas l'état) ; tout saut d'étape (ex. CONFIRMED → IN_PROGRESS sans paiement, PAYMENT_PENDING → EN_ROUTE, EN_ROUTE → WORK_COMPLETED) ; transitions déclenchées par le mauvais acteur (client qui déclare « arrivé »).

Implémentation : une table de transitions déclarative unique (`missions/state-machine.ts`) — `{from, to, actor, guard}` — utilisée par le service et par un test qui énumère **toutes** les paires (de, vers) pour vérifier que seules les paires déclarées passent.

## 4.6 Correspondance avec la liste du cahier des charges

| Libellé du cahier des charges | État technique |
|---|---|
| Demande en brouillon | request DRAFT |
| Demande publiée | request PUBLISHED |
| Recherche de professionnels | request MATCHING |
| Propositions reçues | request OFFERS_RECEIVED |
| Professionnel provisoirement réservé | request PROVISIONALLY_RESERVED |
| En attente de confirmation du client | request AWAITING_CLIENT_CONFIRMATION |
| En attente de devis | mission AWAITING_QUOTE |
| Devis à valider | mission QUOTE_PENDING_APPROVAL |
| Intervention confirmée | mission CONFIRMED |
| Paiement en attente / confirmé | mission PAYMENT_PENDING / PAYMENT_CONFIRMED |
| Professionnel en route / arrivé | mission EN_ROUTE / ARRIVED |
| Intervention en cours / terminée | mission IN_PROGRESS / WORK_COMPLETED |
| Mission clôturée / annulée / en litige | mission CLOSED / CANCELLED / DISPUTED |

Le client voit une **chronologie unique** combinant les deux machines.

## 4.7 Identité visuelle (direction proposée — détaillée en phase 2)

- **Nom et ton** : « Ineed » — direct, rassurant. Signature proposée : *« Le bon pro, tout près. »*
- **Palette** : Bleu nuit `#0B2A5B` (confiance, primaire), Bleu action `#1F5EFF`, Orange signal `#FF7A1A` (urgence, CTA « Intervention immédiate »), Vert validation `#12A150`, Rouge erreur `#D92D20`, neutres `#F5F7FB` → `#101828`. Contrastes AA vérifiés en phase 2.
- **Typographie** : *Inter* (interface) et *Plus Jakarta Sans* (titres) — libres, lisibles sur petits écrans, bon rendu des accents.
- **Logo provisoire** : monogramme « i » dont le point est un repère de localisation, posé dans un carré arrondi bleu nuit ; mot-symbole « ineed » en minuscules.
- **Icônes métiers** : jeu d'icônes linéaires homogènes (une par catégorie, clé `icon_key` administrable).
- **Composants** : cartes pro (photo, nom, badge « Vérifié par Ineed » seulement si `verified_at`, note, missions terminées, distance « environ »), boutons pleine largeur 48 px min, états de chargement squelettes, états vides illustrés avec une action, erreurs en français clair (« Pas de connexion. Vos informations sont gardées, réessayez dans un instant. »).
- **Montants** : `15 000 F CFA` (espace insécable comme séparateur de milliers, pas de décimales).
