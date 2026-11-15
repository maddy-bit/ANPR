-- Durable case-scoped tracking jobs. This migration only adds schema; it is
-- applied by the normal versioned migration runner and is never auto-executed
-- at application startup.

-- Record database ingestion time separately from the camera/source timestamp.
-- Existing rows remain NULL; their observation times are not rewritten.
ALTER TABLE vehicle_detections
  ADD COLUMN IF NOT EXISTS ingested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_vehicle_detections_live_watch
  ON vehicle_detections (plate_text_normalized, id)
  WHERE ingested_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS investigation_tracking_jobs (
  id UUID PRIMARY KEY,
  case_id VARCHAR(64) NOT NULL REFERENCES investigations(id) ON DELETE CASCADE,
  target_plate VARCHAR(50) NOT NULL,
  mode VARCHAR(10) NOT NULL CHECK (mode IN ('HISTORIC', 'LIVE', 'HYBRID')),
  status VARCHAR(32) NOT NULL CHECK (status IN (
    'QUEUED', 'RUNNING', 'WAITING_FOR_OBSERVATIONS', 'COMPLETED', 'FAILED', 'CANCELLED'
  )),
  request_key VARCHAR(128) NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  cursor_detection_id BIGINT NOT NULL DEFAULT 0,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_token UUID,
  lease_until TIMESTAMPTZ,
  error_code VARCHAR(64),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_investigation_tracking_request UNIQUE (case_id, request_key),
  CONSTRAINT chk_tracking_job_expiry CHECK (expires_at >= requested_at)
);

CREATE INDEX IF NOT EXISTS idx_tracking_jobs_claim
  ON investigation_tracking_jobs (status, next_attempt_at, lease_until, created_at);
CREATE INDEX IF NOT EXISTS idx_tracking_jobs_case_created
  ON investigation_tracking_jobs (case_id, created_at DESC);

