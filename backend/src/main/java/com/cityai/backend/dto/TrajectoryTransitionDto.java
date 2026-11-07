package com.cityai.backend.dto;

import java.time.Instant;

/**
 * Spatial-temporal transition between two consecutive trajectory observations.
 *
 * Separates physical plausibility (FEASIBLE / IMPOSSIBLE / FEASIBILITY_UNKNOWN)
 * from verified road network connectivity:
 *   - connectivity: VERIFIED_ROAD_EDGE, UNVERIFIED_GEODESIC, SAME_CAMERA, UNKNOWN
 *   - isVerifiedTopology: true ONLY for calibrated, verified road edges (never true for same-camera or geodesic)
 */
public record TrajectoryTransitionDto(
        Long fromDetectionId,
        Long toDetectionId,
        String fromCameraId,
        String toCameraId,
        Instant fromTimestamp,
        Instant toTimestamp,
        Double deltaSeconds,
        Double distanceKm,
        String distanceMethod,
        String connectivity, // VERIFIED_ROAD_EDGE, UNVERIFIED_GEODESIC, SAME_CAMERA, UNKNOWN
        boolean isVerifiedTopology,
        Double apparentSpeedKmh,
        String status, // FEASIBLE, IMPOSSIBLE, FEASIBILITY_UNKNOWN
        String reason
) {}
