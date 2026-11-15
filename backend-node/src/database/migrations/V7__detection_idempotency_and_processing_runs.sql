-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V7: Detection Idempotency, Processing Runs & Evidence Retention
-- ==============================================================================

-- 1. Video Processing Runs Table
-- Durably persists every discrete processing run for an uploaded video.
CREATE TABLE IF NOT EXISTS video_processing_runs (
    id UUID PRIMARY KEY,
    video_upload_id UUID NOT NULL REFERENCES video_uploads (id) ON DELETE RESTRICT,
    run_number INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    frames_processed INTEGER,
    detections_count INTEGER,
    manifest_path VARCHAR(500),
    manifest_sha256 VARCHAR(64),
    failure_reason TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uk_processing_run_video_run_number UNIQUE (video_upload_id, run_number)
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_upload ON video_processing_runs (video_upload_id);
CREATE INDEX IF NOT EXISTS idx_processing_runs_status ON video_processing_runs (status);

-- 2. Link video_uploads to current_processing_run_id
ALTER TABLE video_uploads
    ADD COLUMN IF NOT EXISTS current_processing_run_id UUID REFERENCES video_processing_runs (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_video_uploads_current_run ON video_uploads (current_processing_run_id);

-- 3. Dynamic fail-safe foreign-key migration for vehicle_detections.video_upload_id
-- Safely converts legacy ON DELETE CASCADE to ON DELETE RESTRICT after verifying catalog state.
DO $$
DECLARE
    v_schema TEXT := current_schema();
    v_cascade_count INTEGER := 0;
    v_restrict_count INTEGER := 0;
    v_total_fk_count INTEGER := 0;
    v_cascade_conname TEXT;
    v_same_name_conname TEXT;
    v_same_name_valid BOOLEAN := FALSE;
BEGIN
    -- Check for any existing constraint named 'fk_detection_video_upload' and verify its definition
    SELECT c.conname,
           (c.contype = 'f'
            AND t_f.relname = 'video_uploads'
            AND array_length(c.conkey, 1) = 1
            AND c.conkey[1] = a_ref.attnum
            AND array_length(c.confkey, 1) = 1
            AND c.confkey[1] = a_f.attnum)
    INTO v_same_name_conname, v_same_name_valid
    FROM pg_constraint c
    JOIN pg_class t_ref ON c.conrelid = t_ref.oid
    JOIN pg_namespace n_ref ON t_ref.relnamespace = n_ref.oid
    JOIN pg_class t_f ON c.confrelid = t_f.oid
    JOIN pg_namespace n_f ON t_f.relnamespace = n_f.oid
    JOIN pg_attribute a_ref ON a_ref.attrelid = t_ref.oid AND a_ref.attname = 'video_upload_id'
    JOIN pg_attribute a_f ON a_f.attrelid = t_f.oid AND a_f.attname = 'id'
    WHERE c.conname = 'fk_detection_video_upload'
      AND n_ref.nspname = v_schema
      AND t_ref.relname = 'vehicle_detections';

    IF v_same_name_conname IS NOT NULL AND NOT v_same_name_valid THEN
        RAISE EXCEPTION 'Constraint fk_detection_video_upload exists in schema % on vehicle_detections but does not correctly map vehicle_detections(video_upload_id) -> video_uploads(id)', v_schema;
    END IF;

    -- Count all FKs from vehicle_detections(video_upload_id) -> video_uploads(id)
    SELECT
        COUNT(*),
        COUNT(*) FILTER (WHERE c.confdeltype = 'c'),
        COUNT(*) FILTER (WHERE c.confdeltype = 'r'),
        MAX(CASE WHEN c.confdeltype = 'c' THEN c.conname END)
    INTO v_total_fk_count, v_cascade_count, v_restrict_count, v_cascade_conname
    FROM pg_constraint c
    JOIN pg_class t_ref ON c.conrelid = t_ref.oid
    JOIN pg_namespace n_ref ON t_ref.relnamespace = n_ref.oid
    JOIN pg_class t_f ON c.confrelid = t_f.oid
    JOIN pg_namespace n_f ON t_f.relnamespace = n_f.oid
    JOIN pg_attribute a_ref ON a_ref.attrelid = t_ref.oid AND a_ref.attname = 'video_upload_id'
    JOIN pg_attribute a_f ON a_f.attrelid = t_f.oid AND a_f.attname = 'id'
    WHERE n_ref.nspname = v_schema
      AND t_ref.relname = 'vehicle_detections'
      AND n_f.nspname = v_schema
      AND t_f.relname = 'video_uploads'
      AND c.contype = 'f'
      AND array_length(c.conkey, 1) = 1
      AND c.conkey[1] = a_ref.attnum
      AND array_length(c.confkey, 1) = 1
      AND c.confkey[1] = a_f.attnum;

    IF v_total_fk_count > 1 THEN
        RAISE EXCEPTION 'Multiple foreign keys (%) found from vehicle_detections(video_upload_id) to video_uploads(id) in schema %; manual resolution required', v_total_fk_count, v_schema;
    ELSIF v_cascade_count = 1 THEN
        EXECUTE format('ALTER TABLE %I.vehicle_detections DROP CONSTRAINT %I', v_schema, v_cascade_conname);
        EXECUTE format('ALTER TABLE %I.vehicle_detections ADD CONSTRAINT fk_detection_video_upload FOREIGN KEY (video_upload_id) REFERENCES %I.video_uploads(id) ON DELETE RESTRICT', v_schema, v_schema);
        RAISE NOTICE 'Replaced legacy CASCADE foreign key % with ON DELETE RESTRICT in schema %', v_cascade_conname, v_schema;
    ELSIF v_restrict_count = 1 THEN
        RAISE NOTICE 'Compliant RESTRICT foreign key already exists from vehicle_detections(video_upload_id) to video_uploads(id) in schema %', v_schema;
    ELSIF v_total_fk_count = 0 THEN
        EXECUTE format('ALTER TABLE %I.vehicle_detections ADD CONSTRAINT fk_detection_video_upload FOREIGN KEY (video_upload_id) REFERENCES %I.video_uploads(id) ON DELETE RESTRICT', v_schema, v_schema);
        RAISE NOTICE 'Created missing fk_detection_video_upload with ON DELETE RESTRICT in schema %', v_schema;
    ELSE
        RAISE EXCEPTION 'Unexpected foreign key configuration on vehicle_detections(video_upload_id) in schema % (total: %, cascade: %, restrict: %)', v_schema, v_total_fk_count, v_cascade_count, v_restrict_count;
    END IF;
END $$;

-- 4. Alter table vehicle_detections: processing_run_id and idempotency_key
ALTER TABLE vehicle_detections
    ADD COLUMN IF NOT EXISTS processing_run_id UUID REFERENCES video_processing_runs (id) ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_detection_processing_run ON vehicle_detections (processing_run_id);

-- 5. Partial unique index on idempotency_key (permits multiple NULL historical detections)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicle_detections_idempotency_key
    ON vehicle_detections (idempotency_key)
    WHERE idempotency_key IS NOT NULL;
