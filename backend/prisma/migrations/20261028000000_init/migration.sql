-- =============================================================================
-- Ineed — Migration initiale (issue du schéma validé en phase 1)
-- PostgreSQL 16 + PostGIS 3
--
-- Les contraintes CHECK, triggers et colonnes PostGIS ne sont pas représentables dans
-- schema.prisma : cette migration SQL fait foi pour la structure de la base.
--
-- Conventions :
--   * Identifiants : uuid (gen_random_uuid()).
--   * Dates : timestamptz, stockées en UTC ; affichage en Africa/Abidjan.
--   * Montants : bigint en unités entières de XOF (le XOF n'a pas de
--     subdivision utilisée). Jamais de float/numeric pour l'argent.
--   * Coordonnées : geography(Point, 4326) + index GiST.
--   * Champs "version" : verrouillage optimiste pour les machines à états.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Types énumérés
-- -----------------------------------------------------------------------------
CREATE TYPE user_status        AS ENUM ('ACTIVE','SUSPENDED','DELETION_REQUESTED','DELETED');
CREATE TYPE app_kind           AS ENUM ('CLIENT','PRO','ADMIN');
CREATE TYPE file_visibility    AS ENUM ('PUBLIC','PRIVATE');
CREATE TYPE file_status        AS ENUM ('PENDING_UPLOAD','UPLOADED','READY','REJECTED','DELETED');
CREATE TYPE pricing_model      AS ENUM ('FIXED','QUOTE','TRAVEL_PLUS_DIAGNOSIS');
CREATE TYPE request_mode       AS ENUM ('URGENT','SCHEDULED');
CREATE TYPE dispatch_strategy  AS ENUM ('FIRST_ACCEPT','CLIENT_CHOICE');
CREATE TYPE pro_kind           AS ENUM ('INDIVIDUAL','COMPANY');
CREATE TYPE verification_status AS ENUM ('DRAFT','SUBMITTED','INFO_REQUESTED','APPROVED','REJECTED','SUSPENDED');
CREATE TYPE document_status    AS ENUM ('PENDING','APPROVED','REJECTED','EXPIRED');
CREATE TYPE request_status AS ENUM (
  'DRAFT',                        -- Demande en brouillon
  'PUBLISHED',                    -- Demande publiée
  'MATCHING',                     -- Recherche de professionnels
  'OFFERS_RECEIVED',              -- Propositions reçues (mode programmé)
  'PROVISIONALLY_RESERVED',       -- Professionnel provisoirement réservé (mode urgence)
  'AWAITING_CLIENT_CONFIRMATION', -- En attente de confirmation du client
  'ASSIGNED',                     -- Attribuée : une mission existe
  'NO_PROVIDER_FOUND',            -- Aucun professionnel trouvé (action client attendue)
  'EXPIRED',
  'CANCELLED'
);
CREATE TYPE offer_status AS ENUM ('SENT','SEEN','ACCEPTED','DECLINED','EXPIRED','WITHDRAWN','NOT_SELECTED','SELECTED');
CREATE TYPE mission_status AS ENUM (
  'AWAITING_QUOTE',          -- En attente de devis
  'QUOTE_PENDING_APPROVAL',  -- Devis à valider
  'CONFIRMED',               -- Intervention confirmée
  'PAYMENT_PENDING',         -- Paiement en attente
  'PAYMENT_CONFIRMED',       -- Paiement confirmé
  'EN_ROUTE',                -- Professionnel en route
  'ARRIVED',                 -- Professionnel arrivé
  'IN_PROGRESS',             -- Intervention en cours
  'WORK_COMPLETED',          -- Intervention terminée (déclarée par le professionnel)
  'CLOSED',                  -- Mission clôturée
  'CANCELLED',               -- Mission annulée
  'DISPUTED'                 -- Mission en litige
);
CREATE TYPE quote_kind      AS ENUM ('INITIAL','SUPPLEMENT');
CREATE TYPE quote_status    AS ENUM ('DRAFT','SUBMITTED','ACCEPTED','REJECTED','SUPERSEDED','EXPIRED','WITHDRAWN');
CREATE TYPE quote_line_kind AS ENUM ('TRAVEL','LABOR','MATERIAL','OTHER');
CREATE TYPE payment_purpose AS ENUM ('FULL','TRAVEL_FEE','WORK','SUPPLEMENT');
CREATE TYPE payment_status  AS ENUM ('INITIATED','PENDING','SUCCEEDED','FAILED','CANCELLED','EXPIRED');
CREATE TYPE refund_status   AS ENUM ('REQUESTED','APPROVED','PROCESSING','SUCCEEDED','FAILED','REJECTED');
CREATE TYPE payout_status   AS ENUM ('PENDING','APPROVED','PROCESSING','PAID','FAILED','CANCELLED');
CREATE TYPE payout_method   AS ENUM ('ORANGE_MONEY','MTN_MOMO','MOOV_MONEY','WAVE','BANK_TRANSFER');
CREATE TYPE notification_status AS ENUM ('QUEUED','SENT','DELIVERED','FAILED','READ');
CREATE TYPE review_status   AS ENUM ('PUBLISHED','PENDING_MODERATION','HIDDEN');
CREATE TYPE complaint_status AS ENUM ('OPEN','IN_REVIEW','WAITING_USER','RESOLVED','REJECTED');
CREATE TYPE report_target   AS ENUM ('USER','PRO_PROFILE','MESSAGE','REVIEW','REQUEST');
CREATE TYPE report_status   AS ENUM ('OPEN','IN_REVIEW','ACTION_TAKEN','DISMISSED');
CREATE TYPE discount_kind   AS ENUM ('PERCENT','FIXED');

