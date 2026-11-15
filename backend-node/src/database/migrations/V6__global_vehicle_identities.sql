-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V6: Global Vehicle Identity Registry & Multi-Signal Association
-- ==============================================================================

-- 1. Global Vehicle Identity Registry Table
-- Stores unified, cross-camera physical vehicle identities with persistent UUIDs.
CREATE TABLE IF NOT EXISTS global_identities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    label VARCHAR(100) NOT NULL UNIQUE,
    primary_plate VARCHAR(32),
    plate_confidence DOUBLE PRECISION,
    vehicle_class VARCHAR(50),
    color VARCHAR(50),
    make VARCHAR(100),
    model VARCHAR(100),
    representative_reid_embedding TEXT,
    reid_model_name VARCHAR(100),
    reid_model_version VARCHAR(50),
    reid_dimension INTEGER,
    review_status VARCHAR(50) NOT NULL DEFAULT 'ACTIVE',
    conflict_notes TEXT,
    first_seen_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    last_seen_timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    detection_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_global_identities_plate ON global_identities (primary_plate);
CREATE INDEX IF NOT EXISTS idx_global_identities_review ON global_identities (review_status);
CREATE INDEX IF NOT EXISTS idx_global_identities_time ON global_identities (first_seen_timestamp, last_seen_timestamp);

-- 2. Link detections to persistent global identities (preserves original raw detection records)
ALTER TABLE vehicle_detections
    ADD COLUMN IF NOT EXISTS global_identity_id UUID;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_detection_global_identity'
    ) THEN
        ALTER TABLE vehicle_detections
            ADD CONSTRAINT fk_detection_global_identity
            FOREIGN KEY (global_identity_id) REFERENCES global_identities (id)
            ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_detection_global_identity ON vehicle_detections (global_identity_id);

-- 3. Identity Associations Table
-- Records provenance, individual signals, and decision audit trail for every pair evaluation.
CREATE TABLE IF NOT EXISTS identity_associations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_detection_id BIGINT NOT NULL,
    candidate_detection_id BIGINT NOT NULL,
    global_identity_id UUID,
    reid_score DOUBLE PRECISION,
    plate_score DOUBLE PRECISION,
    attribute_score DOUBLE PRECISION,
    topology_score DOUBLE PRECISION,
    overall_score DOUBLE PRECISION NOT NULL,
    decision VARCHAR(50) NOT NULL,
    decision_reason TEXT NOT NULL,
    review_status VARCHAR(50) NOT NULL DEFAULT 'SYSTEM_DECIDED',
    review_notes TEXT,
    reid_model_name VARCHAR(100),
    reid_model_version VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assoc_source_det FOREIGN KEY (source_detection_id) REFERENCES vehicle_detections (id) ON DELETE CASCADE,
    CONSTRAINT fk_assoc_cand_det FOREIGN KEY (candidate_detection_id) REFERENCES vehicle_detections (id) ON DELETE CASCADE,
    CONSTRAINT fk_assoc_global_identity FOREIGN KEY (global_identity_id) REFERENCES global_identities (id) ON DELETE SET NULL,
    CONSTRAINT uk_identity_association_pair UNIQUE (source_detection_id, candidate_detection_id)
);

CREATE INDEX IF NOT EXISTS idx_assoc_source ON identity_associations (source_detection_id);
CREATE INDEX IF NOT EXISTS idx_assoc_cand ON identity_associations (candidate_detection_id);
CREATE INDEX IF NOT EXISTS idx_assoc_gid ON identity_associations (global_identity_id);
CREATE INDEX IF NOT EXISTS idx_assoc_decision ON identity_associations (decision);
CREATE INDEX IF NOT EXISTS idx_assoc_review ON identity_associations (review_status);

