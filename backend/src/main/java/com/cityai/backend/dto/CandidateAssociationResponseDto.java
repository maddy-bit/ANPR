package com.cityai.backend.dto;

import java.time.Instant;
import java.util.List;

/**
 * Result payload containing all candidate detections evaluated against a source detection.
 */
public record CandidateAssociationResponseDto(
        Long sourceDetectionId,
        String sourceCameraId,
        Instant sourceTimestamp,
        String sourcePlateTextNormalized,
        String sourceReidModelName,
        String sourceReidModelVersion,
        Integer totalCandidatesEvaluated,
        Integer feasibleCandidatesCount,
        List<CandidateDetectionDto> candidates
) {
}

