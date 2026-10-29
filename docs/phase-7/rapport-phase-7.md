# Rapport de fin de phase 7 — Devis, paiements, remboursements

Date : 29/10/2026. Branche : `phase-7-paiements` (construite sur `phase-6-missions`).

## Point essentiel

Le parcours complet fonctionne de bout en bout :

1. le professionnel envoie un devis ;
2. le client l'accepte ;
3. il paie ;
4. le serveur vérifie le paiement ;
5. la mission avance ;
6. le grand livre est mis à jour ;
7. le remboursement est calculé en cas d'annulation.

**Mais les paiements passent par le simulateur.** Aucun compte marchand n'a été fourni : l'adaptateur CinetPay est écrit et testé sur le format de sa documentation publique (tests de contrat), **sans avoir été essayé sur un vrai compte**. Je n'ai pas non plus pu relire cette documentation pendant la phase : le site de CinetPay n'est pas joignable depuis l'environnement de développement. Le format (champs, codes de réponse, signature `x-token`) est donc à confirmer à la réception des clés.

## Critères d'acceptation

Tous ces tests tournent sur PostgreSQL/PostGIS, Redis et le stockage réels (`backend/test/integration/payments.int.spec.ts`), avec le simulateur de paiement.

| Test | Résultat | Ce qui est vérifié |
|---|---|---|
| T12 — création et modification d'un devis | ✅ | **Contenu** : devis détaillé (déplacement, main-d'œuvre, matériaux), conditions et durée ; la mission passe en « devis à valider ».<br>**Contrôles** : total nul refusé ; total non multiple de 5 F CFA refusé (contrainte Mobile Money).<br>**Versions** : un devis envoyé est figé en base ; une modification crée une version 2, la version 1 passe « remplacée » et ne peut plus être acceptée.<br>**Clé d'idempotence** : obligatoire. Rejouée, elle renvoie la même version ; réutilisée pour un autre contenu, elle est refusée. |
| T13 — acceptation ou refus | ✅ | **Refus** : refus motivé, la mission repasse « en attente de devis » et le professionnel est prévenu. Une nouvelle version est envoyée puis acceptée : la mission passe « confirmée » puis « paiement en attente ».<br>**Idempotence** : l'acceptation renvoyée (réponse perdue) n'a pas de second effet.<br>**Expiration** : un devis expiré fait revenir la mission en attente de devis, et une acceptation tardive est refusée. |
| T14 — paiement réussi | ✅ | **Montant** : calculé par le serveur ; un double appui donne la même tentative.<br>**Rien n'est confirmé sur un simple signal** : notification falsifiée → 401 ; notification sans signature → 401 ; notification authentique alors que le paiement est encore en attente chez le prestataire → aucun effet.<br>**Après vérification serveur** : mission « paiement confirmé » et commission de 1 300 F (10 % de la main-d'œuvre, hors matériaux et déplacement).<br>**Grand livre** : +20 000 fonds clients, −18 700 dû au professionnel, −1 300 revenu Ineed, somme 0.<br>**Suite** : reçu, revenus du professionnel, départ autorisé. |
| T15 — paiement échoué | ✅ | **Refus de l'opérateur** : paiement « échoué » avec son motif, mission toujours en attente, client prévenu, aucune écriture. Un abandon, puis un nouvel essai réussi.<br>**Sans paiement** : une seule relance au bout de 15 min. À 2 h, la mission est annulée sans frais et le professionnel prévenu. Une page de paiement abandonnée expire au bout de 30 min. |
| T16 — notification répétée | ✅ | **10 envois simultanés de la même notification** : un seul événement enregistré, un seul encaissement, une seule commission, un seul passage « paiement confirmé », une seule notification au client. Rejouée plus tard, elle est reconnue comme déjà traitée.<br>**Notification perdue** : le worker revérifie et confirme le paiement.<br>**Montant confirmé différent de l'attendu** : aucun effet, anomalie journalisée. |
| T17 — remboursement | ✅ | **Désistement du professionnel** : remboursement intégral, commission rendue, les trois comptes de la mission reviennent à 0. Un tick rejoué ne rembourse pas deux fois.<br>**Annulation par le client alors que le professionnel est en route** : 13 000 F rendus, 2 000 F de déplacement gardés par le professionnel, commission intégralement rendue.<br>**Remboursement par l'administration** : réservé au rôle Finance (Support refusé), plafonné au montant payé (contrôle applicatif **et** en base), journalisé, idempotent.<br>**Remboursement manuel** : saisi par l'administration avec la référence du prestataire.<br>**Paiement reçu après l'annulation, ou payé deux fois** : enregistré puis remboursé automatiquement. |
| Rapprochement : somme du grand livre = 0 | ✅ | Sur l'ensemble de la base de test, après tous les scénarios : somme totale 0, aucune transaction déséquilibrée, fonds clients = paiements réussis − remboursements effectués, écritures non modifiables. |
| Simulateur impossible en production | ✅ | Configuration refusée au démarrage (`env.spec.ts`). Le prestataire ne peut pas être construit en production, même si la validation était contournée (`billing.module.spec.ts`). Sur une API en configuration de production : page simulée et notification « sandbox » en 404 (`health.int.spec.ts`). |
| Idempotence des POST financiers | ✅ | En-tête `Idempotency-Key` obligatoire sur : accepter ou refuser un devis, envoyer un devis, payer, rembourser (administration). La réponse d'origine est rejouée avec l'en-tête `Idempotent-Replayed`. Une clé réutilisée pour un autre contenu → 422, une requête en cours → 409. |

