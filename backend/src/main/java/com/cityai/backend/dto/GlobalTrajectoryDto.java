package com.cityai.backend.dto;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * Complete reconstructed trajectory for a Global Vehicle Identity.
 */
public record GlobalTrajectoryDto(
        UUID globalIdentityId,
        String label,
        String primaryPlate,
        String vehicleClass,
        String reviewStatus,
        int totalObservations,
        int confirmedObservations,
        int excludedObservations,
        int segmentCount,
        boolean hasImpossibleTransitions,
        boolean hasUnknownFeasibility,
        Double totalFeasibleDistanceKm,
        Double totalDurationSeconds,
        Instant firstSeenTimestamp,
        Instant lastSeenTimestamp,
        List<TrajectoryObservationDto> observations,
        List<TrajectoryTransitionDto> transitions,
        List<TrajectorySegmentDto> segments
) {}

