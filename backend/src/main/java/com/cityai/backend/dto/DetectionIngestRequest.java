package com.cityai.backend.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * One detection event as produced by the AI service's video pipeline
 * (see ai-service/schemas.py DetectionEvent) and posted to POST /api/detections/ingest/batch.
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
        List<Double> reidEmbedding,
        UUID videoUploadId,
        List<Double> bbox,
        String reidModelName,
        String reidModelVersion,
        Integer reidDimension
) {
    /**
     * Backward-compatible 14-parameter constructor for existing A1-A4 callers.
     */
    public DetectionIngestRequest(
            String cameraId,
            Instant timestamp,
            String vehicleClass,
            Double detectionConfidence,
            String plateTextRaw,
            String plateTextNormalized,
            Double plateConfidence,
            Integer trackId,
            Integer frameNumber,
            String imagePath,
            Double reidConfidence,
            List<Double> reidEmbedding,
            UUID videoUploadId,
            List<Double> bbox
    ) {
        this(cameraId, timestamp, vehicleClass, detectionConfidence,
                plateTextRaw, plateTextNormalized, plateConfidence,
                trackId, frameNumber, imagePath, reidConfidence, reidEmbedding,
                videoUploadId, bbox, null, null, null);
    }
}
