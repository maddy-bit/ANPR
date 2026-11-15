package com.cityai.backend.dto;

import com.cityai.backend.model.VehicleDetection;
import com.fasterxml.jackson.annotation.JsonInclude;
import java.time.Instant;
import java.util.UUID;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record VehicleDetectionDto(
        Long id,
        String cameraId,
        String cameraName,
        Instant timestamp,
        double latitude,
        double longitude,
        String direction,
        Double speedKmh,
        String vehicleClass,
        Double detectionConfidence,
        String plateTextRaw,
        String plateTextNormalized,
        Double plateConfidence,
        Double reidConfidence,
        String imagePath,
        Integer trackId,
        Integer frameNumber,
        String reidEmbedding,
        UUID videoUploadId,
        String bbox,
        String reidModelName,
        String reidModelVersion,
        Integer reidDimension,
        String idempotencyKey,
        UUID processingRunId,
        String ingestionStatus
) {
    /**
     * Backward-compatible 23-parameter constructor.
     */
    public VehicleDetectionDto(
            Long id,
            String cameraId,
            String cameraName,
            Instant timestamp,
            double latitude,
            double longitude,
            String direction,
            Double speedKmh,
            String vehicleClass,
            Double detectionConfidence,
            String plateTextRaw,
            String plateTextNormalized,
            Double plateConfidence,
            Double reidConfidence,
            String imagePath,
            Integer trackId,
            Integer frameNumber,
            String reidEmbedding,
            UUID videoUploadId,
            String bbox,
            String reidModelName,
            String reidModelVersion,
            Integer reidDimension
    ) {
        this(id, cameraId, cameraName, timestamp, latitude, longitude,
                direction, speedKmh, vehicleClass, detectionConfidence,
                plateTextRaw, plateTextNormalized, plateConfidence,
                reidConfidence, imagePath, trackId, frameNumber,
                reidEmbedding, videoUploadId, bbox, reidModelName,
                reidModelVersion, reidDimension, null, null, null);
    }

    /**
     * Backward-compatible 20-parameter constructor for existing A1-A4 callers.
     */
    public VehicleDetectionDto(
            Long id,
            String cameraId,
            String cameraName,
            Instant timestamp,
            double latitude,
            double longitude,
            String direction,
            Double speedKmh,
            String vehicleClass,
            Double detectionConfidence,
            String plateTextRaw,
            String plateTextNormalized,
            Double plateConfidence,
            Double reidConfidence,
            String imagePath,
            Integer trackId,
            Integer frameNumber,
            String reidEmbedding,
            UUID videoUploadId,
            String bbox
    ) {
        this(id, cameraId, cameraName, timestamp, latitude, longitude,
                direction, speedKmh, vehicleClass, detectionConfidence,
                plateTextRaw, plateTextNormalized, plateConfidence,
                reidConfidence, imagePath, trackId, frameNumber,
                reidEmbedding, videoUploadId, bbox, null, null, null, null, null, null);
    }

    /**
     * For ordinary query endpoints (historical GETs): ingestionStatus is null and omitted from JSON.
     */
    public static VehicleDetectionDto from(VehicleDetection d) {
        return from(d, null);
    }

    /**
     * For ingestion endpoints: explicitly supplies ingestionStatus ("CREATED" or "DUPLICATE").
     */
    public static VehicleDetectionDto from(VehicleDetection d, String ingestionStatus) {
        return new VehicleDetectionDto(
                d.getId(),
                d.getCamera().getId(),
                d.getCamera().getName(),
                d.getTimestamp(),
                d.getLatitude(),
                d.getLongitude(),
                d.getDirection(),
                d.getSpeedKmh(),
                d.getVehicleClass(),
                d.getDetectionConfidence(),
                d.getPlateTextRaw(),
                d.getPlateTextNormalized(),
                d.getPlateConfidence(),
                d.getReidConfidence(),
                d.getImagePath(),
                d.getTrackId(),
                d.getFrameNumber(),
                d.getReidEmbedding(),
                d.getVideoUpload() != null ? d.getVideoUpload().getId() : null,
                d.getBbox(),
                d.getReidModelName(),
                d.getReidModelVersion(),
                d.getReidDimension(),
                d.getIdempotencyKey(),
                d.getProcessingRun() != null ? d.getProcessingRun().getId() : null,
                ingestionStatus
        );
    }
}
