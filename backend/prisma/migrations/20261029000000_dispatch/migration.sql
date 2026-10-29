-- Phase 6 : moteur d'attribution piloté par la base (reprise sans perte après un redémarrage).

-- Prochaine vague de recherche d'une demande en MATCHING (NULL : aucune vague prévue).
ALTER TABLE service_requests ADD COLUMN next_wave_at timestamptz;
CREATE INDEX service_requests_next_wave_idx ON service_requests (next_wave_at) WHERE status = 'MATCHING';
CREATE INDEX service_requests_published_idx ON service_requests (published_at) WHERE status = 'PUBLISHED';

-- Référence lisible des missions (« IN-2026-000123 »).
CREATE SEQUENCE mission_reference_seq START 1;

-- Recherche des positions de trajet par horodatage appareil (dédoublonnage après une coupure réseau).
CREATE UNIQUE INDEX location_pings_dedupe_uq ON location_pings (mission_id, user_id, recorded_at);
