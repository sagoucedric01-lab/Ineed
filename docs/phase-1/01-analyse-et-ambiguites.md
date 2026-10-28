# 1. Analyse du cahier des charges et ambiguïtés

## 1.1 Synthèse

Ineed est une **marketplace transactionnelle à deux faces** (clients / professionnels) avec un back-office. La valeur et le risque se concentrent sur quatre noyaux :

| Noyau | Pourquoi il est critique | Où se joue la fiabilité |
|---|---|---|
| **Attribution** (urgence / programmé) | Deux professionnels ne doivent jamais obtenir la même mission | Transaction SQL + mise à jour conditionnelle + index unique partiel |
| **Machine à états des missions** | Toute la confiance (paiement, avis, litiges) dépend d'états cohérents | Table de transitions unique côté backend, tests exhaustifs |
| **Argent** (devis, paiements, commissions, remboursements, reversements) | Responsabilité financière et juridique | Confirmation serveur-à-serveur, idempotence, grand livre en partie double |
| **Confiance** (vérification, avis, données privées) | Une marketplace de services à domicile vit de la confiance | Vérification humaine tracée, avis réservés aux missions clôturées, divulgation progressive des coordonnées |

Le reste (catalogue, notifications, messagerie, administration) est conventionnel mais volumineux.

## 1.2 Ambiguïtés identifiées et proposition de décision

Les points marqués **[À VALIDER]** changent l'architecture, le coût ou la conformité : ils sont repris dans `07-decisions-a-valider.md`. Les autres sont tranchés par défaut, avec justification.

### Produit