-- -----------------------------------------------------------------------------
-- Référentiel géographique (multi-pays / multi-villes)
-- -----------------------------------------------------------------------------
CREATE TABLE countries (
  code          char(2) PRIMARY KEY,              -- ISO 3166-1, ex. 'CI'
  name          text NOT NULL,
  currency      char(3) NOT NULL,                 -- ISO 4217, ex. 'XOF'
  phone_prefix  text NOT NULL,                    -- ex. '+225'
  is_active     boolean NOT NULL DEFAULT false
);

CREATE TABLE cities (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code  char(2) NOT NULL REFERENCES countries(code),
  name          text NOT NULL,
  timezone      text NOT NULL,                    -- ex. 'Africa/Abidjan'
  center        geography(Point,4326) NOT NULL,
  is_active     boolean NOT NULL DEFAULT false,
  UNIQUE (country_code, name)
);

-- Communes, quartiers, sous-quartiers : hiérarchie libre via parent_id
CREATE TABLE zones (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id       uuid NOT NULL REFERENCES cities(id),
  parent_id     uuid REFERENCES zones(id),
  kind          text NOT NULL CHECK (kind IN ('COMMUNE','QUARTIER','SECTEUR')),
  name          text NOT NULL,
  boundary      geography(MultiPolygon,4326),     -- facultatif tant que les contours ne sont pas saisis
  centroid      geography(Point,4326),
  is_active     boolean NOT NULL DEFAULT true,
  UNIQUE (city_id, parent_id, name)
);
CREATE INDEX zones_boundary_gix ON zones USING gist (boundary);

-- -----------------------------------------------------------------------------
-- Utilisateurs, rôles, permissions, sessions
-- -----------------------------------------------------------------------------
CREATE TABLE users (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164         text UNIQUE CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified_at  timestamptz,
  email              citext UNIQUE,
  first_name         text,
  last_name          text,
  avatar_file_id     uuid,                        -- FK ajoutée après la table files
  status             user_status NOT NULL DEFAULT 'ACTIVE',
  locale             text NOT NULL DEFAULT 'fr-CI',
  home_city_id       uuid REFERENCES cities(id),
  deletion_requested_at timestamptz,
  anonymized_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (phone_e164 IS NOT NULL OR email IS NOT NULL OR anonymized_at IS NOT NULL)
);

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,   -- CLIENT, PRO, ADMIN_SUPER, ADMIN_OPS, ADMIN_FINANCE, ADMIN_SUPPORT, ADMIN_MODERATION
  label       text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false
);
CREATE TABLE permissions (
  code        text PRIMARY KEY,       -- ex. 'pro.verify', 'refund.approve', 'settings.write'
  description text NOT NULL
);
CREATE TABLE role_permissions (
  role_id          uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code  text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);
CREATE TABLE user_roles (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id     uuid NOT NULL REFERENCES roles(id),
  granted_by  uuid REFERENCES users(id),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id)
);

-- Mots de passe : uniquement pour les comptes d'administration (argon2id).
CREATE TABLE admin_credentials (
  user_id            uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash      text NOT NULL,               -- argon2id, jamais en clair
  totp_secret_enc    bytea,                       -- chiffré (clé applicative hors base)
  totp_enabled_at    timestamptz,
  failed_attempts    int NOT NULL DEFAULT 0,
  locked_until       timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE otp_challenges (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164    text NOT NULL,
  purpose       text NOT NULL CHECK (purpose IN ('LOGIN','PHONE_CHANGE','ACCOUNT_DELETION')),
  code_hash     text,                             -- null si le fournisseur gère le code (ex. Verify API)
  provider      text NOT NULL,                    -- 'twilio_verify', 'dev_console', ...
  provider_ref  text,
  attempts      int NOT NULL DEFAULT 0,
  max_attempts  int NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  ip            inet,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX otp_phone_created_idx ON otp_challenges (phone_e164, created_at DESC);

CREATE TABLE sessions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app                app_kind NOT NULL,
  refresh_token_hash text NOT NULL UNIQUE,        -- SHA-256 du jeton opaque, rotation à chaque usage
  family_id          uuid NOT NULL,               -- détection de réutilisation => révocation de la famille
  device_label       text,
  ip                 inet,
  user_agent         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz NOT NULL DEFAULT now(),
  expires_at         timestamptz NOT NULL,
  revoked_at         timestamptz,
  revoked_reason     text
);
CREATE INDEX sessions_user_idx ON sessions (user_id) WHERE revoked_at IS NULL;

CREATE TABLE devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app           app_kind NOT NULL,
  platform      text NOT NULL CHECK (platform IN ('ANDROID','IOS','WEB')),
  push_token    text NOT NULL UNIQUE,
  app_version   text,
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  disabled_at   timestamptz
);

-- -----------------------------------------------------------------------------
-- Fichiers (stockage objet S3-compatible ; la base ne garde que les métadonnées)
-- -----------------------------------------------------------------------------
CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose        text NOT NULL CHECK (purpose IN ('AVATAR','REQUEST_PHOTO','REQUEST_VOICE','VERIFICATION_DOC','MESSAGE_PHOTO','MISSION_REPORT','CATEGORY_ICON')),
  visibility     file_visibility NOT NULL DEFAULT 'PRIVATE',
  bucket         text NOT NULL,
  object_key     text NOT NULL,
  mime_type      text NOT NULL,
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 26214400),
  sha256         text,
  status         file_status NOT NULL DEFAULT 'PENDING_UPLOAD',
  created_at     timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz,
  UNIQUE (bucket, object_key)
);
ALTER TABLE users ADD CONSTRAINT users_avatar_fk FOREIGN KEY (avatar_file_id) REFERENCES files(id) ON DELETE SET NULL;

