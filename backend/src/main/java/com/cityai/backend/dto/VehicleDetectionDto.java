package com.cityai.backend.dto;

import com.cityai.backend.model.VehicleDetection;
import java.time.Instant;
import java.util.UUID;

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
        Integer reidDimension
) {
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
                reidEmbedding, videoUploadId, bbox, null, null, null);
    }

    public static VehicleDetectionDto from(VehicleDetection d) {
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
                d.getReidDimension()
        );
    }
}
