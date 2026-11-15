-- ==============================================================================
-- SIH26127 Traffic Intelligence & Vehicle Investigation Platform
-- Flyway Migration V4: Re-ID Model Provenance & Camera Topology Infrastructure
-- ==============================================================================

-- 1. Add model provenance metadata columns to vehicle_detections
-- Historical A1-A4 records remain intact with NULL model metadata,
-- ensuring backward compatibility and preventing cross-model interpretation errors.
ALTER TABLE vehicle_detections
    ADD COLUMN IF NOT EXISTS reid_model_name VARCHAR(100),
    ADD COLUMN IF NOT EXISTS reid_model_version VARCHAR(50),
    ADD COLUMN IF NOT EXISTS reid_dimension INTEGER;

-- Indexes for model version queries and spatial-temporal cross-camera lookups
CREATE INDEX IF NOT EXISTS idx_detection_reid_model ON vehicle_detections (reid_model_name, reid_model_version);
CREATE INDEX IF NOT EXISTS idx_detection_time_camera ON vehicle_detections (timestamp, camera_id);

-- 2. Ensure all official camera nodes are seeded before topology edges are created


-- 3. Calibrated Road Network Edges Table
-- Stores verified road distances and travel time bounds where ground-truth topology exists.
-- Transitions between cameras without an explicit edge row fall back to PostGIS geodesic
-- distance queries with explicit "POSTGIS_GEODESIC_SPHERE" attribution.
CREATE TABLE IF NOT EXISTS camera_edges (
    from_camera_id VARCHAR(255) NOT NULL,
    to_camera_id VARCHAR(255) NOT NULL,
    road_distance_meters DOUBLE PRECISION,
    min_travel_time_sec DOUBLE PRECISION,
    max_travel_time_sec DOUBLE PRECISION,
    road_name VARCHAR(255),
    is_bidirectional BOOLEAN DEFAULT TRUE,
    PRIMARY KEY (from_camera_id, to_camera_id),
    CONSTRAINT fk_edge_from_cam FOREIGN KEY (from_camera_id) REFERENCES cameras (id) ON DELETE CASCADE,
    CONSTRAINT fk_edge_to_cam FOREIGN KEY (to_camera_id) REFERENCES cameras (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_camera_edges_from ON camera_edges (from_camera_id);
CREATE INDEX IF NOT EXISTS idx_camera_edges_to ON camera_edges (to_camera_id);

-- 4. Seed calibrated road edges for verified camera corridors