CREATE TABLE addresses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label         text,                              -- "Maison", "Bureau"
  city_id       uuid NOT NULL REFERENCES cities(id),
  zone_id       uuid REFERENCES zones(id),         -- commune / quartier
  location      geography(Point,4326) NOT NULL,    -- point choisi / déplacé sur la carte
  street        text,                              -- facultatif : beaucoup d'adresses n'ont pas de numéro
  landmark      text,                              -- repère : "derrière la pharmacie X"
  instructions  text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX addresses_user_idx ON addresses (user_id) WHERE deleted_at IS NULL;

-- -----------------------------------------------------------------------------
-- Catalogue : catégories, sous-catégories, prestations, compétences
-- -----------------------------------------------------------------------------
CREATE TABLE categories (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id     uuid REFERENCES categories(id),    -- null = catégorie ; sinon sous-catégorie
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  description   text,
  search_terms  text[] NOT NULL DEFAULT '{}',      -- synonymes : "fuite", "robinet", "WC"...
  icon_key      text NOT NULL,
  sort_order    int NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE services (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id           uuid NOT NULL REFERENCES categories(id),
  slug                  text NOT NULL UNIQUE,
  name                  text NOT NULL,              -- "Débouchage d'évier"
  description           text,
  pricing_model         pricing_model NOT NULL,
  reference_min_xof     bigint CHECK (reference_min_xof >= 0),
  reference_max_xof     bigint CHECK (reference_max_xof >= 0),
  fixed_price_xof       bigint CHECK (fixed_price_xof > 0),
  default_travel_fee_xof bigint CHECK (default_travel_fee_xof >= 0),
  is_active             boolean NOT NULL DEFAULT true,
  CHECK (reference_max_xof IS NULL OR reference_min_xof IS NULL OR reference_max_xof >= reference_min_xof),
  CHECK (pricing_model <> 'FIXED' OR fixed_price_xof IS NOT NULL)
);

-- Tarifs de référence par ville (surcharge des valeurs de la prestation)
CREATE TABLE reference_prices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id    uuid NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  city_id       uuid NOT NULL REFERENCES cities(id),
  min_xof       bigint NOT NULL CHECK (min_xof >= 0),
  max_xof       bigint NOT NULL CHECK (max_xof >= min_xof),
  travel_fee_xof bigint CHECK (travel_fee_xof >= 0),
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  UNIQUE (service_id, city_id, valid_from)
);

CREATE TABLE skills (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id  uuid NOT NULL REFERENCES categories(id),
  name         text NOT NULL,
  UNIQUE (category_id, name)
);

-- -----------------------------------------------------------------------------
-- Règles d'attribution et paramètres (modifiables sans redéploiement)
-- -----------------------------------------------------------------------------
CREATE TABLE dispatch_rules (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_id                  uuid REFERENCES cities(id),      -- null = toutes villes
  category_id              uuid REFERENCES categories(id),  -- null = règle par défaut
  service_id               uuid REFERENCES services(id),
  mode                     request_mode NOT NULL,
  strategy                 dispatch_strategy NOT NULL,
  initial_radius_m         int NOT NULL CHECK (initial_radius_m BETWEEN 500 AND 100000),
  radius_step_m            int NOT NULL CHECK (radius_step_m > 0),
  max_radius_m             int NOT NULL,
  pros_per_wave            int NOT NULL CHECK (pros_per_wave BETWEEN 1 AND 50),
  wave_interval_s          int NOT NULL CHECK (wave_interval_s >= 15),
  offer_ttl_s              int NOT NULL CHECK (offer_ttl_s >= 15),
  reservation_ttl_s        int NOT NULL CHECK (reservation_ttl_s >= 30),
  client_confirm_ttl_s     int NOT NULL CHECK (client_confirm_ttl_s >= 30),
  max_offers_shown         int NOT NULL DEFAULT 5,
  is_active                boolean NOT NULL DEFAULT true,
  updated_by               uuid REFERENCES users(id),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CHECK (max_radius_m >= initial_radius_m)
);
CREATE UNIQUE INDEX dispatch_rules_scope_uq ON dispatch_rules
  (COALESCE(city_id,'00000000-0000-0000-0000-000000000000'),
   COALESCE(category_id,'00000000-0000-0000-0000-000000000000'),
   COALESCE(service_id,'00000000-0000-0000-0000-000000000000'), mode)
  WHERE is_active;

CREATE TABLE commission_rules (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id   uuid REFERENCES categories(id),    -- null = défaut
  rate_bps      int NOT NULL CHECK (rate_bps BETWEEN 0 AND 5000),  -- points de base : 1000 = 10 %
  min_xof       bigint NOT NULL DEFAULT 0 CHECK (min_xof >= 0),
  applies_to_travel_fee boolean NOT NULL DEFAULT false,
  valid_from    timestamptz NOT NULL DEFAULT now(),
  valid_to      timestamptz,
  created_by    uuid REFERENCES users(id)
);

