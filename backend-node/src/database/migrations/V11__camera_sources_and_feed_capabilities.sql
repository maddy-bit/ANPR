-- V11: camera source registry, feed capabilities and investigation search scope.
-- Additive only. Existing camera and detection records remain intact.

CREATE TABLE IF NOT EXISTS camera_sources (
  id UUID PRIMARY KEY,
  source_key VARCHAR(100) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('PUBLIC_CATALOG', 'GOVERNMENT_API')),
  adapter VARCHAR(32) NOT NULL CHECK (adapter IN ('GODSEYE_GEOJSON', 'GEOJSON', 'JSON_API')),
  endpoint_url TEXT NOT NULL,
  country_scope CHAR(2) NOT NULL DEFAULT 'IN',
  attribution TEXT,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  auth_type VARCHAR(24) NOT NULL DEFAULT 'NONE'
    CHECK (auth_type IN ('NONE', 'BEARER', 'API_KEY_HEADER', 'API_KEY_QUERY')),
  auth_secret_ciphertext TEXT,
  auth_header_name VARCHAR(100),
  auth_query_name VARCHAR(100),
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(24) NOT NULL DEFAULT 'NEVER',
  last_sync_error TEXT,
  imported_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE cameras
  ADD COLUMN IF NOT EXISTS source_network VARCHAR(120),
  ADD COLUMN IF NOT EXISTS source_id UUID REFERENCES camera_sources(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_camera_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS source_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS feed_type VARCHAR(32),
  ADD COLUMN IF NOT EXISTS stream_url TEXT,
  ADD COLUMN IF NOT EXISTS archive_url TEXT,
  ADD COLUMN IF NOT EXISTS page_url TEXT,
  ADD COLUMN IF NOT EXISTS attribution TEXT,
  ADD COLUMN IF NOT EXISTS country_code CHAR(2),
  ADD COLUMN IF NOT EXISTS region VARCHAR(160),
  ADD COLUMN IF NOT EXISTS place VARCHAR(160),
  ADD COLUMN IF NOT EXISTS live_video BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS live_snapshot BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS archive_available BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS external_player BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS source_status VARCHAR(32) NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS source_last_seen_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_cameras_source_external_id
  ON cameras (source_id, source_camera_id)
  WHERE source_id IS NOT NULL AND source_camera_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cameras_source_type ON cameras (source_type);
CREATE INDEX IF NOT EXISTS idx_cameras_feed_capabilities
  ON cameras (live_video, live_snapshot, archive_available, external_player);
CREATE INDEX IF NOT EXISTS idx_cameras_country ON cameras (country_code);
CREATE INDEX IF NOT EXISTS idx_cameras_source_network ON cameras (source_network);

ALTER TABLE investigations
  ADD COLUMN IF NOT EXISTS search_center_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS search_center_lon DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS search_radius_km DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS search_start_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS search_end_at TIMESTAMPTZ;

ALTER TABLE investigations
  ADD CONSTRAINT chk_investigation_search_radius
  CHECK (search_radius_km IS NULL OR (search_radius_km > 0 AND search_radius_km <= 100))
  NOT VALID;

ALTER TABLE investigations
  ADD CONSTRAINT chk_investigation_search_center_lat
  CHECK (search_center_lat IS NULL OR (search_center_lat BETWEEN -90 AND 90))
  NOT VALID;

ALTER TABLE investigations
  ADD CONSTRAINT chk_investigation_search_center_lon
  CHECK (search_center_lon IS NULL OR (search_center_lon BETWEEN -180 AND 180))
  NOT VALID;

ALTER TABLE investigations
  ADD CONSTRAINT chk_investigation_search_window
  CHECK (search_start_at IS NULL OR search_end_at IS NULL OR search_start_at <= search_end_at)
  NOT VALID;

INSERT INTO camera_sources (
  id, source_key, name, source_type, adapter, endpoint_url,
  country_scope, attribution, enabled, auth_type, config
) VALUES (
  'd11f7f8f-2c2c-4e11-9f7d-8ef1c0c4e261',
  'GODSEYE_PUBLIC',
  'God''s Eye public camera catalogue',
  'PUBLIC_CATALOG',
  'GODSEYE_GEOJSON',
  'https://raw.githubusercontent.com/Phaviwylera/godseye/main/data/cameras.geojson',
  'IN',
  'Camera attribution is retained from the original publishing agency.',
  TRUE,
  'NONE',
  '{"countryScope":"IN","archivePolicy":"metadata_only","refreshHours":24}'::jsonb
)
ON CONFLICT (source_key) DO UPDATE SET
  name = EXCLUDED.name,
  adapter = EXCLUDED.adapter,
  endpoint_url = EXCLUDED.endpoint_url,
  country_scope = EXCLUDED.country_scope,
  attribution = EXCLUDED.attribution,
  updated_at = NOW();
