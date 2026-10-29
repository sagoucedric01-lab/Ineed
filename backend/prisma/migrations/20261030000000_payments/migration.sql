-- Phase 7 : devis, paiements, remboursements, grand livre.

-- Un seul devis en attente par mission : même garantie, mais indexée sur (mission, statut) pour que le
-- client Prisma traite la relation mission → devis comme « plusieurs versions » et non « un seul devis ».
DROP INDEX quotes_one_pending_uq;
CREATE UNIQUE INDEX quotes_one_pending_uq ON quotes (mission_id, status) WHERE status = 'SUBMITTED';
CREATE INDEX quotes_expiry_idx ON quotes (valid_until) WHERE status = 'SUBMITTED';

-- Paiement réussi en double (client qui paie une seconde fois après l'expiration de la première tentative) :
-- l'argent a bien été encaissé, il est enregistré comme tel puis remboursé automatiquement. Il ne compte pas
-- dans la garantie « un seul paiement réussi par objet ».
ALTER TABLE payments ADD COLUMN is_duplicate boolean NOT NULL DEFAULT false;
DROP INDEX payments_one_success_uq;
CREATE UNIQUE INDEX payments_one_success_uq ON payments
  (mission_id, COALESCE(quote_id,'00000000-0000-0000-0000-000000000000'), purpose) WHERE status = 'SUCCEEDED' AND NOT is_duplicate;

-- Référence marchande lisible et unique envoyée au prestataire.
CREATE SEQUENCE payment_reference_seq START 1;

-- Échéance du paiement d'une mission : relance puis annulation sans paiement dans le délai.
ALTER TABLE missions ADD COLUMN payment_pending_since timestamptz;
ALTER TABLE missions ADD COLUMN payment_reminder_at timestamptz;
CREATE INDEX missions_payment_pending_idx ON missions (payment_pending_since) WHERE status = 'PAYMENT_PENDING';

-- Remboursements à exécuter auprès du prestataire.
CREATE INDEX refunds_todo_idx ON refunds (created_at) WHERE status = 'APPROVED';