CREATE TABLE settings (
  key         text PRIMARY KEY,                     -- ex. 'mission.auto_close_hours'
  value       jsonb NOT NULL,
  description text,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- Professionnels
-- -----------------------------------------------------------------------------
CREATE TABLE pro_profiles (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind                 pro_kind NOT NULL DEFAULT 'INDIVIDUAL',
  business_name        text NOT NULL,
  company_reg_number   text,                         -- RCCM si entreprise
  bio                  text,
  years_experience     smallint CHECK (years_experience BETWEEN 0 AND 70),
  city_id              uuid NOT NULL REFERENCES cities(id),
  base_location        geography(Point,4326),        -- point de départ habituel
  service_radius_m     int NOT NULL DEFAULT 10000 CHECK (service_radius_m BETWEEN 500 AND 100000),
  verification_status  verification_status NOT NULL DEFAULT 'DRAFT',
  verified_at          timestamptz,                  -- non nul uniquement après validation réelle
  verified_by          uuid REFERENCES users(id),
  is_online            boolean NOT NULL DEFAULT false, -- "Disponible maintenant"
  paused_until         timestamptz,                  -- suspension temporaire choisie par le pro
  last_location        geography(Point,4326),        -- dernière position connue (écrasée, pas d'historique)
  last_location_at     timestamptz,
  indicative_price_xof bigint CHECK (indicative_price_xof >= 0),
  rating_avg           numeric(3,2) NOT NULL DEFAULT 0,
  rating_count         int NOT NULL DEFAULT 0,
  missions_completed   int NOT NULL DEFAULT 0,
  offers_received      int NOT NULL DEFAULT 0,
  offers_accepted      int NOT NULL DEFAULT 0,
  cancellations_by_pro int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK ((verification_status = 'APPROVED') = (verified_at IS NOT NULL) OR verification_status = 'SUSPENDED')
);
CREATE INDEX pro_last_location_gix ON pro_profiles USING gist (last_location);
CREATE INDEX pro_base_location_gix ON pro_profiles USING gist (base_location);
CREATE INDEX pro_dispatchable_idx ON pro_profiles (city_id) WHERE verification_status = 'APPROVED';

CREATE TABLE pro_categories (
  pro_id       uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  category_id  uuid NOT NULL REFERENCES categories(id),
  accepts_urgent    boolean NOT NULL DEFAULT true,
  accepts_scheduled boolean NOT NULL DEFAULT true,
  PRIMARY KEY (pro_id, category_id)
);
CREATE INDEX pro_categories_cat_idx ON pro_categories (category_id);

CREATE TABLE pro_skills (
  pro_id    uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  skill_id  uuid NOT NULL REFERENCES skills(id),
  PRIMARY KEY (pro_id, skill_id)
);

CREATE TABLE pro_service_zones (
  pro_id   uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  zone_id  uuid NOT NULL REFERENCES zones(id),
  PRIMARY KEY (pro_id, zone_id)
);

-- Horaires hebdomadaires (heure locale de la ville du pro)
CREATE TABLE pro_weekly_hours (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id      uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  weekday     smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO : 1 = lundi
  start_time  time NOT NULL,
  end_time    time NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX pro_weekly_hours_idx ON pro_weekly_hours (pro_id, weekday);

-- Indisponibilités ponctuelles (congés, rendez-vous pris ailleurs)
CREATE TABLE pro_time_off (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id     uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  period     tstzrange NOT NULL,
  reason     text
);
CREATE INDEX pro_time_off_gix ON pro_time_off USING gist (period);

CREATE TABLE verification_document_types (
  code          text PRIMARY KEY,                  -- 'CNI', 'PASSEPORT', 'RCCM', 'CASIER', 'DIPLOME'
  label         text NOT NULL,
  required_for  pro_kind[] NOT NULL DEFAULT '{}',
  is_active     boolean NOT NULL DEFAULT true
);

CREATE TABLE verification_documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id           uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  type_code        text NOT NULL REFERENCES verification_document_types(code),
  file_id          uuid NOT NULL REFERENCES files(id),     -- fichier PRIVATE obligatoirement
  status           document_status NOT NULL DEFAULT 'PENDING',
  expires_on       date,
  reviewed_by      uuid REFERENCES users(id),
  reviewed_at      timestamptz,
  rejection_reason text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_documents_pro_idx ON verification_documents (pro_id);

CREATE TABLE pro_verification_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id      uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  from_status verification_status,
  to_status   verification_status NOT NULL,
  actor_id    uuid REFERENCES users(id),
  note        text,                                 -- message visible du pro en cas de complément demandé
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payout_accounts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id          uuid NOT NULL REFERENCES pro_profiles(user_id) ON DELETE CASCADE,
  method          payout_method NOT NULL,
  account_ref_enc bytea NOT NULL,                   -- numéro Mobile Money / IBAN chiffré
  account_last4   text NOT NULL,
  holder_name     text NOT NULL,
  is_default      boolean NOT NULL DEFAULT false,
  verified_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  disabled_at     timestamptz
);
CREATE UNIQUE INDEX payout_accounts_default_uq ON payout_accounts (pro_id) WHERE is_default AND disabled_at IS NULL;

-- -----------------------------------------------------------------------------
-- Demandes et propositions
-- -----------------------------------------------------------------------------
CREATE TABLE service_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id               uuid NOT NULL REFERENCES users(id),
  city_id                 uuid NOT NULL REFERENCES cities(id),
  category_id             uuid NOT NULL REFERENCES categories(id),
  service_id              uuid REFERENCES services(id),
  pricing_model           pricing_model NOT NULL,       -- figé à la publication
  mode                    request_mode NOT NULL,
  status                  request_status NOT NULL DEFAULT 'DRAFT',
  description             text NOT NULL CHECK (length(description) BETWEEN 10 AND 2000),
  location                geography(Point,4326) NOT NULL,
  zone_id                 uuid REFERENCES zones(id),
  address_id              uuid REFERENCES addresses(id),
  address_snapshot        jsonb NOT NULL,               -- copie figée (rue, repère, indications)
  desired_window          tstzrange,                    -- créneau souhaité (obligatoire en mode programmé)
  budget_xof              bigint CHECK (budget_xof > 0),
  current_radius_m        int,
  current_wave            smallint NOT NULL DEFAULT 0,
  reserved_pro_id         uuid REFERENCES pro_profiles(user_id),
  reservation_expires_at  timestamptz,
  published_at            timestamptz,
  matching_deadline_at    timestamptz,
  cancelled_at            timestamptz,
  cancel_reason           text,
  version                 int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (mode <> 'SCHEDULED' OR status = 'DRAFT' OR desired_window IS NOT NULL),
  CHECK ((status = 'PROVISIONALLY_RESERVED' OR status = 'AWAITING_CLIENT_CONFIRMATION') = (reserved_pro_id IS NOT NULL)
         OR status = 'ASSIGNED')
);
CREATE INDEX service_requests_client_idx ON service_requests (client_id, created_at DESC);
CREATE INDEX service_requests_open_idx ON service_requests (status, reservation_expires_at)
  WHERE status IN ('PUBLISHED','MATCHING','OFFERS_RECEIVED','PROVISIONALLY_RESERVED','AWAITING_CLIENT_CONFIRMATION');
CREATE INDEX service_requests_location_gix ON service_requests USING gist (location);

CREATE TABLE request_media (
  request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  file_id     uuid NOT NULL REFERENCES files(id),
  kind        text NOT NULL CHECK (kind IN ('PHOTO','VOICE')),
  position    smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (request_id, file_id)
);

CREATE TABLE request_status_history (
  id          bigserial PRIMARY KEY,
  request_id  uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  from_status request_status,
  to_status   request_status NOT NULL,
  actor_id    uuid REFERENCES users(id),             -- null = système
  reason      text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX request_status_history_idx ON request_status_history (request_id, created_at);

-- Une proposition = une alerte envoyée à un pro pour une demande + sa réponse
CREATE TABLE request_offers (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES service_requests(id) ON DELETE CASCADE,
  pro_id               uuid NOT NULL REFERENCES pro_profiles(user_id),
  wave                 smallint NOT NULL,
  status               offer_status NOT NULL DEFAULT 'SENT',
  distance_m           int NOT NULL,                 -- distance à vol d'oiseau, affichée comme "environ"
  eta_s                int,                          -- estimation routière si fournisseur disponible
  proposed_price_xof   bigint CHECK (proposed_price_xof > 0),
  proposed_travel_fee_xof bigint CHECK (proposed_travel_fee_xof >= 0),
  proposed_start_at    timestamptz,
  message              text CHECK (length(message) <= 500),
  decline_reason       text,
  sent_at              timestamptz NOT NULL DEFAULT now(),
  seen_at              timestamptz,
  responded_at         timestamptz,
  expires_at           timestamptz NOT NULL,
  UNIQUE (request_id, pro_id)
);
CREATE INDEX request_offers_pro_idx ON request_offers (pro_id, status);
CREATE INDEX request_offers_expiry_idx ON request_offers (expires_at) WHERE status IN ('SENT','SEEN');
-- Une seule proposition retenue par demande
CREATE UNIQUE INDEX request_offers_one_selected_uq ON request_offers (request_id) WHERE status = 'SELECTED';

-- -----------------------------------------------------------------------------
-- Missions
-- -----------------------------------------------------------------------------
CREATE TABLE missions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference         text NOT NULL UNIQUE,              -- ex. 'IN-2026-000123', lisible par le support
  request_id        uuid NOT NULL REFERENCES service_requests(id),
  offer_id          uuid REFERENCES request_offers(id),
  client_id         uuid NOT NULL REFERENCES users(id),
  pro_id            uuid NOT NULL REFERENCES pro_profiles(user_id),
  pricing_model     pricing_model NOT NULL,
  status            mission_status NOT NULL,
  scheduled_start_at timestamptz,
  confirmed_at      timestamptz,
  en_route_at       timestamptz,
  arrived_at        timestamptz,
  started_at        timestamptz,
  work_completed_at timestamptz,
  closed_at         timestamptz,
  auto_close_at     timestamptz,                       -- clôture automatique si le client ne répond pas
  cancelled_at      timestamptz,
  cancelled_by      uuid REFERENCES users(id),
  cancel_reason     text,
  disputed_at       timestamptz,
  version           int NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (client_id <> pro_id)
);
-- GARANTIE CENTRALE : au plus une mission non annulée par demande.
CREATE UNIQUE INDEX missions_one_active_per_request_uq ON missions (request_id) WHERE status <> 'CANCELLED';
CREATE INDEX missions_client_idx ON missions (client_id, created_at DESC);
CREATE INDEX missions_pro_idx ON missions (pro_id, status);
CREATE INDEX missions_autoclose_idx ON missions (auto_close_at) WHERE status = 'WORK_COMPLETED';

CREATE TABLE mission_status_history (
  id          bigserial PRIMARY KEY,
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  from_status mission_status,
  to_status   mission_status NOT NULL,
  actor_id    uuid REFERENCES users(id),
  reason      text,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mission_status_history_idx ON mission_status_history (mission_id, created_at);

CREATE TABLE mission_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id  uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  author_id   uuid NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) <= 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE mission_report_files (
  report_id  uuid NOT NULL REFERENCES mission_reports(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES files(id),
  PRIMARY KEY (report_id, file_id)
);

-- Positions pendant le trajet uniquement (EN_ROUTE -> ARRIVED).
-- Conservation : purge automatique N jours après clôture (paramètre, 30 j par défaut).
CREATE TABLE location_pings (
  id           bigserial PRIMARY KEY,
  mission_id   uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id),
  location     geography(Point,4326) NOT NULL,
  accuracy_m   real CHECK (accuracy_m >= 0),
  recorded_at  timestamptz NOT NULL,                   -- horodatage appareil
  received_at  timestamptz NOT NULL DEFAULT now(),     -- horodatage serveur (fait foi)
  is_suspicious boolean NOT NULL DEFAULT false         -- vitesse impossible, précision aberrante...
);
CREATE INDEX location_pings_mission_idx ON location_pings (mission_id, received_at DESC);

-- -----------------------------------------------------------------------------
-- Devis (chaque modification = nouvelle version)
-- -----------------------------------------------------------------------------
CREATE TABLE quotes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id     uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  version        int NOT NULL CHECK (version >= 1),
  kind           quote_kind NOT NULL DEFAULT 'INITIAL',
  supersedes_id  uuid REFERENCES quotes(id),
  status         quote_status NOT NULL DEFAULT 'DRAFT',
  total_xof      bigint NOT NULL CHECK (total_xof >= 0),  -- = somme des lignes, vérifié par trigger
  valid_until    timestamptz NOT NULL,
  conditions     text CHECK (length(conditions) <= 2000),
  estimated_duration_min int CHECK (estimated_duration_min > 0),
  created_by     uuid NOT NULL REFERENCES users(id),
  submitted_at   timestamptz,
  decided_at     timestamptz,
  decided_by     uuid REFERENCES users(id),
  rejection_reason text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mission_id, version)
);
-- Un seul devis en attente de décision à la fois par mission
CREATE UNIQUE INDEX quotes_one_pending_uq ON quotes (mission_id) WHERE status = 'SUBMITTED';

