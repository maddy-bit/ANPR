-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V2: Video Uploads & Storage Infrastructure
-- ==============================================================================

CREATE TABLE video_uploads (
    id UUID PRIMARY KEY,
    original_filename VARCHAR(255) NOT NULL,
    storage_key VARCHAR(500) NOT NULL UNIQUE,
    storage_provider VARCHAR(50) NOT NULL,
    mime_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    status VARCHAR(50) NOT NULL,
    camera_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL,
    failure_reason TEXT,
    sha256_hash VARCHAR(64),
    CONSTRAINT fk_video_upload_camera FOREIGN KEY (camera_id) REFERENCES cameras (id) ON DELETE SET NULL
);

CREATE INDEX idx_video_uploads_status ON video_uploads (status);
CREATE INDEX idx_video_uploads_camera ON video_uploads (camera_id);
CREATE INDEX idx_video_uploads_created_at ON video_uploads (created_at DESC);

