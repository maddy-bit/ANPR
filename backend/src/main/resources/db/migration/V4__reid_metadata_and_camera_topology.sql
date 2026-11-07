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
INSERT INTO cameras (id, name, latitude, longitude, direction, status)
VALUES
    ('CAM-01', 'Shivajinagar Chowk', 18.5308, 73.8474, 'SE', 'CONFIGURED'),
    ('CAM-02', 'FC Road Junction', 18.5236, 73.8478, 'S', 'CONFIGURED'),
    ('CAM-03', 'JM Road - Deccan Gymkhana', 18.5158, 73.8412, 'SW', 'CONFIGURED'),
    ('CAM-04', 'Karve Road Bridge', 18.5074, 73.8258, 'W', 'CONFIGURED'),
    ('CAM-05', 'Swargate Junction', 18.5008, 73.8567, 'E', 'CONFIGURED'),
    ('CAM-06', 'Hadapsar Industrial Estate', 18.5089, 73.9260, 'E', 'CONFIGURED'),
    ('CAM-07', 'Kothrud Depot', 18.5074, 73.8077, 'NW', 'CONFIGURED'),
    ('CAM-08', 'Baner Road', 18.5642, 73.7769, 'N', 'CONFIGURED'),
    ('CAM-09', 'Hinjewadi Phase 1', 18.5908, 73.7392, 'W', 'CONFIGURED'),
    ('CAM-10', 'Wakad Bridge', 18.5993, 73.7629, 'N', 'CONFIGURED'),
    ('CAM-11', 'Aundh - ITI Road', 18.5590, 73.8080, 'NE', 'CONFIGURED'),
    ('CAM-12', 'University Circle', 18.5529, 73.8291, 'SE', 'STREAM_DISCONNECTED')
ON CONFLICT (id) DO UPDATE SET
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    name = EXCLUDED.name,
    direction = EXCLUDED.direction;

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
INSERT INTO camera_edges (from_camera_id, to_camera_id, road_distance_meters, min_travel_time_sec, max_travel_time_sec, road_name, is_bidirectional)
VALUES
    ('CAM-01', 'CAM-02', 1200.0, 60.0, 900.0, 'Shivajinagar - FC Road Corridor', TRUE),
    ('CAM-02', 'CAM-01', 1200.0, 60.0, 900.0, 'FC Road - Shivajinagar Corridor', TRUE),
    ('CAM-02', 'CAM-03', 1000.0, 45.0, 600.0, 'FC Road - JM Road Link', TRUE),
    ('CAM-03', 'CAM-02', 1000.0, 45.0, 600.0, 'JM Road - FC Road Link', TRUE),
    ('CAM-04', 'CAM-07', 2100.0, 90.0, 1200.0, 'Karve Road - Kothrud Depot Route', TRUE),
    ('CAM-07', 'CAM-04', 2100.0, 90.0, 1200.0, 'Kothrud Depot - Karve Road Route', TRUE)
ON CONFLICT (from_camera_id, to_camera_id) DO NOTHING;