CREATE TABLE quote_lines (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id       uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  kind           quote_line_kind NOT NULL,
  label          text NOT NULL,
  quantity       int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price_xof bigint NOT NULL CHECK (unit_price_xof >= 0),
  amount_xof     bigint GENERATED ALWAYS AS (quantity * unit_price_xof) STORED,
  justification  text,
  position       smallint NOT NULL DEFAULT 0
);
CREATE INDEX quote_lines_quote_idx ON quote_lines (quote_id);

-- Un devis soumis est immuable ; son total doit égaler la somme des lignes.
CREATE FUNCTION quotes_check_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  IF NEW.status <> 'DRAFT' THEN
    SELECT COALESCE(sum(amount_xof),0) INTO s FROM quote_lines WHERE quote_id = NEW.id;
    IF s <> NEW.total_xof THEN
      RAISE EXCEPTION 'quote % total % <> sum of lines %', NEW.id, NEW.total_xof, s;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER quotes_total_trg AFTER INSERT OR UPDATE ON quotes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION quotes_check_total();

CREATE FUNCTION quote_lines_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st quote_status;
BEGIN
  SELECT status INTO st FROM quotes WHERE id = COALESCE(NEW.quote_id, OLD.quote_id);
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'quote lines are immutable once the quote is submitted';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER quote_lines_immutable_trg BEFORE INSERT OR UPDATE OR DELETE ON quote_lines
  FOR EACH ROW EXECUTE FUNCTION quote_lines_immutable();

