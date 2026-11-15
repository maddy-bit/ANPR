-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V9: Historical Upload Active Generation Backfill
-- ==============================================================================

-- 1. Ensure any legacy processing runs with NULL or non-positive generation are sanitized from run_number
UPDATE video_processing_runs
SET generation = COALESCE(NULLIF(run_number, 0), 1)
WHERE generation IS NULL OR generation <= 0;

-- 2. Synchronize active_run_generation on video_uploads:
-- Sets active_run_generation to the maximum generation of its historical processing runs.
-- Uploads with zero processing runs receive active_run_generation = 0.
UPDATE video_uploads
SET active_run_generation = COALESCE(
    (SELECT MAX(COALESCE(r.generation, r.run_number, 1))
     FROM video_processing_runs r
     WHERE r.video_upload_id = video_uploads.id),
    0
);

-- 3. Set the default for new video uploads to 0 so their first run cleanly allocates generation 1
ALTER TABLE video_uploads
    ALTER COLUMN active_run_generation SET DEFAULT 0;

