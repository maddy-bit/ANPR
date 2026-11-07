package com.cityai.backend.service;

import com.cityai.backend.dto.CandidateAssociationResponseDto;
import com.cityai.backend.dto.CandidateDetectionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.trajectory.GeoUtils;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CandidateAssociationService {

    private static final Logger log = LoggerFactory.getLogger(CandidateAssociationService.class);

    private final VehicleDetectionRepository detectionRepository;
    private final JdbcTemplate jdbcTemplate;

    @Autowired
    public CandidateAssociationService(
            VehicleDetectionRepository detectionRepository,
            @Autowired(required = false) CameraRepository cameraRepository,
            @Autowired(required = false) JdbcTemplate jdbcTemplate) {
        this.detectionRepository = detectionRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional(readOnly = true)
    public CandidateAssociationResponseDto findCandidates(
            Long sourceDetectionId,
            Double minSpeedKmh,
            Double maxSpeedKmh,
            Double maxTimeWindowSec,
            boolean feasibleOnly) {

        VehicleDetection source = detectionRepository.findById(Objects.requireNonNull(sourceDetectionId, "sourceDetectionId must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Detection not found with id: " + sourceDetectionId));

        Camera srcCam = source.getCamera();
        Instant srcTime = source.getTimestamp();
        if (srcTime == null) {
            throw new IllegalStateException("Source detection has no timestamp: " + sourceDetectionId);
        }

        double maxSpeed = (maxSpeedKmh != null && maxSpeedKmh > 0.0) ? maxSpeedKmh : 100.0;
        double windowSec = (maxTimeWindowSec != null && maxTimeWindowSec > 0.0) ? maxTimeWindowSec : 7200.0;

        Instant start = srcTime.minusSeconds((long) windowSec);
        Instant end = srcTime.plusSeconds((long) windowSec);

        // Fetch candidate detections strictly from OTHER cameras within the time window
        List<VehicleDetection> candidates = detectionRepository
                .findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(start, end, srcCam.getId());

        List<CandidateDetectionDto> evaluatedCandidates = new ArrayList<>();
        int feasibleCount = 0;

        double[] srcEmbeddingVector = parseEmbeddingVector(source.getReidEmbedding());

        for (VehicleDetection cand : candidates) {
            Camera candCam = cand.getCamera();
            Instant candTime = cand.getTimestamp();

            // 1. Spatial distance & method
            DistanceResult distResult = evaluateDistance(srcCam, candCam);

            // 2. Temporal difference
            Double dtSec = null;
            if (candTime != null && srcTime != null) {
                dtSec = Math.abs(Duration.between(srcTime, candTime).toMillis()) / 1000.0;
            }

            // 3. Feasibility evaluation
            FeasibilityResult feasResult = evaluateFeasibility(distResult, dtSec, maxSpeed, windowSec, srcCam.getId(), candCam.getId());
            if ("FEASIBLE".equals(feasResult.feasibility())) {
                feasibleCount++;
            }

            if (feasibleOnly && !"FEASIBLE".equals(feasResult.feasibility())) {
                continue;
            }

            // 4. Re-ID model compatibility & similarity
            double[] candEmbeddingVector = parseEmbeddingVector(cand.getReidEmbedding());
            ModelCompatibilityResult compResult = evaluateModelCompatibility(
                    source.getReidModelName(), source.getReidModelVersion(), source.getReidDimension(), srcEmbeddingVector,
                    cand.getReidModelName(), cand.getReidModelVersion(), cand.getReidDimension(), candEmbeddingVector
            );

            evaluatedCandidates.add(new CandidateDetectionDto(
                    cand.getId(),
                    candCam.getId(),
                    candTime,
                    distResult.distanceKm(),
                    distResult.method(),
                    dtSec,
                    feasResult.apparentSpeedKmh(),
                    feasResult.feasibility(),
                    feasResult.reason(),
                    compResult.compatibility(),
                    compResult.visualSimilarity(),
                    cand.getReidModelName(),
                    cand.getReidModelVersion(),
                    cand.getReidDimension(),
                    cand.getPlateTextNormalized(),
                    cand.getVehicleClass(),
                    cand.getImagePath()
            ));
        }

        return new CandidateAssociationResponseDto(
                source.getId(),
                srcCam.getId(),
                srcTime,
                source.getPlateTextNormalized(),
                source.getReidModelName(),
                source.getReidModelVersion(),
                candidates.size(),
                feasibleCount,
                evaluatedCandidates
        );
    }

    private DistanceResult evaluateDistance(Camera srcCam, Camera candCam) {
        boolean hasUnverifiedEdge = false;
        // 1. Check calibrated road network edge in camera_edges table
        if (jdbcTemplate != null) {
            try {
                String edgeSql = """
                        SELECT road_distance_meters, min_travel_time_sec, max_travel_time_sec, road_name, is_verified
                        FROM camera_edges
                        WHERE from_camera_id = ? AND to_camera_id = ?
                        """;
                List<DistanceResult> edges = jdbcTemplate.query(
                        edgeSql,
                        (rs, rowNum) -> {
                            boolean isVerified = rs.getBoolean("is_verified");
                            double distKm = rs.getDouble("road_distance_meters") / 1000.0;
                            double minSec = rs.getDouble("min_travel_time_sec");
                            double maxSec = rs.getDouble("max_travel_time_sec");
                            if (isVerified) {
                                return new DistanceResult(distKm, "VERIFIED_ROAD_NETWORK", minSec, maxSec, true, false, null);
                            } else {
                                return new DistanceResult(distKm, "UNVERIFIED_ROAD_ESTIMATE", minSec, maxSec, false, true, null);
                            }
                        },
                        srcCam.getId(), candCam.getId()
                );
                if (!edges.isEmpty()) {
                    DistanceResult edge = edges.get(0);
                    if (edge.isVerified()) {
                        return edge;
                    }
                    // Edge exists but is unverified! Record that an unverified estimate exists,
                    // but do NOT use synthetic road distance or travel times as calibrated production facts.
                    hasUnverifiedEdge = true;
                }
            } catch (Exception e) {
                log.debug("camera_edges table not available for distance lookup: {}", e.getMessage());
            }
        }

        // 2. Validate coordinates (distinguish source vs destination missing coordinates)
        if (isInvalidCoordinate(srcCam.getLatitude(), srcCam.getLongitude())) {
            return new DistanceResult(null, "UNKNOWN_COORDINATES", null, null, false, hasUnverifiedEdge, "SOURCE_COORDINATES_MISSING");
        }
        if (isInvalidCoordinate(candCam.getLatitude(), candCam.getLongitude())) {
            return new DistanceResult(null, "UNKNOWN_COORDINATES", null, null, false, hasUnverifiedEdge, "DESTINATION_COORDINATES_MISSING");
        }

        // 3. PostGIS Geodesic distance query
        if (jdbcTemplate != null) {
            try {
                String postgisSql = """
                        SELECT ST_Distance(
                            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
                        ) / 1000.0 AS dist_km
                        """;
                Double dist = jdbcTemplate.queryForObject(
                        postgisSql,
                        Double.class,
                        srcCam.getLongitude(), srcCam.getLatitude(),
                        candCam.getLongitude(), candCam.getLatitude()
                );
                if (dist != null) {
                    return new DistanceResult(dist, "POSTGIS_GEODESIC_SPHERE", null, null, false, hasUnverifiedEdge, null);
                }
            } catch (Exception e) {
                log.debug("PostGIS ST_Distance failed, falling back to Java Haversine: {}", e.getMessage());
            }
        }

        // 4. In-memory Geodesic Haversine fallback (e.g. unit tests or H2 profile)
        double distKm = GeoUtils.distanceKm(
                srcCam.getLatitude(), srcCam.getLongitude(),
                candCam.getLatitude(), candCam.getLongitude()
        );
        return new DistanceResult(distKm, "GEODESIC_HAVERSINE", null, null, false, hasUnverifiedEdge, null);
    }

    private boolean isInvalidCoordinate(double lat, double lon) {
        return (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4) || lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0;
    }

    private FeasibilityResult evaluateFeasibility(
            DistanceResult dist,
            Double dtSec,
            double maxSpeedKmh,
            double maxTimeWindowSec,
            String srcCamId,
            String candCamId) {

        if (dist.distanceKm() == null || "UNKNOWN_COORDINATES".equals(dist.method())) {
            String errorDetail = "SOURCE_COORDINATES_MISSING".equals(dist.coordinateError())
                    ? String.format("Missing or unconfigured source camera coordinates for %s; cannot determine physical distance.", srcCamId)
                    : String.format("Missing or unconfigured destination camera coordinates for %s; cannot determine physical distance.", candCamId);
            return new FeasibilityResult("FEASIBILITY_UNKNOWN", null, errorDetail);
        }

        if (dtSec == null) {
            return new FeasibilityResult(
                    "FEASIBILITY_UNKNOWN",
                    null,
                    "Missing detection timestamp; cannot evaluate temporal feasibility."
            );
        }

        double distKm = dist.distanceKm();

        // Rule 1: Verified calibrated road edge
        if (dist.isVerified() && dist.minSec() != null && dist.maxSec() != null) {
            if (dtSec < dist.minSec()) {
                double speed = (dtSec > 0) ? (distKm / (dtSec / 3600.0)) : 9999.0;
                return new FeasibilityResult(
                        "IMPOSSIBLE_TRANSITION",
                        speed,
                        String.format("Travel time (%.1fs) is less than verified minimum road travel time (%.1fs) for corridor %s->%s.", dtSec, dist.minSec(), srcCamId, candCamId)
                );
            }
            if (dtSec > dist.maxSec()) {
                double speed = distKm / (dtSec / 3600.0);
                return new FeasibilityResult(
                        "EXCEEDS_TIME_WINDOW",
                        speed,
                        String.format("Travel time (%.1fs) exceeds maximum tracking window (%.1fs) for verified corridor %s->%s.", dtSec, dist.maxSec(), srcCamId, candCamId)
                );
            }
            double speed = (dtSec > 0) ? (distKm / (dtSec / 3600.0)) : 0.0;
            return new FeasibilityResult(
                    "FEASIBLE",
                    speed,
                    String.format("Transition feasible along verified road network (%.2f km, dt=%.1fs, speed=%.1f km/h).", distKm, dtSec, speed)
            );
        }

        // Rule 2: Geodesic evaluation for unverified edges or camera pairs with no configured connectivity
        // Simultaneous sightings at distant cameras
        if (dtSec <= 0.1 && distKm > 0.05) {
            return new FeasibilityResult(
                    "IMPOSSIBLE_TRANSITION",
                    9999.0,
                    String.format("Simultaneous sightings at geographically separated cameras (dist=%.2f km, dt=%.2fs). Requires physically impossible speed.", distKm, dtSec)
            );
        }

        if (dtSec > maxTimeWindowSec) {
            double speed = distKm / (dtSec / 3600.0);
            return new FeasibilityResult(
                    "EXCEEDS_TIME_WINDOW",
                    speed,
                    String.format("Time elapsed (%.1fs) exceeds maximum search window (%.1fs).", dtSec, maxTimeWindowSec)
            );
        }

        double hours = dtSec / 3600.0;
        double speed = (hours > 0) ? (distKm / hours) : 9999.0;

        if (speed > maxSpeedKmh) {
            return new FeasibilityResult(
                    "IMPOSSIBLE_TRANSITION",
                    speed,
                    String.format("Apparent travel speed (%.1f km/h) exceeds maximum plausible limit (%.1f km/h) over geodesic distance %.2f km in %.1fs.", speed, maxSpeedKmh, distKm, dtSec)
            );
        }

        // State whether this edge was unverified or had no configured connectivity
        String connectivityNote = dist.hasUnverifiedEdge()
                ? String.format("road connectivity between %s and %s is unverified; uncalibrated estimate excluded from travel-time gating", srcCamId, candCamId)
                : String.format("no road connectivity configured between %s and %s; evaluated via geodesic lower bound", srcCamId, candCamId);

        return new FeasibilityResult(
                "FEASIBLE",
                speed,
                String.format("Transition is physically plausible under geodesic bounds: distance=%.2f km, dt=%.1fs, apparent_speed=%.1f km/h (%s).",
                        distKm, dtSec, speed, connectivityNote)
        );
    }

    private ModelCompatibilityResult evaluateModelCompatibility(
            String srcModel, String srcVer, Integer srcDim, double[] srcVec,
            String candModel, String candVer, Integer candDim, double[] candVec) {

        if (srcVec == null || candVec == null || srcVec.length == 0 || candVec.length == 0) {
            return new ModelCompatibilityResult("NO_EMBEDDING", null);
        }

        // Strict model provenance compatibility check:
        // Do not compare embeddings generated by different models or different latent dimensions
        boolean modelsMatch = Objects.equals(srcModel, candModel) &&
                Objects.equals(srcVer, candVer) &&
                Objects.equals(srcDim, candDim) &&
                srcDim != null && srcDim > 0;

        if (!modelsMatch) {
            log.debug("Incompatible Re-ID embeddings: [{} v{}] vs [{} v{}]. Comparison rejected.",
                    srcModel, srcVer, candModel, candVer);
            return new ModelCompatibilityResult("INCOMPATIBLE_MODEL_VERSION", null);
        }

        if (srcVec.length != candVec.length) {
            return new ModelCompatibilityResult("INCOMPATIBLE_MODEL_VERSION", null);
        }

        double dot = 0.0;
        double normSrc = 0.0;
        double normCand = 0.0;
        for (int i = 0; i < srcVec.length; i++) {
            dot += srcVec[i] * candVec[i];
            normSrc += srcVec[i] * srcVec[i];
            normCand += candVec[i] * candVec[i];
        }

        double sim = 0.0;
        if (normSrc > 1e-12 && normCand > 1e-12) {
            sim = dot / (Math.sqrt(normSrc) * Math.sqrt(normCand));
            sim = Math.max(0.0, Math.min(1.0, sim));
        }

        return new ModelCompatibilityResult("COMPATIBLE", sim);
    }

    private double[] parseEmbeddingVector(String embeddingStr) {
        if (embeddingStr == null || embeddingStr.isBlank()) {
            return null;
        }
        try {
            String cleaned = embeddingStr.trim();
            if (cleaned.startsWith("[")) {
                cleaned = cleaned.substring(1);
            }
            if (cleaned.endsWith("]")) {
                cleaned = cleaned.substring(0, cleaned.length() - 1);
            }
            if (cleaned.isBlank()) {
                return null;
            }
            String[] parts = cleaned.split(",");
            double[] vec = new double[parts.length];
            for (int i = 0; i < parts.length; i++) {
                vec[i] = Double.parseDouble(parts[i].trim());
            }
            return vec;
        } catch (Exception e) {
            log.debug("Failed to parse embedding vector: {}", e.getMessage());
            return null;
        }
    }

    private record DistanceResult(
            Double distanceKm,
            String method,
            Double minSec,
            Double maxSec,
            boolean isVerified,
            boolean hasUnverifiedEdge,
            String coordinateError
    ) {}
    private record FeasibilityResult(String feasibility, Double apparentSpeedKmh, String reason) {}
    private record ModelCompatibilityResult(String compatibility, Double visualSimilarity) {}
}

