package com.cityai.backend.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * Single chronologically ordered, geographically grounded observation in a vehicle trajectory.
 */
public record TrajectoryObservationDto(
        Long detectionId,
        UUID globalIdentityId,
        String cameraId,
        String cameraName,
        Instant timestamp,
        Double latitude,
        Double longitude,
        boolean hasCoordinates,
        String direction,
        Double speedKmh,
        String vehicleClass,
        Double detectionConfidence,
        String plateText,
        Double plateConfidence,
        Double reidConfidence,
        String imagePath,
        Integer trackId,
        Integer frameNumber,
        ObservationProvenanceDto provenance
) {
    public record ObservationProvenanceDto(
            UUID associationId,
            String associationDecision,
            String associationReviewStatus,
            Double reidScore,
            Double plateScore,
            boolean isSeedObservation
    ) {}
}

