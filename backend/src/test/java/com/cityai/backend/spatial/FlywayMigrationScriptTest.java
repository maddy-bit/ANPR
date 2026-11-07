package com.cityai.backend.spatial;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Validates the Flyway V1 migration script against schema requirements,
 * verifying PostGIS extension setup, entity table coverage, column types,
 * foreign key relationships, nullable fields, and spatial GiST indexes.
 */
class FlywayMigrationScriptTest {

    private static String migrationSql;
    private static String v4MigrationSql;
    private static String v5MigrationSql;
    private static String v6MigrationSql;

    @BeforeAll
    static void loadMigration() throws IOException {
        try (InputStream in = FlywayMigrationScriptTest.class.getResourceAsStream("/db/migration/V1__initial_schema.sql")) {
            assertThat(in).as("V1__initial_schema.sql must exist on classpath").isNotNull();
            migrationSql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (InputStream in = FlywayMigrationScriptTest.class.getResourceAsStream("/db/migration/V4__reid_metadata_and_camera_topology.sql")) {
            assertThat(in).as("V4__reid_metadata_and_camera_topology.sql must exist on classpath").isNotNull();
            v4MigrationSql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (InputStream in = FlywayMigrationScriptTest.class.getResourceAsStream("/db/migration/V5__unverify_synthetic_camera_edges.sql")) {
            assertThat(in).as("V5__unverify_synthetic_camera_edges.sql must exist on classpath").isNotNull();
            v5MigrationSql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        try (InputStream in = FlywayMigrationScriptTest.class.getResourceAsStream("/db/migration/V6__global_vehicle_identities.sql")) {
            assertThat(in).as("V6__global_vehicle_identities.sql must exist on classpath").isNotNull();
            v6MigrationSql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    @Test
    void migration_EnablesPostGisExtension() {
        assertThat(migrationSql)
                .containsIgnoringCase("CREATE EXTENSION IF NOT EXISTS postgis;");
    }

    @Test
    void migration_DefinesAllRequiredTables() {
        assertThat(migrationSql)
                .containsIgnoringCase("CREATE TABLE cameras")
                .containsIgnoringCase("CREATE TABLE vehicles")
                .containsIgnoringCase("CREATE TABLE vehicle_detections")
                .containsIgnoringCase("CREATE TABLE audit_log_entries");
    }

    @Test
    void migration_CamerasTableHasSpatialLocationAndGiSTIndex() {
        assertThat(migrationSql)
                .containsIgnoringCase("location geography(Point, 4326) GENERATED ALWAYS AS")
                .containsIgnoringCase("ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography")
                .containsIgnoringCase("CREATE INDEX idx_cameras_location ON cameras USING GIST (location);");
    }

    @Test
    void migration_VehiclesTableEnforcesUniquePlateConstraint() {
        assertThat(migrationSql)
                .containsIgnoringCase("CONSTRAINT uk_vehicles_plate UNIQUE (plate)")
                .containsIgnoringCase("CREATE INDEX idx_vehicles_plate ON vehicles (plate);");
    }

    @Test
    void migration_VehicleDetectionsPreservesNullableVehicleAssociationForUnreadablePlates() {
        // vehicle_id must be nullable to store detections where plate could not be recognized
        assertThat(migrationSql)
                .matches("(?s).*vehicle_id\\s+BIGINT(?![^,]*NOT NULL).*")
                .containsIgnoringCase("CONSTRAINT fk_detection_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles (id) ON DELETE SET NULL");
    }

    @Test
    void migration_VehicleDetectionsEnforcesCameraForeignKey() {
        assertThat(migrationSql)
                .containsIgnoringCase("camera_id VARCHAR(255) NOT NULL")
                .containsIgnoringCase("CONSTRAINT fk_detection_camera FOREIGN KEY (camera_id) REFERENCES cameras (id)");
    }

    @Test
    void migration_VehicleDetectionsHasCompoundAndGiSTIndexes() {
        assertThat(migrationSql)
                .containsIgnoringCase("CREATE INDEX idx_detection_camera_time ON vehicle_detections (camera_id, timestamp);")
                .containsIgnoringCase("CREATE INDEX idx_detection_vehicle_time ON vehicle_detections (vehicle_id, timestamp);")
                .containsIgnoringCase("CREATE INDEX idx_vehicle_detections_location ON vehicle_detections USING GIST (location);");
    }

    @Test
    void migration_PreservesTimezoneAndPrecisionSemantics() {
        assertThat(migrationSql)
                .containsIgnoringCase("timestamp TIMESTAMP WITH TIME ZONE NOT NULL")
                .containsIgnoringCase("timestamp TIMESTAMP WITH TIME ZONE");
    }

    @Test
    void migrationV4_DefinesReIdProvenanceAndCameraEdges() {
        assertThat(v4MigrationSql)
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS reid_model_name VARCHAR(100)")
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS reid_model_version VARCHAR(50)")
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS reid_dimension INTEGER")
                .containsIgnoringCase("CREATE TABLE IF NOT EXISTS camera_edges")
                .containsIgnoringCase("road_distance_meters DOUBLE PRECISION")
                .containsIgnoringCase("min_travel_time_sec DOUBLE PRECISION")
                .containsIgnoringCase("max_travel_time_sec DOUBLE PRECISION")
                .containsIgnoringCase("CONSTRAINT fk_edge_from_cam FOREIGN KEY (from_camera_id) REFERENCES cameras (id)")
                .containsIgnoringCase("CONSTRAINT fk_edge_to_cam FOREIGN KEY (to_camera_id) REFERENCES cameras (id)");
    }

    @Test
    void migrationV5_MarksSyntheticEdgesUnverified() {
        assertThat(v5MigrationSql)
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE")
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS verification_source VARCHAR(255)")
                .containsIgnoringCase("UPDATE camera_edges")
                .containsIgnoringCase("SET is_verified = FALSE");
    }

    @Test
    void migrationV6_DefinesGlobalIdentitiesAndAssociations() {
        assertThat(v6MigrationSql)
                .containsIgnoringCase("CREATE TABLE IF NOT EXISTS global_identities")
                .containsIgnoringCase("ADD COLUMN IF NOT EXISTS global_identity_id UUID")
                .containsIgnoringCase("CREATE TABLE IF NOT EXISTS identity_associations")
                .containsIgnoringCase("CONSTRAINT fk_detection_global_identity")
                .containsIgnoringCase("CONSTRAINT fk_assoc_source_det")
                .containsIgnoringCase("CONSTRAINT fk_assoc_cand_det")
                .containsIgnoringCase("CONSTRAINT fk_assoc_global_identity")
                .containsIgnoringCase("CONSTRAINT uk_identity_association_pair UNIQUE (source_detection_id, candidate_detection_id)");
    }
}

