-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V8: Processing Run Lifecycle, Idempotency & Active Generation
-- ==============================================================================

-- 1. Video Upload active run generation counter
ALTER TABLE video_uploads
    ADD COLUMN IF NOT EXISTS active_run_generation INTEGER NOT NULL DEFAULT 1;

-- 2. Processing Run generation, client token, and configuration fields
ALTER TABLE video_processing_runs
    ADD COLUMN IF NOT EXISTS generation INTEGER,
    ADD COLUMN IF NOT EXISTS client_run_token VARCHAR(128),
    ADD COLUMN IF NOT EXISTS frame_stride INTEGER,
    ADD COLUMN IF NOT EXISTS enable_dehaze BOOLEAN,
    ADD COLUMN IF NOT EXISTS config_hash VARCHAR(64),
    ADD COLUMN IF NOT EXISTS config_status VARCHAR(30);

-- 3. Honest Backfill for historical V7 runs (unverified parameters)
UPDATE video_processing_runs
SET config_status = 'LEGACY_UNVERIFIED',
    config_hash = 'legacy:unverified',
    generation = run_number
WHERE config_status IS NULL;

-- 4. Apply NOT NULL constraints after successful backfill
ALTER TABLE video_processing_runs
    ALTER COLUMN config_status SET NOT NULL,
    ALTER COLUMN config_hash SET NOT NULL,
    ALTER COLUMN generation SET NOT NULL;

-- 5. Database-enforced request idempotency per video upload:
-- Exactly one processing run per (video_upload_id, client_run_token)
CREATE UNIQUE INDEX IF NOT EXISTS uk_processing_run_upload_client_token
    ON video_processing_runs (video_upload_id, client_run_token)
    WHERE client_run_token IS NOT NULL;

-- 6. Enforce at most one active run (CREATED or PROCESSING) per video upload
CREATE UNIQUE INDEX IF NOT EXISTS idx_processing_runs_active_per_upload
    ON video_processing_runs (video_upload_id)
    WHERE status IN ('CREATED', 'PROCESSING');

-- 7. Composite index for upload and generation lookups
CREATE INDEX IF NOT EXISTS idx_processing_runs_upload_gen
    ON video_processing_runs (video_upload_id, generation);