Parcours supplémentaires testés :
- **frais supplémentaires pendant les travaux** : justification exigée, acceptés, la fin d'intervention est bloquée tant qu'ils ne sont pas payés ;
- **déplacement + diagnostic** : frais de déplacement payés avant le départ, devis des travaux sur place, paiement, puis début des travaux.

## Ce qui a été construit

### Devis (`backend/src/quotes`)
- **Versions** : chaque modification crée une nouvelle version. Un seul devis peut attendre la réponse du client (contrainte en base). Les lignes sont figées dès l'envoi (déclencheur en base) et le total est contrôlé par la base.
- **Types** : devis initial avant le déplacement, devis des travaux après le diagnostic sur place, frais supplémentaires pendant les travaux (justification obligatoire, appliqués seulement s'ils sont acceptés).
- **Vie du devis** : retrait par le professionnel ; expiration (48 h par défaut) ; retrait automatique si la mission est annulée.

### Paiements (`backend/src/payments`, `backend/src/billing/providers`)
- **Contrat `PaymentProvider`** : `initiate`, `verify`, `parseNotification`, `refund`.
- **Simulateur** : page marquée « SIMULATION », notification signée, état partagé par l'API et le worker (Redis), remboursement immédiat.
- **CinetPay** (API Checkout v2) : création du paiement, vérification `/v2/payment/check`, signature `x-token` (HMAC SHA-256) contrôlée avec le site marchand, traduction des codes. Le remboursement est déclaré « manuel » : à ma connaissance, l'API Checkout ne propose pas de remboursement (à confirmer avec CinetPay).
- **Statut « réussi »** : il ne vient jamais de l'application ni du contenu d'une notification. Seule la vérification serveur à serveur le donne, après contrôle du montant et de la devise. Il est appliqué une seule fois (verrou sur le paiement, unicité en base).
- **Montant dû** : toujours calculé par le serveur (devis accepté, prix fixe, frais de déplacement ou frais supplémentaires).
- **Cas réels gérés** : client qui paie après l'expiration de sa page, client qui paie deux fois, paiement arrivé après une annulation. L'argent encaissé est enregistré puis remboursé automatiquement.
- **Worker** (toutes les 15 s, sous verrou Redis) : revérifie les paiements en attente, expire les pages abandonnées, relance le client, annule les missions non payées (avant tout déplacement), expire les devis, exécute les remboursements, purge les clés d'idempotence.

### Grand livre, commissions, remboursements (`backend/src/billing`)
- **Grand livre en partie double** : fonds clients, dû au professionnel, revenu Ineed. Chaque transaction est équilibrée (contrôle en base) et les écritures sont en ajout seul.
- **Commission** : règle par catégorie, ou règle par défaut. Le taux par défaut de 10 % est provisoire, en attendant le taux de la décision D9. Les matériaux et le déplacement sont exclus de l'assiette (déplacement inclus si la règle le prévoit). Arrondi au franc, avec un plancher.
- **Barème d'annulation** : gratuit avant le départ ; une fois le professionnel parti (y compris pendant un devis de travaux après diagnostic), les frais de déplacement restent dus. Sur une annulation par le professionnel ou l'administration : remboursement intégral.
- **Remboursement par l'administration** : permission `refund.approve`, journalisé, plafonné.

### Reçus et revenus
- **Reçu** d'un paiement confirmé : lignes, moyen de paiement, référence de l'opération, numéro masqué, remboursements. Il est marqué « SIMULATION — sans valeur » pour le simulateur. Ce n'est **pas une facture**.
- **Revenus du professionnel** : montant dû par mission, « en attente » jusqu'à la clôture puis « disponible ».

### Applications
- **Ineed (client)** :
  - **Devis** : devis détaillé à accepter ou refuser (avec motif) ; frais supplémentaires avec leur justification.
  - **Paiement** :
    - « Payer » ouvre la page du prestataire dans le navigateur ;
    - l'application interroge ensuite le serveur toutes les 3 s ;
    - elle n'affiche « Paiement confirmé » que lorsque le serveur l'a vérifié ;
    - un refus est affiché avec son motif, et un nouvel essai est possible ;
    - après une coupure réseau, le nouvel essai renvoie la même clé.
  - **Reçus** et mention « paiement simulé ».
- **Ineed Pro** :
  - éditeur de devis (types de ligne, quantités, total en direct, contrôle du multiple de 5, validité, conditions) et de frais supplémentaires ;
  - suivi : envoyé, refusé avec motif, attente du paiement, paiement confirmé ;
  - montants : payé, commission et net par mission ;
  - écran « Mes revenus ».
- **Rafraîchissement** : l'écran de mission Pro se met à jour seul (toutes les 10 s) tant que la mission attend le client.

## Corrections faites pendant la phase
- **Relation mission → devis** : le schéma Prisma traitait la relation comme « un seul devis », à cause de l'index partiel d'unicité. L'index porte désormais sur (mission, statut), avec la même garantie.
- **Conditions d'annulation après un diagnostic sur place** : elles étaient calculées « sans frais », alors que le professionnel s'était déplacé. Elles tiennent maintenant compte du départ.
- **Commission lors d'une annulation avec frais de déplacement** : elle était rendue au prorata, ce qui laissait une commission sur le déplacement, contrairement à la décision D9. Elle est maintenant rendue entièrement.

## Tests exécutés dans cet environnement

| Suite | Résultat |
|---|---|
| Backend — unitaires | 110 / 110 : règles monétaires, contrat CinetPay, choix du prestataire, configuration, machine à états |
| Backend — intégration (PostgreSQL/PostGIS, Redis, S3) | 455 / 455, dont 23 scénarios de la phase 7, les 18 de la phase 6 rejoués avec le vrai parcours de paiement et la matrice d'accès étendue (45 routes × 7 profils) |
| Backend — lint, typage, dérive schéma ↔ migrations | aucune erreur, aucune dérive |
| Mobile — `flutter analyze --fatal-infos` | aucune remarque |
| Mobile — `flutter test` (core 19, api 20, ui 6, shared 3, client 30, pro 25) | 103 / 103 |
| Âge des dépendances mobiles (`check_pub_age.py`) | 163 paquets, aucun trop récent |

Non exécuté :
- aucun paiement réel ;
- aucun appel au serveur de CinetPay ;
- aucun essai sur téléphone.

Les tests mobiles utilisent un faux serveur.

## Limitations connues
- **CinetPay non essayé** : à valider sur l'environnement de test de CinetPay dès réception des clés. À vérifier en particulier :
  - le format des requêtes et le champ `channels` ;
  - la liste et l'ordre des champs signés ;
  - les codes de statut ;
  - l'appel de contrôle (GET) de l'adresse de notification.
- **Remboursements avec CinetPay** : exécution manuelle dans l'espace marchand, puis saisie de la référence dans Ineed (route d'administration ; écran en phase 9). Une automatisation via l'API de transfert reste à étudier avec CinetPay.
- **Reversements aux professionnels** : pas encore réalisés. Le montant dû est tenu mission par mission ; la validation administrative et le fournisseur de transfert arrivent en phase 9.
- **Frais du prestataire de paiement** : absents du grand livre, car ils ne sont pas connus. Le rapprochement avec les relevés du prestataire est à faire en phase 9.
- **Taux de commission** : 10 % provisoire (D9), modifiable en base ; l'écran d'administration arrive en phase 9.
- **Reçus** : pas une facture (mentions fiscales à définir avec un conseil), pas de PDF ni d'e-mail.
- **Promotions** : tables prêtes, non utilisées.
- **Montage juridique** (D2) : l'encaissement sur un compte marchand puis le reversement restent **soumis à avis juridique** (BCEAO) avant la production.
- **Retour dans l'application après paiement** : l'application vérifie le paiement en interrogeant le serveur. Il n'y a pas encore de lien profond de retour depuis la page du prestataire (`PAYMENT_RETURN_URL` mène à une page d'information).

