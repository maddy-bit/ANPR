package com.cityai.backend.dto;

import java.time.Instant;
import java.util.List;

/**
 * Continuous feasible segment of a vehicle trajectory.
 *
 * Explicitly documents segment semantics:
 *   - segmentType:
 *       * "VERIFIED_ROAD_CONNECTED_PATH": Every transition is backed by a verified road network edge.
 *       * "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE": Consecutive sightings are physically feasible, but
 *         transitions are unverified geodesic approximations or stationary sightings, NOT proven road routes.
 *   - isFullyVerifiedRoadRoute: true only if all transitions in this segment are VERIFIED_ROAD_EDGE.
 */
public record TrajectorySegmentDto(
        int segmentIndex,
        String segmentType, // VERIFIED_ROAD_CONNECTED_PATH or PLAUSIBLE_CHRONOLOGICAL_SEQUENCE
        boolean isFullyVerifiedRoadRoute,
        int observationCount,
        Long startObservationId,
        Long endObservationId,
        Instant startTime,
        Instant endTime,
        Double durationSeconds,
        Double totalDistanceKm,
        List<TrajectoryObservationDto> observations,
        String breakReason
) {}
