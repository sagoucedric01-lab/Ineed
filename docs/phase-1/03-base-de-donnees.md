# 3. Schéma initial de la base de données

Le schéma complet et exécutable est dans [`schema-initial.sql`](./schema-initial.sql) (PostgreSQL 16 + PostGIS 3).
Il a été **chargé avec succès sur une base vierge** et vérifié par [`schema-invariants-check.sql`](./schema-invariants-check.sql) — résultats en fin de document.

## 3.1 Domaines et tables

| Domaine | Tables |
|---|---|
| Référentiel géographique | `countries`, `cities`, `zones` (commune → quartier → secteur, contours facultatifs) |
| Identité et accès | `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `admin_credentials`, `otp_challenges`, `sessions`, `devices` |
| Fichiers | `files` (métadonnées ; contenu dans le stockage objet) |
| Adresses | `addresses` (point sur la carte obligatoire, rue facultative, repère, indications) |
| Catalogue | `categories` (hiérarchique), `services` (modèle de tarification), `reference_prices` (par ville), `skills` |
| Paramétrage | `dispatch_rules`, `commission_rules`, `settings` |
| Professionnels | `pro_profiles`, `pro_categories`, `pro_skills`, `pro_service_zones`, `pro_weekly_hours`, `pro_time_off`, `verification_document_types`, `verification_documents`, `pro_verification_events`, `payout_accounts` |
| Demandes | `service_requests`, `request_media`, `request_status_history`, `request_offers` (alertes + propositions) |
| Missions | `missions`, `mission_status_history`, `mission_reports`, `mission_report_files`, `location_pings` |
| Devis | `quotes` (une ligne par version), `quote_lines` |
| Argent | `payments`, `payment_provider_events`, `refunds`, `commissions`, `payouts`, `payout_items`, `ledger_transactions`, `ledger_entries`, `promotions`, `promotion_redemptions` |
| Fiabilité API | `idempotency_keys` |
| Communication | `conversations`, `messages`, `conversation_reads`, `notification_templates`, `notifications` |
| Confiance | `reviews`, `complaints`, `complaint_messages`, `abuse_reports` |
| Divers | `search_history`, `audit_logs` |

## 3.2 Règles d'intégrité appliquées par la base

| Règle | Mécanisme |
|---|---|
| Une demande n'a jamais deux missions actives | Index unique partiel `missions(request_id) WHERE status <> 'CANCELLED'` |
| Une seule proposition retenue par demande | Index unique partiel `request_offers(request_id) WHERE status='SELECTED'` |
| Un pro ne reçoit qu'une alerte par demande | `UNIQUE(request_id, pro_id)` |
| Un seul devis en attente de décision par mission | Index unique partiel `quotes(mission_id) WHERE status='SUBMITTED'` |
| Total du devis = somme des lignes | Trigger de contrainte différé |
| Devis soumis immuable | Trigger sur `quote_lines` |
| Un seul paiement réussi par (mission, devis, objet) | Index unique partiel |
| Paiement « réussi » ⇒ confirmation serveur horodatée | `CHECK (status <> 'SUCCEEDED' OR confirmed_at IS NOT NULL)` |
| Notification de paiement répétée sans effet | `UNIQUE(provider, provider_event_id)` |
| Remboursements ≤ montant payé | Trigger avec verrou sur le paiement |
| Grand livre équilibré, en ajout seul | Trigger de contrainte différé (somme = 0) + trigger anti-modification |
| Avis uniquement sur mission clôturée du bon client/pro | Trigger + `UNIQUE(mission_id)` |
| Journal d'audit non modifiable | Trigger anti-UPDATE/DELETE (+ en production : rôle applicatif sans droit DELETE) |
| Un pro n'est « approuvé » que s'il a une date de vérification | `CHECK` sur `pro_profiles` |
| Montants | `bigint` XOF, `CHECK > 0` ou `>= 0`, devise forcée à `XOF` dans `payments` |
| Téléphones | Format E.164 contrôlé (`+225…`) |

## 3.3 Requête de proximité de référence

```sql
SELECT p.user_id,
       ST_Distance(p.last_location, $point) AS distance_m
FROM pro_profiles p
JOIN pro_categories pc ON pc.pro_id = p.user_id AND pc.category_id = $category
JOIN users u ON u.id = p.user_id AND u.status = 'ACTIVE'
WHERE p.verification_status = 'APPROVED'
  AND p.is_online AND (p.paused_until IS NULL OR p.paused_until < now())
  AND ST_DWithin(p.last_location, $point, LEAST($radius, p.service_radius_m))
  AND NOT EXISTS (SELECT 1 FROM missions m WHERE m.pro_id = p.user_id
                  AND m.status IN ('EN_ROUTE','ARRIVED','IN_PROGRESS'))      -- mode urgence
ORDER BY distance_m
LIMIT $wave_size;
```

En mode programmé, `is_online` est remplacé par une vérification du créneau (`pro_weekly_hours` + absence de chevauchement avec `pro_time_off` et les missions planifiées). Le score final (distance, note, taux d'acceptation, annulations) est calculé dans le service `dispatch`, pas dans la requête, pour rester testable et paramétrable.

## 3.4 Dates et fuseau horaire

Toutes les colonnes temporelles sont `timestamptz` (stockées en UTC). Le serveur formate en `Africa/Abidjan` (UTC+0, sans heure d'été) pour SMS/notifications, et les applications affichent en heure locale de la ville de la mission (`cities.timezone`). Les horaires hebdomadaires des pros sont des `time` locaux interprétés dans le fuseau de leur ville.

## 3.5 Politique de conservation (proposition — à valider juridiquement)

| Donnée | Conservation | Ensuite |
|---|---|---|
| Pings de position de trajet | 30 jours après clôture de la mission | Suppression |
| Dernière position du pro | Écrasée à chaque mise à jour ; effacée au passage hors ligne > 24 h | — |
| Codes OTP | 24 h | Suppression |
| Sessions révoquées/expirées | 90 jours | Suppression |
| Messages | 12 mois après clôture | Suppression (sauf litige en cours) |
| Documents de vérification | Durée de l'activité du pro + 1 an | Suppression du fichier, conservation de la décision |
| Demandes, missions, devis, paiements, grand livre | 10 ans (obligations comptables — à confirmer) | Anonymisation des personnes |
| Journal d'audit | 5 ans | Archivage |
| Compte supprimé | Anonymisation immédiate des données d'identité ; données comptables conservées sous forme pseudonymisée | — |

## 3.6 Résultat de la vérification (exécutée le 28/10/2026, PostgreSQL 16.15 + PostGIS 3)

```
NOTICE:  OK 1 recherche de proximité
NOTICE:  OK 2 double attribution refusée
NOTICE:  OK 3a total de devis incohérent refusé
NOTICE:  OK 3b devis soumis immuable
NOTICE:  OK 4a double paiement réussi refusé
NOTICE:  OK 4b succès sans confirmation serveur refusé
NOTICE:  OK 4c plafond de remboursement
NOTICE:  OK 5 écriture déséquilibrée refusée
NOTICE:  OK 6 avis sur mission non clôturée refusé
NOTICE:  OK 7 journal d'audit non modifiable
```

Commande pour reproduire :

```bash
createdb ineed_p1 && psql -v ON_ERROR_STOP=1 -d ineed_p1 -f docs/phase-1/schema-initial.sql -f docs/phase-1/schema-invariants-check.sql
```

Il s'agit d'un **brouillon de conception** : en phase 3, il deviendra `schema.prisma` + migrations versionnées, et ces vérifications deviendront des tests d'intégration automatisés.
