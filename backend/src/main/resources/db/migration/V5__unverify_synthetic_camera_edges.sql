-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V5: Explicit Calibration Status for Camera Edges
-- ==============================================================================
-- Removes synthetic/unverified road edges as calibrated production facts.
-- Unverified edges must not be used to make definitive identity or travel-time decisions.
-- Preserves the ability to configure verified edges later with is_verified = TRUE.

ALTER TABLE camera_edges
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS verification_source VARCHAR(255) DEFAULT 'UNVERIFIED_ESTIMATE',
    ADD COLUMN IF NOT EXISTS notes TEXT;

-- Mark all existing seeded edges as unverified manual estimates
UPDATE camera_edges
SET is_verified = FALSE,
    verification_source = 'UNVERIFIED_MANUAL_ESTIMATE',
    notes = 'Unverified manual estimate created during initial scaffolding; not calibrated against real road survey or GIS network. Excluded from definitive identity and travel-time gating.';