-- -----------------------------------------------------------------------------
-- Promotions
-- -----------------------------------------------------------------------------
CREATE TABLE promotions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code             citext NOT NULL UNIQUE,
  description      text NOT NULL,
  kind             discount_kind NOT NULL,
  value            int NOT NULL CHECK (value > 0),       -- % (1-100) ou XOF
  max_discount_xof bigint CHECK (max_discount_xof > 0),
  min_order_xof    bigint NOT NULL DEFAULT 0,
  category_id      uuid REFERENCES categories(id),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  max_redemptions  int,
  per_user_limit   int NOT NULL DEFAULT 1,
  is_active        boolean NOT NULL DEFAULT true,
  created_by       uuid REFERENCES users(id),
  CHECK (ends_at > starts_at),
  CHECK (kind <> 'PERCENT' OR value <= 100)
);

-- -----------------------------------------------------------------------------
-- Paiements, remboursements, commissions, reversements
-- -----------------------------------------------------------------------------
CREATE TABLE payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id          uuid NOT NULL REFERENCES missions(id),
  quote_id            uuid REFERENCES quotes(id),
  payer_id            uuid NOT NULL REFERENCES users(id),
  purpose             payment_purpose NOT NULL,
  gross_amount_xof    bigint NOT NULL CHECK (gross_amount_xof > 0),
  discount_xof        bigint NOT NULL DEFAULT 0 CHECK (discount_xof >= 0),
  amount_xof          bigint NOT NULL CHECK (amount_xof > 0),   -- montant réellement demandé au client
  currency            char(3) NOT NULL DEFAULT 'XOF' CHECK (currency = 'XOF'),
  promotion_id        uuid REFERENCES promotions(id),
  provider            text NOT NULL,                  -- 'cinetpay', 'wave', 'sandbox' (dev uniquement)
  is_sandbox          boolean NOT NULL,               -- jamais vrai en production (contrôle applicatif + config)
  merchant_reference  text NOT NULL UNIQUE,           -- référence unique Ineed envoyée au prestataire
  provider_txn_id     text,
  method              text,                           -- 'ORANGE_MONEY', 'MTN_MOMO', 'WAVE', 'CARD'...
  status              payment_status NOT NULL DEFAULT 'INITIATED',
  checkout_url        text,
  failure_code        text,
  failure_message     text,
  idempotency_key     text NOT NULL,
  initiated_at        timestamptz NOT NULL DEFAULT now(),
  confirmed_at        timestamptz,                    -- uniquement après vérification serveur-à-serveur
  expires_at          timestamptz,
  last_verified_at    timestamptz,
  version             int NOT NULL DEFAULT 0,
  CHECK (amount_xof = gross_amount_xof - discount_xof),
  CHECK (status <> 'SUCCEEDED' OR confirmed_at IS NOT NULL),
  UNIQUE (payer_id, idempotency_key),
  UNIQUE (provider, provider_txn_id)
);
CREATE INDEX payments_mission_idx ON payments (mission_id);
CREATE INDEX payments_pending_idx ON payments (status, initiated_at) WHERE status IN ('INITIATED','PENDING');
-- Un seul paiement réussi par (mission, devis, objet)
CREATE UNIQUE INDEX payments_one_success_uq ON payments
  (mission_id, COALESCE(quote_id,'00000000-0000-0000-0000-000000000000'), purpose) WHERE status = 'SUCCEEDED';

