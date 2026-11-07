-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V3: Video Inference Pipeline & Detection Association
-- ==============================================================================

-- 1. Add video_upload_id and bounding_box to vehicle_detections
ALTER TABLE vehicle_detections
    ADD COLUMN IF NOT EXISTS video_upload_id UUID,
    ADD COLUMN IF NOT EXISTS bbox VARCHAR(100),
    ADD CONSTRAINT fk_detection_video_upload FOREIGN KEY (video_upload_id) REFERENCES video_uploads (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_detection_video_upload ON vehicle_detections (video_upload_id);
CREATE INDEX IF NOT EXISTS idx_detection_track_frame ON vehicle_detections (camera_id, track_id, frame_number);

-- 2. Add processing telemetry columns to video_uploads
ALTER TABLE video_uploads
    ADD COLUMN IF NOT EXISTS frames_processed INTEGER,
    ADD COLUMN IF NOT EXISTS detections_count INTEGER,
    ADD COLUMN IF NOT EXISTS processing_duration_sec DOUBLE PRECISION;

