package com.cityai.backend.dto;

import java.time.Instant;

/**
 * Representation of a cross-camera candidate detection evaluated for
 * spatial-temporal feasibility and Re-ID model compatibility.
 */
public record CandidateDetectionDto(
        Long detectionId,
        String cameraId,
        Instant timestamp,
        Double spatialDistanceKm,
        String distanceCalculationMethod,
        Double timeDifferenceSeconds,
        Double apparentSpeedKmh,
        String feasibility,
        String feasibilityReason,
        String reidModelCompatibility,
        Double visualSimilarity,
        String reidModelName,
        String reidModelVersion,
        Integer reidDimension,
        String plateTextNormalized,
        String vehicleClass,
        String imagePath
) {
}

