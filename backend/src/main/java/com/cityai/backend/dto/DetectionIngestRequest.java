package com.cityai.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;

/**
 * One detection event as produced by the AI service's video pipeline
 * (see ai-service/schemas.py DetectionEvent) and posted to POST /api/detections/ingest.
 */
public record DetectionIngestRequest(
        @NotBlank String cameraId,
        @NotNull Instant timestamp,
        @NotBlank String vehicleClass,
        @NotNull Double detectionConfidence,
        String plateTextRaw,
        String plateTextNormalized,
        Double plateConfidence,
        Integer trackId,
        Integer frameNumber,
        String imagePath,
        Double reidConfidence,
        List<Double> reidEmbedding
) {
}
