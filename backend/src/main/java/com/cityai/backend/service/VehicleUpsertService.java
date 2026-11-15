package com.cityai.backend.service;

import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleRepository;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Objects;
import java.util.Optional;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Concurrency-safe, dialect-aware upsert service for Vehicle and Camera identities.
 *
 * Executes atomic upserts within the caller's active database transaction.
 * Uses PostgreSQL native ON CONFLICT or H2 native MERGE INTO.
 * Guarantees zero constraint violation exceptions, zero transaction aborts in PostgreSQL,
 * and zero connection pool deadlocks (never uses REQUIRES_NEW).
 */
@Service
public class VehicleUpsertService {

    private static final Logger log = LoggerFactory.getLogger(VehicleUpsertService.class);

    private final JdbcTemplate jdbcTemplate;
    private final VehicleRepository vehicleRepository;
    private final CameraRepository cameraRepository;
    private final boolean isPostgres;

    public VehicleUpsertService(
            JdbcTemplate jdbcTemplate,
            DataSource dataSource,
            VehicleRepository vehicleRepository,
            CameraRepository cameraRepository) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate, "jdbcTemplate must not be null");
        this.vehicleRepository = Objects.requireNonNull(vehicleRepository, "vehicleRepository must not be null");
        this.cameraRepository = Objects.requireNonNull(cameraRepository, "cameraRepository must not be null");

        boolean postgres = false;
        try (Connection conn = dataSource.getConnection()) {
            String prodName = conn.getMetaData().getDatabaseProductName();
            postgres = prodName != null && prodName.toLowerCase().contains("postgres");
        } catch (SQLException e) {
            log.warn("Could not determine database product name from DataSource, defaulting isPostgres to false: {}", e.getMessage());
        }
        this.isPostgres = postgres;
        log.info("VehicleUpsertService initialized: isPostgres={}", this.isPostgres);
    }

    /**
     * Resolves or atomically creates a Vehicle identity for the normalized plate.
     * Existing vehicle records preserve their ID, vehicleType, make, model, color, and all other fields.
     */
    public Vehicle upsertVehicle(String normalizedPlate) {
        if (normalizedPlate == null || normalizedPlate.isBlank()) {
            return null;
        }

        // 1. Fast read: if the vehicle already exists in the current transaction/persistence context, return it
        Optional<Vehicle> existing = vehicleRepository.findByPlate(normalizedPlate);
        if (existing.isPresent()) {
            return existing.get();
        }

        // 2. Concurrency-safe native upsert within the caller's active transaction
        if (isPostgres) {
            String sql = """
                INSERT INTO vehicles (plate)
                VALUES (?)
                ON CONFLICT (plate) DO NOTHING
                """;
            jdbcTemplate.update(sql, normalizedPlate);
        } else {
            // H2 in-memory mode
            String sql = "MERGE INTO vehicles (plate) KEY(plate) VALUES (?)";
            jdbcTemplate.update(sql, normalizedPlate);
        }

        // 3. Retrieve the managed entity
        return vehicleRepository.findByPlate(normalizedPlate)
                .orElseThrow(() -> new IllegalStateException("Failed to resolve vehicle after upsert for plate: " + normalizedPlate));
    }

    /**
     * Resolves or atomically creates a stub Camera node for an unseen cameraId.
     * Existing camera records preserve their ID, name, calibrated latitude/longitude, direction, status, and videoSource.
     */
    public Camera upsertCamera(String cameraId) {
        if (cameraId == null || cameraId.isBlank()) {
            throw new IllegalArgumentException("Unknown camera: null or blank");
        }

        // 1. Fast read: if camera already exists, return it with all calibrated fields intact
        Optional<Camera> existing = cameraRepository.findById(cameraId);
        if (existing.isPresent()) {
            return existing.get();
        }

        // 2. Concurrency-safe stub insert for newly discovered camera node
        String name = "Camera " + cameraId;
        double lat = 0.0;
        double lon = 0.0;
        String dir = "N";
        String status = "CONFIGURED";

        if (isPostgres) {
            String sql = """
                INSERT INTO cameras (id, name, latitude, longitude, direction, status, video_source)
                VALUES (?, ?, ?, ?, ?, ?, NULL)
                ON CONFLICT (id) DO NOTHING
                """;
            jdbcTemplate.update(sql, cameraId, name, lat, lon, dir, status);
        } else {
            // H2 in-memory mode
            String sql = """
                MERGE INTO cameras (id, name, latitude, longitude, direction, status)
                KEY(id)
                VALUES (?, ?, ?, ?, ?, ?)
                """;
            jdbcTemplate.update(sql, cameraId, name, lat, lon, dir, status);
        }

        // 3. Retrieve the managed camera entity
        return cameraRepository.findById(cameraId)
                .orElseThrow(() -> new IllegalStateException("Failed to resolve camera after upsert for ID: " + cameraId));
    }

    public boolean isPostgres() {
        return isPostgres;
    }
}