| # | Ambiguïté | Décision proposée |
|---|---|---|
| A1 | **Moment du paiement** : avant le déplacement, avant les travaux, ou après la prestation ? Le Mobile Money ne permet pas de « pré-autorisation » comme une carte : le client est débité immédiatement. | Paiement **avant exécution**, fonds conservés chez le prestataire de paiement jusqu'à la confirmation de fin (ou clôture automatique), puis reversement. Modèle 3 : frais de déplacement payés à la confirmation, travaux payés après acceptation du devis sur place. **[À VALIDER — dépend du montage juridique, cf. A2]** |
| A2 | **Détention temporaire des fonds** : le cahier des charges interdit un portefeuille interne sans validation juridique, mais tout paiement « à l'avance » implique que l'argent transite sur le compte marchand d'Ineed avant reversement. | Pas de portefeuille client, pas de solde rechargeable. Les fonds restent sur le compte marchand du prestataire agréé ; Ineed tient un grand livre de ce qui est dû. **Un avis juridique (réglementation BCEAO sur les services de paiement / statut d'agent d'encaissement) est indispensable avant la production.** Alternative si l'avis est négatif : paiement direct du client au professionnel via un « split payment » du prestataire, Ineed ne prélevant que sa commission. **[À VALIDER]** |
| A3 | **Un seul projet Flutter ou deux applications ?** | **Deux applications publiées** (« Ineed » et « Ineed Pro ») dans un **monorepo Flutter** avec paquets partagés. Raisons : fiches Store distinctes, permissions différentes (localisation en arrière-plan uniquement côté pro), onboarding et notifications distincts, risque de rejet App Store réduit. |
| A4 | **Authentification** : mot de passe ou code SMS ? | Clients et pros : **numéro de téléphone + code à usage unique (OTP)**, sans mot de passe (usage local dominant, récupération de compte = nouveau code). Administrateurs : **e-mail + mot de passe argon2id + TOTP obligatoire**. **[À VALIDER — coût SMS]** |
| A5 | **Mode urgence : « premier qui accepte »** puis confirmation client — que se passe-t-il si le client refuse ? | La réservation est libérée, le pro suivant ayant accepté (s'il existe, offre encore valide) est proposé, sinon nouvelle vague. Délais (réservation, confirmation) paramétrables par règle d'attribution. |
| A6 | **Devis avant ou après déplacement ?** | Dépend du modèle de tarification de la prestation : FIXED (pas de devis), QUOTE (devis à distance sur photos/description, avant déplacement), TRAVEL_PLUS_DIAGNOSIS (frais de déplacement fixés à l'avance, devis travaux sur place). |
| A7 | **Clôture si le client ne confirme jamais la fin** | Clôture automatique après un délai paramétrable (48 h par défaut) après notification(s) de rappel, sauf ouverture d'un litige. |
| A8 | **Politique d'annulation et pénalités** | Barème paramétrable : annulation gratuite avant départ du pro ; après départ, frais de déplacement retenus ; après arrivée, frais de déplacement + éventuel diagnostic. Annulations par le pro : remboursement intégral + compteur de fiabilité. **[À VALIDER — règles commerciales]** |
| A9 | **Taux de commission** | Paramétrable par catégorie, en points de base. Valeur de départ à fixer. **[À VALIDER]** |
| A10 | **Prestations avec matériaux achetés par le pro** | Lignes « pièces / matériaux » dans le devis, payées via Ineed comme le reste, commission applicable ou non selon paramètre (`applies_to_materials`, par défaut non). **[À VALIDER]** |
| A11 | **Notes vocales** | Le cahier des charges les mentionne dans l'objectif (point 4) mais pas au 6.4. Décision : prises en charge (fichiers audio ≤ 2 min, contrôlés comme les photos), utiles pour une population qui préfère l'oral. |
| A12 | **Description libre d'un problème → catégorie** | V1 : recherche plein texte + synonymes administrables (`search_terms`). Classification automatique (IA) hors périmètre V1, interface prévue pour l'ajouter. |
| A13 | **Entreprises avec plusieurs techniciens** | V1 : une entreprise = un compte professionnel qui intervient lui-même. Gestion d'équipes (dispatch interne) reportée en V2, le schéma ne la bloque pas. **[À VALIDER si c'est un besoin du lancement]** |
| A14 | **Évaluation du client par le pro** | Non demandée. V1 : signalement uniquement. Évaluation bidirectionnelle possible en V2. |
| A15 | **Partage de position pendant le trajet** | Uniquement entre EN_ROUTE et ARRIVED, au premier plan de l'application pro (pas de localisation en arrière-plan en V1 → validation App Store plus simple). |

### Technique et conformité

| # | Ambiguïté | Décision proposée |
|---|---|---|
| T1 | **Hébergement et localisation des données** : la loi ivoirienne n° 2013-450 sur les données personnelles encadre les transferts hors de Côte d'Ivoire (autorisation ARTCI). | Architecture portable (conteneurs, PostgreSQL standard, stockage S3-compatible) pour pouvoir héberger en Côte d'Ivoire, en Europe ou en Afrique du Sud. **[À VALIDER — choix de l'hébergeur et formalités ARTCI]** |
| T2 | **Fournisseur de paiement** | Interface `PaymentProvider` agnostique ; premier adaptateur recommandé : **CinetPay** (acteur ivoirien, Orange Money / MTN / Moov / Wave / carte, API de transfert pour les reversements). Second candidat : **Wave Business API** en direct. Les deux doivent être confirmés commercialement (KYB, frais, délais). **[À VALIDER]** |
| T3 | **Cartographie** | Google Maps Platform (couverture et recherche de lieux à Abidjan meilleures que les alternatives) derrière une interface `MapsProvider`. Repli possible vers Mapbox ou OSM. **[À VALIDER — coût]** |
| T4 | **File de tâches** | Redis + BullMQ (expirations d'offres, vagues de recherche, relances de paiement, notifications). Redis sert aussi à la limitation de débit et à la diffusion WebSocket multi-instance. |
| T5 | **Temps réel** | WebSocket (Socket.IO) pour messagerie et suivi de trajet ; push FCM pour tout ce qui doit arriver application fermée. Le WebSocket n'est jamais la seule voie de livraison d'une information importante. |
| T6 | **ORM / migrations** | **Prisma** (migrations versionnées, typage) ; requêtes PostGIS et verrous en SQL brut paramétré via `$queryRaw`. Contraintes/triggers critiques écrits en SQL dans les migrations (le schéma brouillon les valide déjà). |
| T7 | **Environnement de développement actuel** | Node 22, pnpm, Docker, PostgreSQL 16 + PostGIS disponibles. **Flutter n'est pas installé** : il le sera en phase 3. Les builds iOS exigent macOS + Xcode + compte Apple Developer : impossibles dans ce conteneur Linux. Les tests sur appareils réels resteront à votre charge (ou via un service de ferme d'appareils). |
