package com.cityai.backend.dto;

import java.util.List;
import java.util.UUID;

/**
 * Trajectory Evidence Reliability and Quality Assessment for a Global Vehicle Identity.
 *
 * Exposes explicit, multidimensional evidence indicators rather than an uncalibrated accuracy percentage.
 * Categories represent evidence quality tiers, NOT statistical probabilities:
 *   - HIGH_CONFIDENCE
 *   - MEDIUM_CONFIDENCE
 *   - LOW_CONFIDENCE
 *   - INSUFFICIENT_EVIDENCE
 */
public record TrajectoryQualityDto(
        UUID globalIdentityId,
        String label,
        String overallQuality, // HIGH_CONFIDENCE, MEDIUM_CONFIDENCE, LOW_CONFIDENCE, INSUFFICIENT_EVIDENCE
        String summary,
        boolean isCrossCameraConfirmed,
        boolean hasImpossibleTransitions,
        boolean hasContradictions,
        TrajectoryQualityCountsDto counts,
        TrajectoryDimensionsDto dimensions,
        List<String> supportingEvidence,
        List<String> missingEvidence,
        List<String> warningsAndContradictions
) {

    public record TrajectoryQualityCountsDto(
            int totalObservations,
            int confirmedObservations,
            int uncertainObservations,
            int excludedObservations,
            int distinctCameraCount,
            int totalTransitions,
            int feasibleTransitions,
            int impossibleTransitions,
            int unknownFeasibilityTransitions,
            int verifiedRoadTransitions,
            int unverifiedGeodesicTransitions,
            int sameCameraTransitions
    ) {}

    public record TrajectoryDimensionsDto(
            IdentityQualityDimensionDto identityMembership,
            DetectionQualityDimensionDto detectionConfidence,
            PlateQualityDimensionDto ocrAndPlateConsistency,
            ReidQualityDimensionDto reidSimilarity,
            SpatialTemporalQualityDimensionDto spatialTemporalFeasibility,
            CompletenessQualityDimensionDto evidenceCompleteness
    ) {}

    public record IdentityQualityDimensionDto(
            String status, // CONFIRMED, UNCONFIRMED, HAS_EXCLUSIONS, CONFLICTED, INSUFFICIENT_DATA
            int confirmedCount,
            int excludedCount,
            List<String> reviewStatusesSeen,
            String summary
    ) {}

    public record DetectionQualityDimensionDto(
            String status, // HIGH, ACCEPTABLE, LOW, INSUFFICIENT_DATA
            Double minConfidence,
            Double avgConfidence,
            Double maxConfidence,
            int lowConfidenceCount,
            String summary
    ) {}

    public record PlateQualityDimensionDto(
            String status, // CONSISTENT, CONTRADICTORY, SINGLE_READING, NO_READINGS
            List<String> platesSeen,
            Double minPlateConfidence,
            Double avgPlateConfidence,
            String summary
    ) {}

    public record ReidQualityDimensionDto(
            String status, // HIGH_SIMILARITY, MODERATE_SIMILARITY, LOW_SIMILARITY, MISSING_EVIDENCE
            boolean isAvailable,
            Double minScore,
            Double avgScore,
            Double maxScore,
            String modelName,
            String summary
    ) {}

    public record SpatialTemporalQualityDimensionDto(
            String status, // VERIFIED_ROAD_NETWORK, PLAUSIBLE_GEODESIC, CONTAINS_IMPOSSIBLE_TRANSITIONS, FEASIBILITY_UNKNOWN, SINGLE_POINT_OR_SAME_CAMERA, EMPTY
            int distinctCameras,
            int verifiedRoadEdges,
            int unverifiedGeodesics,
            int sameCameraTransitions,
            int impossibleTransitions,
            int unknownTransitions,
            String summary
    ) {}

    public record CompletenessQualityDimensionDto(
            String status, // COMPLETE, PARTIAL, INSUFFICIENT
            int missingTimestampsCount,
            int missingCoordinatesCount,
            int missingReidCount,
            int missingPlateCount,
            String summary
    ) {}
}

