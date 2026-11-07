package com.cityai.backend.dto;

import com.cityai.backend.model.VideoUpload;
import java.time.Instant;
import java.util.UUID;

public record VideoUploadDto(
        UUID id,
        String originalFilename,
        String storageKey,
        String storageProvider,
        String mimeType,
        long fileSize,
        String status,
        String cameraId,
        Instant createdAt,
        Instant updatedAt,
        String failureReason,
        String sha256Hash,
        Integer framesProcessed,
        Integer detectionsCount,
        Double processingDurationSec
) {
    public VideoUploadDto(
            UUID id,
            String originalFilename,
            String storageKey,
            String storageProvider,
            String mimeType,
            long fileSize,
            String status,
            String cameraId,
            Instant createdAt,
            Instant updatedAt,
            String failureReason,
            String sha256Hash
    ) {
        this(id, originalFilename, storageKey, storageProvider, mimeType, fileSize, status, cameraId, createdAt, updatedAt, failureReason, sha256Hash, null, null, null);
    }

    public static VideoUploadDto from(VideoUpload entity) {
        return new VideoUploadDto(
                entity.getId(),
                entity.getOriginalFilename(),
                entity.getStorageKey(),
                entity.getStorageProvider(),
                entity.getMimeType(),
                entity.getFileSize(),
                entity.getStatus(),
                entity.getCamera() != null ? entity.getCamera().getId() : null,
                entity.getCreatedAt(),
                entity.getUpdatedAt(),
                entity.getFailureReason(),
                entity.getSha256Hash(),
                entity.getFramesProcessed(),
                entity.getDetectionsCount(),
                entity.getProcessingDurationSec()
        );
    }
}