CREATE TABLE promotion_redemptions (
  promotion_id  uuid NOT NULL REFERENCES promotions(id),
  user_id       uuid NOT NULL REFERENCES users(id),
  payment_id    uuid NOT NULL UNIQUE REFERENCES payments(id),
  discount_xof  bigint NOT NULL CHECK (discount_xof > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (promotion_id, payment_id)
);

-- Journal brut des notifications du prestataire (webhooks) : dédoublonnage
CREATE TABLE payment_provider_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider           text NOT NULL,
  provider_event_id  text NOT NULL,                  -- ou hash(payload) si le prestataire n'en fournit pas
  payment_id         uuid REFERENCES payments(id),
  payload            jsonb NOT NULL,
  signature_valid    boolean NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  processing_error   text,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE refunds (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id         uuid NOT NULL REFERENCES payments(id),
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  reason             text NOT NULL,
  status             refund_status NOT NULL DEFAULT 'REQUESTED',
  provider_refund_id text,
  requested_by       uuid REFERENCES users(id),
  approved_by        uuid REFERENCES users(id),
  idempotency_key    text NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now(),
  completed_at       timestamptz,
  failure_message    text
);
CREATE INDEX refunds_payment_idx ON refunds (payment_id);

-- Le total remboursé (hors échecs/rejets) ne peut dépasser le montant payé.
CREATE FUNCTION refunds_check_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid bigint; refunded bigint;
BEGIN
  SELECT amount_xof INTO paid FROM payments WHERE id = NEW.payment_id AND status = 'SUCCEEDED' FOR UPDATE;
  IF paid IS NULL THEN RAISE EXCEPTION 'refund on non-succeeded payment'; END IF;
  SELECT COALESCE(sum(amount_xof),0) INTO refunded FROM refunds
   WHERE payment_id = NEW.payment_id AND status NOT IN ('FAILED','REJECTED') AND id <> NEW.id;
  IF NEW.status NOT IN ('FAILED','REJECTED') AND refunded + NEW.amount_xof > paid THEN
    RAISE EXCEPTION 'refund cap exceeded: % + % > %', refunded, NEW.amount_xof, paid;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER refunds_cap_trg BEFORE INSERT OR UPDATE OF amount_xof, status ON refunds
  FOR EACH ROW EXECUTE FUNCTION refunds_check_cap();

CREATE TABLE commissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES missions(id),
  payment_id    uuid NOT NULL UNIQUE REFERENCES payments(id),
  rule_id       uuid REFERENCES commission_rules(id),
  base_xof      bigint NOT NULL CHECK (base_xof >= 0),
  rate_bps      int NOT NULL,
  amount_xof    bigint NOT NULL CHECK (amount_xof >= 0 AND amount_xof <= base_xof),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pro_id             uuid NOT NULL REFERENCES pro_profiles(user_id),
  payout_account_id  uuid NOT NULL REFERENCES payout_accounts(id),
  amount_xof         bigint NOT NULL CHECK (amount_xof > 0),
  status             payout_status NOT NULL DEFAULT 'PENDING',
  provider           text,
  provider_ref       text,
  idempotency_key    text NOT NULL UNIQUE,
  approved_by        uuid REFERENCES users(id),
  approved_at        timestamptz,
  paid_at            timestamptz,
  failure_message    text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE payout_items (
  payout_id   uuid NOT NULL REFERENCES payouts(id) ON DELETE CASCADE,
  mission_id  uuid NOT NULL REFERENCES missions(id),
  amount_xof  bigint NOT NULL CHECK (amount_xof > 0),
  PRIMARY KEY (payout_id, mission_id)
);

-- Grand livre en partie double : base du rapprochement et des soldes dus.
-- Comptes : CLIENT_FUNDS_IN, PRO_PAYABLE:<pro>, INEED_REVENUE, REFUNDS, PAYOUTS_SENT, PROVIDER_FEES
CREATE TABLE ledger_transactions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('PAYMENT_CAPTURED','COMMISSION','REFUND','PAYOUT','ADJUSTMENT','PROVIDER_FEE')),
  payment_id   uuid REFERENCES payments(id),
  refund_id    uuid REFERENCES refunds(id),
  payout_id    uuid REFERENCES payouts(id),
  mission_id   uuid REFERENCES missions(id),
  description  text,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE ledger_entries (
  id              bigserial PRIMARY KEY,
  transaction_id  uuid NOT NULL REFERENCES ledger_transactions(id),
  account         text NOT NULL,
  pro_id          uuid REFERENCES pro_profiles(user_id),
  amount_xof      bigint NOT NULL CHECK (amount_xof <> 0),   -- >0 débit, <0 crédit
  CHECK ((account = 'PRO_PAYABLE') = (pro_id IS NOT NULL))
);
CREATE INDEX ledger_entries_pro_idx ON ledger_entries (pro_id) WHERE pro_id IS NOT NULL;

CREATE FUNCTION ledger_check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s bigint;
BEGIN
  SELECT COALESCE(sum(amount_xof),0) INTO s FROM ledger_entries WHERE transaction_id = NEW.transaction_id;
  IF s <> 0 THEN RAISE EXCEPTION 'ledger transaction % unbalanced (%)', NEW.transaction_id, s; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced_trg AFTER INSERT OR UPDATE ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_check_balanced();

