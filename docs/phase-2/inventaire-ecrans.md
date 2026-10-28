# Inventaire des écrans et de leurs états

Légende des états — chaque écran qui charge des données **doit** prévoir :
**C** chargement (squelette, jamais un écran blanc) · **V** vide (message + action) · **E** erreur (message clair + « Réessayer », données conservées) · **H** hors connexion (bandeau, actions mises en file ou désactivées) · **S** succès (confirmation explicite).
Les clés de texte renvoient à `design/copy/*.arb`. La colonne « Maquette » renvoie à `design/maquettes/` (✔ = maquette réalisée en phase 2).

## Application client « Ineed »

| ID | Écran | États | Contenu / règles | API (phase) | Maquette |
|---|---|---|---|---|---|
| C-01 | Présentation (3 volets) | — | `onboarding1..3*`, « Passer » | — | |
| C-02 | Numéro de téléphone | E (numéro invalide, trop de demandes) | Préfixe +225 prérempli, clavier numérique, mention CGU | `POST /auth/otp` (4) | ✔ |
| C-03 | Code SMS | C, E (code faux, expiré, bloqué), S | 6 cases, collage automatique, compte à rebours de renvoi, bandeau mode dev si actif | `POST /auth/otp/verify` (4) | ✔ |
| C-04 | Compléter le profil | E | Prénom, nom | `PATCH /me` (4) | |
| C-05 | Accueil | C, E (catégories), H | Salutation, adresse, recherche, 2 boutons principaux, catégories (backend), recherches récentes, missions en cours, notifications, profil | `GET /catalog/categories`, `GET /me/missions?active` (5–6) | ✔ |
| C-06 | Recherche | C, V (« aucun métier ne correspond »), E | Résultats catégories + prestations par mots-clés et synonymes | `GET /catalog/search` (5) | |
| C-07 | Choix de la prestation | C, E | Sous-catégories, modèle de prix affiché (fixe / devis / déplacement + devis) | `GET /catalog/categories/:id` (5) | ✔ |
| C-08 | Urgence ou programmé + créneau | E (créneau invalide) | Mode, jour, plage horaire | — | |
| C-09 | Autorisation de localisation | — | Pré-écran explicatif **avant** la demande système | — | |
| C-10 | Adresse et carte | C (position), E (refus, imprécision, hors zone) | Marqueur déplaçable, commune, quartier, rue facultative, repère, indications, adresses enregistrées | `GET /geo/reverse`, `POST /me/addresses` (5) | ✔ |
| C-11 | Description | E (trop court, fichier trop lourd/refusé), C (envoi) | Texte, 5 photos, note vocale 2 min, budget | `POST /files/presign`, `PUT` S3 (5) | ✔ |
| C-12 | Récapitulatif | E | Résumé + mention de confidentialité + « Publier » | `POST /requests/:id/publish` (5) | ✔ |
| C-13 | Recherche en cours (urgence) | C (progression réelle), H | Rayon, nombre de pros prévenus, élargissement, annulation | WebSocket + `GET /requests/:id` (6) | ✔ |
| C-14 | Aucun professionnel | V | 3 actions : élargir, changer d'horaire, programmer | `POST /requests/:id/widen` (6) | ✔ |
| C-15 | Pro réservé : confirmation | E (délai dépassé → retour C-13) | Carte pro, conditions de prix, compte à rebours, confirmer / chercher quelqu'un d'autre | `POST /requests/:id/confirm` (6) | ✔ |
| C-16 | Propositions reçues (programmé) | C, V (« d'autres propositions peuvent arriver ») | Liste triable distance / prix / note | `GET /requests/:id/offers` (6) | |
| C-17 | Profil public du pro | C, E | Photo, badge vérifié **seulement si `verified_at`**, note, missions, compétences, zones, horaires, avis vérifiés | `GET /pros/:id` (5) | |
| C-18 | Devis | C, E (expiré), S | Lignes, total, validité, conditions, historique des versions, accepter / refuser + motif | `POST /quotes/:id/accept|reject` (7) | ✔ |
| C-19 | Paiement | E (code promo), H (bouton désactivé) | Montant, objet, code promo, moyens, mention sécurité, badge TEST si sandbox | `POST /missions/:id/payments` (7) | ✔ |
| C-20 | Vérification du paiement | C (attente opérateur), S, E (échec / expiré) | **Succès affiché uniquement après confirmation serveur** | WebSocket + `GET /payments/:id` (7) | ✔ |
| C-21 | Suivi de mission | C, H (position périmée) | Chronologie, carte du trajet (EN_ROUTE), messagerie, annulation avec barème | `GET /missions/:id`, WebSocket (6) | ✔ |
| C-22 | Annulation | E (non autorisée), S | Montant retenu / remboursé calculé par le serveur | `POST /missions/:id/cancel` (6–7) | |
| C-23 | Messagerie | C, V, E (envoi échoué : réessayer), H (file locale) | Bulles, horodatage, photos, signalement, avertissement coordonnées | `/conversations/*` + WebSocket (8) | |
| C-24 | Fin d'intervention | S | Confirmer / signaler un problème, date de clôture auto | `POST /missions/:id/confirm-completion` (6) | ✔ |
| C-25 | Reçu | C, E | Numéro, montants, moyen, remboursements, partage PDF | `GET /missions/:id/receipt` (7) | |
| C-26 | Évaluation | E, S | 5 étoiles libellées, commentaire | `POST /missions/:id/review` (8) | ✔ |
| C-27 | Mes missions | C, V (en cours / terminées) | Onglets, statut, accès reçu | `GET /me/missions` (6) | |
| C-28 | Notifications | C, V | Liste, non lues, tout marquer lu, liens profonds | `GET /me/notifications` (8) | |
| C-29 | Profil et réglages | — | Adresses, appareils connectés, notifications, aide, CGU, déconnexion, suppression | (4) | |
| C-30 | Suppression du compte | E (mission en cours), S | Avertissement, confirmation par code SMS | `POST /me/deletion` (4) | |
| C-31 | Réclamation (création + suivi) | C, E, S | Motif, description, photos, fil de réponses du support | `/complaints` (8) | |
| C-32 | Mise à jour obligatoire | — | Bloquant si version minimale non respectée | `GET /app-config` (4) | |

## Application professionnel « Ineed Pro »

| ID | Écran | États | Contenu / règles | API (phase) | Maquette |
|---|---|---|---|---|---|
| P-01 | Numéro / code | comme C-02/C-03 | | (4) | |
| P-02 | Type de compte | — | Indépendant / entreprise | (4) | |
| P-03 | Identité et photo | E | Nom affiché, RCCM si entreprise, photo | (4) | |
| P-04 | Métiers et spécialités | C, E | 3 métiers max, compétences | (4–5) | |
| P-05 | Expérience et présentation | E | Années, présentation | (4) | |
| P-06 | Zones et rayon | C, E | Communes, distance max, point de départ | (5) | |
| P-07 | Horaires | E (plage invalide) | Par jour, fermé | (4) | |
| P-08 | Justificatifs | C (envoi), E (format, taille) | Liste selon type de compte et métier, stockage privé | `POST /files/presign` (4) | |
| P-09 | Compte de reversement | E | Opérateur, numéro, titulaire | (7) | |
| P-10 | Statut de vérification | — | Soumis / compléments demandés (message) / refusé (motif) / validé / suspendu | `GET /pro/me` (4) | ✔ |
| P-11 | Tableau de bord | C, V (aucune demande), H, E (localisation refusée) | Interrupteur « Disponible maintenant », pause, demandes, missions du jour, gains de la semaine | (5–6) | ✔ |
| P-12 | Alerte de demande | E (déjà prise, expirée) | Plein écran, catégorie, résumé, photos, distance approx. + commune, modèle de prix, créneau, compte à rebours, motifs de refus rapides. **Pas d'adresse exacte** | `POST /offers/:id/accept|decline` (6) | ✔ |
| P-13 | Proposition (programmé) | E | Prix, frais de déplacement, heure proposée, message | `POST /offers/:id/propose` (6) | |
| P-14 | Mission : détail | C, H | Adresse et repère révélés après confirmation, itinéraire externe, étapes | `GET /pro/missions/:id` (6) | ✔ |
| P-15 | Mission : étapes | E (étape bloquée : devis / paiement) | Je pars → Je suis arrivé → Commencer → Terminer ; partage de position pendant le trajet | `POST /missions/:id/transitions` (6) | ✔ |
| P-16 | Création de devis | E (total, lignes), S | Lignes typées, quantité, prix unitaire, justification, validité, conditions, durée, commission et net affichés | `POST /missions/:id/quotes` (7) | ✔ |
| P-17 | Frais supplémentaires | E, S | Devis `SUPPLEMENT`, soumis au client | (7) | |
| P-18 | Fin et compte rendu | E, S | Texte, photos après intervention | (6) | |
| P-19 | Revenus | C, V | Montant dû, en attente de clôture, déjà reversé, commissions, remboursements, reversements et statuts, mention si reversements non activés | `GET /pro/earnings` (7) | ✔ |
| P-20 | Historique des transactions | C, V | Filtre période | (7) | |
| P-21 | Réglages pro | — | Métiers (re-vérification), zones, horaires, types de demandes, profil public | (4–5) | |
| P-22 | Messagerie, notifications, profil, assistance | comme C-23, C-28, C-29, C-31 | | (8) | |

## Administration web

| ID | Module | Écrans | Permissions (exemples) | Maquette |
|---|---|---|---|---|
| A-01 | Connexion | E-mail + mot de passe, TOTP, première activation TOTP | — | |
| A-02 | Tableau de bord | Indicateurs, files d'attente (dossiers, litiges, paiements en attente, écart de rapprochement) | `dashboard.read` | ✔ |
| A-03 | Clients | Liste, fiche (missions, paiements, signalements), suspension, révocation des sessions | `user.read`, `user.suspend` | |
| A-04 | Professionnels | Liste, fiche, suspension/réactivation, statistiques de fiabilité | `pro.read`, `pro.suspend` | |
| A-05 | Validation des documents | File, visionneuse sécurisée (accès journalisé), valider / refuser / demander compléments | `pro.verify` | ✔ |
| A-06 | Catégories | Arbre, ordre, icône, synonymes, activation | `catalog.write` | |
| A-07 | Prestations | Modèle de prix, prix fixe, frais de déplacement | `catalog.write` | |
| A-08 | Demandes | Liste filtrable, chronologie, offres envoyées | `request.read` | |
| A-09 | Missions | Liste, chronologie, intervention manuelle (annulation, litige) | `mission.read`, `mission.intervene` | |
| A-10 | Devis | Versions, lignes, décisions | `quote.read` | |
| A-11 | Paiements | Transactions, événements du prestataire, revérification, badge TEST | `payment.read` | |
| A-12 | Remboursements | Demandes, approbation (double validation au-delà d'un seuil) | `refund.approve` | |
| A-13 | Commissions | Règles par catégorie, historique | `commission.write` | |
| A-14 | Reversements | Soldes dus, lots, validation, statut fournisseur | `payout.approve` | |
| A-15 | Avis | Modération, masquage motivé | `review.moderate` | |
| A-16 | Réclamations | File, fil d'échanges, notes internes, résolution | `complaint.handle` | |
| A-17 | Signalements | File, actions | `report.handle` | |
| A-18 | Zones géographiques | Villes, communes, quartiers, activation | `geo.write` | |
| A-19 | Tarifs de référence | Par prestation et ville | `catalog.write` | |
| A-20 | Promotions | Codes, période, plafonds, utilisations | `promotion.write` | |
| A-21 | Notifications | Gabarits push/SMS, envoi de test à soi-même | `notification.write` | |
| A-22 | Statistiques | Demandes, taux sans pro, délai d'acceptation, CA, commissions | `stats.read` | |
| A-23 | Journal d'audit | Recherche par acteur, entité, action | `audit.read` | |
| A-24 | Paramètres et règles d'attribution | Rayons, vagues, délais, clôture auto, barème d'annulation | `settings.write` | |
| A-25 | Administrateurs et rôles | Comptes, rôles, révocation | `admin.manage` | |

## Règles transverses d'interface

1. **Aucun bouton sans action** : tout bouton visible est relié à une action réelle ou masqué. Une fonction indisponible (ex. reversements non activés) est expliquée par un message, jamais simulée.
2. **Badge « Identité vérifiée par Ineed »** affiché uniquement si `verified_at` est non nul.
3. **Montants** : toujours `15 000 F CFA` (espace fine insécable), calculés par le serveur ; l'application n'additionne jamais elle-même un total à payer.
4. **Distances** : toujours précédées de « environ » ; l'ETA n'est affichée que si un fournisseur d'itinéraire l'a calculée.
5. **Paiements de test** : bandeau `paymentTestBadge` sur chaque écran de paiement, reçu et revenu concerné.
6. **Accessibilité** : cibles tactiles ≥ 48 px, contraste AA vérifié par script, libellés pour lecteurs d'écran sur les icônes, tailles de police dynamiques jusqu'à 200 % sans perte d'information.
7. **Hors connexion** : bandeau `offlineBanner` ; les saisies sont conservées ; les actions sensibles (accepter, payer) sont désactivées hors ligne et rejouées uniquement avec leur clé d'idempotence.