## Variables et paramètres

| Variable | Rôle |
|---|---|
| `PAYMENT_PROVIDER` | `sandbox` (défaut hors production, refusé en production) ou `cinetpay` |
| `PUBLIC_API_URL` | Adresse publique de l'API (notifications du prestataire, page simulée). Obligatoire avec CinetPay, en https en production |
| `PAYMENT_RETURN_URL` | Page de retour après paiement (obligatoire avec CinetPay) |
| `CINETPAY_API_KEY`, `CINETPAY_SITE_ID`, `CINETPAY_SECRET_KEY` | Clés du compte marchand (**à fournir**, jamais dans le dépôt) |
| `CINETPAY_API_URL` | `https://api-checkout.cinetpay.com` par défaut |

| Paramètre (table `settings`) | Défaut | Rôle |
|---|---|---|
| `quote.default_validity_hours` | 48 | Validité d'un devis |
| `quote.max_total_xof` | 5 000 000 | Montant maximal d'un devis |
| `payment.checkout_ttl_minutes` | 30 | Durée d'une page de paiement |
| `payment.reminder_minutes` | 15 | Relance du client |
| `payment.timeout_minutes` | 120 | Annulation sans frais d'une mission non payée (avant tout déplacement) |
| Règle de commission par défaut | 10 % (provisoire) | Hors matériaux et déplacement |

**À fournir** :
- un compte marchand CinetPay en environnement de test, avec ses trois clés ;
- l'adresse de notification à déclarer chez CinetPay ;
- le taux de commission (D9) ;
- l'avis juridique sur l'encaissement (D2).

## Non-régression
- Les suites des phases 3 à 6 passent toujours. Les tests de la phase 6 utilisent désormais le vrai parcours devis → paiement (simulateur) au lieu d'une transition forcée.
- La liste des routes publiques est mise à jour : retour de paiement, contrôle de l'adresse de notification, notifications, page simulée (404 hors simulateur).
- Migration ajoutée : `20261030000000_payments`, sans dérive avec le schéma.
- `docs/api/openapi.json` est régénéré (104 chemins).
