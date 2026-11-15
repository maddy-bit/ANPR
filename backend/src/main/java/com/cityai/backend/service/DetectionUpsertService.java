package com.cityai.backend.service;

import com.cityai.backend.dto.DetectionIngestRequest;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VideoProcessingRun;
import com.cityai.backend.model.VideoUpload;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Savepoint;
import java.sql.Statement;
import java.sql.Timestamp;
import java.sql.Types;
import java.util.Objects;
import java.util.UUID;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.ConnectionCallback;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * Concurrency-safe, dialect-aware insertion service for VehicleDetection evidence records.
 *
 * Guarantees:
 * 1. PostgreSQL: Uses ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id.
 *    Atomic, zero transaction aborts, zero overwrites.
 * 2. H2: Uses per-item JDBC Savepoints and catches SQLState 23505 (Unique violation),
 *    rolling back only to the savepoint and querying the existing winning detection ID.
 *    Keeps the Spring transaction and connection healthy for subsequent JPA operations.
 * 3. Preserves all existing columns, Re-ID embeddings, timestamps, bounding boxes, and foreign keys.
 */
@Service
public class DetectionUpsertService {

    private static final Logger log = LoggerFactory.getLogger(DetectionUpsertService.class);

    public record UpsertResult(Long id, boolean isCreated) {}

    private final JdbcTemplate jdbcTemplate;
    private final boolean isPostgres;

    public DetectionUpsertService(JdbcTemplate jdbcTemplate, DataSource dataSource) {
        this.jdbcTemplate = Objects.requireNonNull(jdbcTemplate, "jdbcTemplate must not be null");

        boolean postgres = false;
        try (Connection conn = dataSource.getConnection()) {
            String prodName = conn.getMetaData().getDatabaseProductName();
            postgres = prodName != null && prodName.toLowerCase().contains("postgres");
        } catch (SQLException e) {
            log.warn("Could not determine database product name from DataSource: {}", e.getMessage());
        }
        this.isPostgres = postgres;
        log.info("DetectionUpsertService initialized: isPostgres={}", this.isPostgres);
    }

    public boolean isPostgres() {
        return isPostgres;
    }

    public UpsertResult upsertDetection(
            DetectionIngestRequest request,
            Camera camera,
            Vehicle vehicle,
            VideoUpload videoUpload,
            VideoProcessingRun processingRun,
            int batchIndex
    ) {
        String key = request.idempotencyKey();

        return jdbcTemplate.execute((ConnectionCallback<UpsertResult>) conn -> {
            if (isPostgres) {
                return insertPostgres(conn, request, camera, vehicle, videoUpload, processingRun, key);
            } else {
                return insertH2(conn, request, camera, vehicle, videoUpload, processingRun, key, batchIndex);
            }
        });
    }

    private UpsertResult insertPostgres(
            Connection conn,
            DetectionIngestRequest request,
            Camera camera,
            Vehicle vehicle,
            VideoUpload videoUpload,
            VideoProcessingRun processingRun,
            String key
    ) throws SQLException {
        if (key == null || key.isBlank()) {
            String sql = """
                INSERT INTO vehicle_detections (
                    camera_id, timestamp, latitude, longitude, direction, speed_kmh,
                    vehicle_class, detection_confidence, plate_text_raw, plate_text_normalized,
                    plate_confidence, reid_confidence, image_path, track_id, frame_number,
                    reid_embedding, bbox, reid_model_name, reid_model_version, reid_dimension,
                    video_upload_id, processing_run_id, idempotency_key, vehicle_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                RETURNING id;
                """;
            try (PreparedStatement ps = conn.prepareStatement(sql)) {
                bindParameters(ps, request, camera, vehicle, videoUpload, processingRun, null);
                try (ResultSet rs = ps.executeQuery()) {
                    if (rs.next()) {
                        return new UpsertResult(rs.getLong(1), true);
                    }
                }
            }
            throw new SQLException("Failed to retrieve generated ID for detection");
        }

        String sql = """
            INSERT INTO vehicle_detections (
                camera_id, timestamp, latitude, longitude, direction, speed_kmh,
                vehicle_class, detection_confidence, plate_text_raw, plate_text_normalized,
                plate_confidence, reid_confidence, image_path, track_id, frame_number,
                reid_embedding, bbox, reid_model_name, reid_model_version, reid_dimension,
                video_upload_id, processing_run_id, idempotency_key, vehicle_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
            DO NOTHING
            RETURNING id;
            """;

        try (PreparedStatement ps = conn.prepareStatement(sql)) {
            bindParameters(ps, request, camera, vehicle, videoUpload, processingRun, key);
            try (ResultSet rs = ps.executeQuery()) {
                if (rs.next()) {
                    return new UpsertResult(rs.getLong(1), true);
                }
            }
        }

        // Duplicate detected: resolve winning existing ID
        return queryExistingId(conn, key);
    }

