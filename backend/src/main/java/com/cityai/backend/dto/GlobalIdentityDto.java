package com.cityai.backend.dto;

import com.cityai.backend.model.GlobalIdentity;
import java.time.Instant;
import java.util.UUID;

public record GlobalIdentityDto(
        UUID id,
        String label,
        String primaryPlate,
        Double plateConfidence,
        String vehicleClass,
        String color,
        String make,
        String model,
        String reviewStatus,
        String conflictNotes,
        Instant firstSeenTimestamp,
        Instant lastSeenTimestamp,
        int detectionCount,
        String reidModelName,
        String reidModelVersion,
        Integer reidDimension
) {
    public static GlobalIdentityDto from(GlobalIdentity entity) {
        if (entity == null) {
            return null;
        }
        return new GlobalIdentityDto(
                entity.getId(),
                entity.getLabel(),
                entity.getPrimaryPlate(),
                entity.getPlateConfidence(),
                entity.getVehicleClass(),
                entity.getColor(),
                entity.getMake(),
                entity.getModel(),
                entity.getReviewStatus(),
                entity.getConflictNotes(),
                entity.getFirstSeenTimestamp(),
                entity.getLastSeenTimestamp(),
                entity.getDetectionCount(),
                entity.getReidModelName(),
                entity.getReidModelVersion(),
                entity.getReidDimension()
        );
    }
}

