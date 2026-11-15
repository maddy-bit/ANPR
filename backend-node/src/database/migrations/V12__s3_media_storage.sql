-- V12: persist the bucket as part of each immutable uploaded-media reference.
-- Existing local uploads keep a NULL bucket and their original storage provider.
ALTER TABLE video_uploads
  ADD COLUMN IF NOT EXISTS storage_bucket VARCHAR(255);

CREATE INDEX IF NOT EXISTS idx_video_uploads_storage_provider
  ON video_uploads (storage_provider, storage_bucket);