    private UpsertResult insertH2(
            Connection conn,
            DetectionIngestRequest request,
            Camera camera,
            Vehicle vehicle,
            VideoUpload videoUpload,
            VideoProcessingRun processingRun,
            String key,
            int batchIndex
    ) throws SQLException {
        String insertSql = """
            INSERT INTO vehicle_detections (
                camera_id, timestamp, latitude, longitude, direction, speed_kmh,
                vehicle_class, detection_confidence, plate_text_raw, plate_text_normalized,
                plate_confidence, reid_confidence, image_path, track_id, frame_number,
                reid_embedding, bbox, reid_model_name, reid_model_version, reid_dimension,
                video_upload_id, processing_run_id, idempotency_key, vehicle_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

        if (key == null || key.isBlank()) {
            try (PreparedStatement ps = conn.prepareStatement(insertSql, Statement.RETURN_GENERATED_KEYS)) {
                bindParameters(ps, request, camera, vehicle, videoUpload, processingRun, null);
                ps.executeUpdate();
                try (ResultSet rs = ps.getGeneratedKeys()) {
                    if (rs.next()) {
                        return new UpsertResult(rs.getLong(1), true);
                    }
                }
            }
            throw new SQLException("Failed to retrieve generated ID for non-keyed detection in H2");
        }

        // Keyed insert protected by JDBC savepoint to isolate potential 23505 unique violation
        Savepoint sp = conn.setSavepoint("det_sp_" + batchIndex);
        try (PreparedStatement ps = conn.prepareStatement(insertSql, Statement.RETURN_GENERATED_KEYS)) {
            bindParameters(ps, request, camera, vehicle, videoUpload, processingRun, key);
            ps.executeUpdate();
            try (ResultSet rs = ps.getGeneratedKeys()) {
                if (rs.next()) {
                    return new UpsertResult(rs.getLong(1), true);
                }
            }
        } catch (SQLException e) {
            if ("23505".equals(e.getSQLState()) || (e.getMessage() != null && e.getMessage().contains("23505"))) {
                // Roll back strictly to the savepoint boundary to clear connection error state
                conn.rollback(sp);
                return queryExistingId(conn, key);
            }
            throw e;
        } finally {
            try {
                conn.releaseSavepoint(sp);
            } catch (SQLException ignored) {
                // In H2, rolled back savepoints may already be released
            }
        }

        throw new SQLException("Unexpected outcome during H2 detection upsert for key: " + key);
    }

    private UpsertResult queryExistingId(Connection conn, String key) throws SQLException {
        String querySql = "SELECT id FROM vehicle_detections WHERE idempotency_key = ?";
        try (PreparedStatement qps = conn.prepareStatement(querySql)) {
            qps.setString(1, key);
            try (ResultSet qrs = qps.executeQuery()) {
                if (qrs.next()) {
                    return new UpsertResult(qrs.getLong(1), false);
                }
            }
        }
        throw new IllegalStateException("Winning detection ID not found for existing idempotency key: " + key);
    }

    private void bindParameters(
            PreparedStatement ps,
            DetectionIngestRequest req,
            Camera cam,
            Vehicle veh,
            VideoUpload up,
            VideoProcessingRun run,
            String key
    ) throws SQLException {
        ps.setString(1, cam.getId());
        ps.setTimestamp(2, Timestamp.from(req.timestamp()));
        ps.setDouble(3, cam.getLatitude());
        ps.setDouble(4, cam.getLongitude());
        ps.setString(5, cam.getDirection());

        // speed_kmh
        ps.setNull(6, Types.DOUBLE);

        ps.setString(7, req.vehicleClass());
        ps.setDouble(8, req.detectionConfidence());
        ps.setString(9, req.plateTextRaw());
        ps.setString(10, req.plateTextNormalized());

        if (req.plateConfidence() != null) {
            ps.setDouble(11, req.plateConfidence());
        } else {
            ps.setNull(11, Types.DOUBLE);
        }

        if (req.reidConfidence() != null) {
            ps.setDouble(12, req.reidConfidence());
        } else {
            ps.setNull(12, Types.DOUBLE);
        }

        ps.setString(13, req.imagePath());

        if (req.trackId() != null) {
            ps.setInt(14, req.trackId());
        } else {
            ps.setNull(14, Types.INTEGER);
        }

        if (req.frameNumber() != null) {
            ps.setInt(15, req.frameNumber());
        } else {
            ps.setNull(15, Types.INTEGER);
        }

        if (req.reidEmbedding() != null && !req.reidEmbedding().isEmpty()) {
            ps.setString(16, req.reidEmbedding().toString());
        } else {
            ps.setNull(16, Types.VARCHAR);
        }

        if (req.bbox() != null && !req.bbox().isEmpty()) {
            ps.setString(17, req.bbox().toString());
        } else {
            ps.setNull(17, Types.VARCHAR);
        }

        ps.setString(18, req.reidModelName());
        ps.setString(19, req.reidModelVersion());

        if (req.reidDimension() != null) {
            ps.setInt(20, req.reidDimension());
        } else {
            ps.setNull(20, Types.INTEGER);
        }

        // video_upload_id
        if (up != null && up.getId() != null) {
            ps.setObject(21, up.getId());
        } else if (req.videoUploadId() != null) {
            ps.setObject(21, req.videoUploadId());
        } else {
            ps.setNull(21, Types.OTHER);
        }

        // processing_run_id
        if (run != null && run.getId() != null) {
            ps.setObject(22, run.getId());
        } else if (req.processingRunId() != null) {
            ps.setObject(22, req.processingRunId());
        } else {
            ps.setNull(22, Types.OTHER);
        }

        // idempotency_key
        if (key != null && !key.isBlank()) {
            ps.setString(23, key);
        } else {
            ps.setNull(23, Types.VARCHAR);
        }

        // vehicle_id
        if (veh != null && veh.getId() != null) {
            ps.setLong(24, veh.getId());
        } else {
            ps.setNull(24, Types.BIGINT);
        }
    }
}
