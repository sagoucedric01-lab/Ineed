# 5. Prestataires externes, accès nécessaires et coûts à anticiper

> Les tarifs évoluent et dépendent de négociations : les montants ci-dessous sont des **ordres de grandeur à confirmer par devis** auprès de chaque prestataire, pas des prix garantis.

## 5.1 Liste des services

| Besoin | Recommandation | Alternatives | Accès à fournir | Disponible en test ? |
|---|---|---|---|---|
| **Paiement entrant** (Mobile Money + carte) | **CinetPay** (Orange Money, MTN MoMo, Moov Money, Wave, Visa/Mastercard ; webhooks + API de vérification) | Wave Business API (direct), PayDunya, Paystack (selon disponibilité en CI), Hub2 | Compte marchand validé (KYB : RCCM, DFE, pièces du dirigeant), `API_KEY`, `SITE_ID`, clé secrète de signature des notifications, URL de notification déclarée | Oui (environnement de test) — à confirmer à l'ouverture du compte |
| **Reversements** aux pros | API de transfert du même prestataire (ex. CinetPay Transfert) | Wave Payouts, virement bancaire manuel tracé | Activation du service de transfert, compte de transfert approvisionné, clés dédiées | À confirmer |
| **OTP / SMS** | Twilio Verify (simple, fiable) **ou** agrégateur local (ex. API SMS Orange CI) pour réduire le coût | Infobip, Africa's Talking (selon couverture CI), OTP WhatsApp | Identifiants API, nom d'expéditeur enregistré | Oui (Twilio : numéros de test) |
| **Notifications push** | Firebase Cloud Messaging (Android + iOS via APNs) | — | Projet Firebase, compte de service (backend), `google-services.json` / `GoogleService-Info.plist`, clé APNs (.p8) Apple | Oui (gratuit) |
| **Cartes / géocodage / ETA** | Google Maps Platform (Maps SDK, Places Autocomplete, Geocoding, Routes) | Mapbox, OSM + OSRM auto-hébergé | Clés restreintes par application (Android SHA-1, bundle iOS) + clé serveur restreinte par IP | Crédit mensuel gratuit, facturation à l'usage |
| **Stockage objet** | S3-compatible (AWS S3, Scaleway, OVHcloud, Cloudflare R2, ou MinIO auto-hébergé en CI) | — | Bucket public (avatars, icônes) + bucket privé (documents), clés d'accès | MinIO en local |
| **Hébergement** | Conteneurs sur VM/PaaS ; PostgreSQL managé avec PostGIS et sauvegardes PITR | Datacenter local ivoirien (si exigence de localisation) | Compte hébergeur, nom de domaine, DNS | — |
| **Redis** | Redis managé ou conteneur | — | URL + mot de passe | Conteneur local |
| **Erreurs / performances** | Sentry | GlitchTip (auto-hébergé) | DSN par application | Offre gratuite limitée |
| **E-mail transactionnel** (admin, reçus) | Brevo, Postmark ou Amazon SES | — | Domaine vérifié (SPF/DKIM) | Mailpit en local |
| **Antivirus fichiers** | ClamAV (conteneur) | — | — | Oui |
| **Stores** | Google Play Console, Apple Developer Program | — | Comptes au nom de la société Ineed | — |
| **CI/CD** | GitHub Actions ; build iOS sur runner macOS (GitHub ou Codemagic) | Codemagic, Bitrise | Dépôt GitHub du propriétaire, certificats de signature | — |

## 5.2 Coûts récurrents à anticiper

| Poste | Nature du coût | Ordre de grandeur (à confirmer) |
|---|---|---|
| Commission paiement | % par transaction encaissée (Mobile Money / carte) | Quelques % par transaction — **poste n°1, à intégrer dans le taux de commission Ineed** |
| Frais de transfert (reversements) | % ou forfait par transfert | Variable selon opérateur |
| SMS OTP | Par SMS envoyé | De quelques F CFA (agrégateur local) à nettement plus (fournisseurs internationaux) — prévoir 1,2 à 2 SMS par connexion |
| Google Maps | À l'usage (autocomplétion, géocodage, itinéraires) | Gratuit sous le crédit mensuel au lancement ; à surveiller (mise en cache, quotas) |
| Hébergement (API, worker, admin, BD managée, Redis, stockage, sauvegardes) | Mensuel | Quelques dizaines à quelques centaines d'euros / mois au lancement |
| Sentry, e-mail | Mensuel par palier | Offres gratuites suffisantes au départ |
| Apple Developer Program | Annuel | 99 USD / an |
| Google Play Console | Unique | 25 USD |
| Nom de domaine + certificats | Annuel | Faible (certificats Let's Encrypt gratuits) |
| Runner macOS (build iOS) | À la minute ou abonnement | Faible à modéré |
| Conseil juridique (paiement, données, CGU) | Ponctuel puis récurrent | À budgéter avant lancement |

## 5.3 Éléments à valider juridiquement

1. **Statut des encaissements** : Ineed peut-elle encaisser pour le compte des professionnels et reverser ensuite (réglementation BCEAO, rôle d'agent/mandataire, besoin d'un partenaire agréé) ? Délai maximal de conservation des fonds avant reversement.
2. **Protection des données** (loi n° 2013-450, ARTCI) : déclaration/autorisation des traitements, hébergement hors de Côte d'Ivoire, désignation d'un correspondant, durées de conservation (§3.5), traitement de la géolocalisation et des pièces d'identité.
3. **Conditions générales** : CGU clients, CGU/contrat professionnels (statut d'indépendant, responsabilité en cas de dommage, assurance), politique de confidentialité, politique d'annulation et de remboursement, règles de modération des avis.
4. **Fiscalité** : TVA sur la commission, facturation/reçus (mentions obligatoires), retenues éventuelles sur les reversements aux professionnels.
5. **Vérification des professionnels** : quelles pièces peuvent être exigées et conservées (casier judiciaire ?), mention exacte du badge (« Identité vérifiée » plutôt que « Professionnel certifié »).
6. **Promotions** : encadrement des offres promotionnelles.
7. **Consommateurs** : droit applicable aux prestations à domicile, médiation des litiges.
