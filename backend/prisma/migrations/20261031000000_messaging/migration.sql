-- Phase 8 : envoi des notifications push, messagerie, avis, réclamations.

-- File d'envoi des notifications (outbox) : reprises avec délai croissant, motif du dernier échec.
ALTER TABLE notifications ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE notifications ADD COLUMN last_error text;
ALTER TABLE notifications ADD COLUMN push_result text CHECK (push_result IN ('SENT','NO_DEVICE','DISABLED'));
CREATE INDEX notifications_queue_idx ON notifications (next_attempt_at) WHERE status = 'QUEUED';

CREATE INDEX devices_user_idx ON devices (user_id, app) WHERE disabled_at IS NULL;

-- Messagerie : liste des conversations d'un participant, dernier message.
CREATE INDEX conversations_client_idx ON conversations (client_id);
CREATE INDEX conversations_pro_idx ON conversations (pro_id);
ALTER TABLE conversations ADD COLUMN last_message_at timestamptz;

-- Réclamations : référence lisible « REC-2026-000123 », liste par auteur et par statut.
CREATE SEQUENCE complaint_reference_seq START 1;
CREATE INDEX complaints_opened_by_idx ON complaints (opened_by, created_at DESC);
CREATE INDEX complaints_status_idx ON complaints (status, created_at);
CREATE INDEX complaint_messages_idx ON complaint_messages (complaint_id, created_at);
-- Réclamation ouverte sur une mission : le reversement correspondant est gelé jusqu'à sa résolution.
CREATE INDEX complaints_open_mission_idx ON complaints (mission_id) WHERE status IN ('OPEN','IN_REVIEW','WAITING_USER');

-- Signalements à traiter par la modération.
CREATE INDEX abuse_reports_status_idx ON abuse_reports (status, created_at);

-- Application depuis laquelle la réclamation a été ouverte : les réponses du support y sont notifiées.
ALTER TABLE complaints ADD COLUMN opened_from app_kind NOT NULL DEFAULT 'CLIENT';

-- Pièce jointe d'une réclamation (photo du problème, capture, PDF).
ALTER TABLE files DROP CONSTRAINT files_purpose_check;
ALTER TABLE files ADD CONSTRAINT files_purpose_check
  CHECK (purpose IN ('AVATAR','REQUEST_PHOTO','REQUEST_VOICE','VERIFICATION_DOC','MESSAGE_PHOTO','MISSION_REPORT','CATEGORY_ICON','COMPLAINT_ATTACHMENT'));