-- Écritures comptables : ajout uniquement
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END $$;
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- -----------------------------------------------------------------------------
-- Idempotence des requêtes API sensibles
-- -----------------------------------------------------------------------------
CREATE TABLE idempotency_keys (
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key            text NOT NULL CHECK (length(key) BETWEEN 8 AND 128),
  method         text NOT NULL,
  path           text NOT NULL,
  request_hash   text NOT NULL,                  -- même clé + corps différent => 422
  status_code    int,
  response_body  jsonb,
  locked_until   timestamptz,                    -- requête en cours => 409
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

-- -----------------------------------------------------------------------------
-- Messagerie
-- -----------------------------------------------------------------------------
CREATE TABLE conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES service_requests(id),
  client_id   uuid NOT NULL REFERENCES users(id),
  pro_id      uuid NOT NULL REFERENCES pro_profiles(user_id),
  mission_id  uuid REFERENCES missions(id),
  is_locked   boolean NOT NULL DEFAULT false,    -- lecture seule après clôture + délai
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, pro_id)
);
CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id),
  body             text CHECK (length(body) <= 2000),
  file_id          uuid REFERENCES files(id),
  client_msg_id    text NOT NULL,                 -- dédoublonnage des renvois après perte réseau
  created_at       timestamptz NOT NULL DEFAULT now(),
  hidden_at        timestamptz,                   -- masqué par la modération
  CHECK (body IS NOT NULL OR file_id IS NOT NULL),
  UNIQUE (sender_id, client_msg_id)
);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);
CREATE TABLE conversation_reads (
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at     timestamptz NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);

-- -----------------------------------------------------------------------------
-- Notifications
-- -----------------------------------------------------------------------------
CREATE TABLE notification_templates (
  type        text NOT NULL,                     -- 'OFFER_RECEIVED', 'PAYMENT_CONFIRMED', ...
  channel     text NOT NULL CHECK (channel IN ('PUSH','SMS','IN_APP')),
  locale      text NOT NULL DEFAULT 'fr-CI',
  title       text NOT NULL,
  body        text NOT NULL,                     -- gabarit avec variables {{mission.reference}}
  is_active   boolean NOT NULL DEFAULT true,
  updated_by  uuid REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (type, channel, locale)
);
CREATE TABLE notifications (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  title        text NOT NULL,
  body         text NOT NULL,
  data         jsonb NOT NULL DEFAULT '{}',      -- liens profonds : {"missionId": "..."}
  dedupe_key   text,                             -- évite les doublons lors des reprises de tâches
  status       notification_status NOT NULL DEFAULT 'QUEUED',
  attempts     int NOT NULL DEFAULT 0,
  sent_at      timestamptz,
  read_at      timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;

-- -----------------------------------------------------------------------------
-- Avis, réclamations, signalements
-- -----------------------------------------------------------------------------
CREATE TABLE reviews (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL UNIQUE REFERENCES missions(id),
  client_id     uuid NOT NULL REFERENCES users(id),
  pro_id        uuid NOT NULL REFERENCES pro_profiles(user_id),
  rating        smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment       text CHECK (length(comment) <= 1000),
  status        review_status NOT NULL DEFAULT 'PUBLISHED',
  pro_reply     text CHECK (length(pro_reply) <= 1000),
  moderated_by  uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX reviews_pro_idx ON reviews (pro_id, created_at DESC) WHERE status = 'PUBLISHED';

-- Seule une mission clôturée, du bon client et du bon pro, peut recevoir un avis.
CREATE FUNCTION reviews_check_eligibility() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m missions%ROWTYPE;
BEGIN
  SELECT * INTO m FROM missions WHERE id = NEW.mission_id;
  IF m.status <> 'CLOSED' OR m.client_id <> NEW.client_id OR m.pro_id <> NEW.pro_id THEN
    RAISE EXCEPTION 'review not allowed for mission %', NEW.mission_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviews_eligibility_trg BEFORE INSERT ON reviews
  FOR EACH ROW EXECUTE FUNCTION reviews_check_eligibility();

CREATE TABLE complaints (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference      text NOT NULL UNIQUE,
  mission_id     uuid REFERENCES missions(id),
  opened_by      uuid NOT NULL REFERENCES users(id),
  category       text NOT NULL CHECK (category IN ('QUALITY','PRICE','NO_SHOW','DAMAGE','PAYMENT','BEHAVIOUR','OTHER')),
  description    text NOT NULL CHECK (length(description) <= 4000),
  status         complaint_status NOT NULL DEFAULT 'OPEN',
  assigned_to    uuid REFERENCES users(id),
  resolution     text,
  refund_id      uuid REFERENCES refunds(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE TABLE complaint_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  complaint_id  uuid NOT NULL REFERENCES complaints(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES users(id),
  body          text NOT NULL,
  is_internal   boolean NOT NULL DEFAULT false,   -- note interne du support, invisible de l'utilisateur
  file_id       uuid REFERENCES files(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE abuse_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   uuid NOT NULL REFERENCES users(id),
  target_type   report_target NOT NULL,
  target_id     uuid NOT NULL,
  reason        text NOT NULL CHECK (reason IN ('SPAM','HARASSMENT','FRAUD','OFF_PLATFORM_PAYMENT','INAPPROPRIATE','OTHER')),
  details       text,
  status        report_status NOT NULL DEFAULT 'OPEN',
  handled_by    uuid REFERENCES users(id),
  handled_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);

CREATE TABLE search_history (
  id           bigserial PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  query        text,
  category_id  uuid REFERENCES categories(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX search_history_user_idx ON search_history (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- Journal d'audit (ajout uniquement)
-- -----------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id            bigserial PRIMARY KEY,
  actor_id      uuid REFERENCES users(id),
  actor_roles   text[] NOT NULL DEFAULT '{}',
  action        text NOT NULL,                    -- 'pro.approve', 'refund.approve', 'settings.update'
  entity_type   text NOT NULL,
  entity_id     text,
  before        jsonb,
  after         jsonb,
  ip            inet,
  user_agent    text,
  request_id    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);
CREATE INDEX audit_logs_actor_idx ON audit_logs (actor_id, created_at DESC);
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
