package com.cityai.backend.dto;

import com.cityai.backend.model.VideoProcessingRun;
import java.time.Instant;
import java.util.UUID;

public record VideoProcessingRunDto(
        UUID id,
        UUID videoUploadId,
        Integer runNumber,
        String status,
        Integer generation,
        String clientRunToken,
        Integer frameStride,
        Boolean enableDehaze,
        String configHash,
        String configStatus,
        Instant startedAt,
        Instant completedAt,
        Integer framesProcessed,
        Integer detectionsCount,
        String manifestPath,
        String manifestSha256,
        String failureReason,
        Instant createdAt,
        Instant updatedAt
) {
    public static VideoProcessingRunDto from(VideoProcessingRun run) {
        if (run == null) {
            return null;
        }
        return new VideoProcessingRunDto(
                run.getId(),
                run.getVideoUpload() != null ? run.getVideoUpload().getId() : null,
                run.getRunNumber(),
                run.getStatus(),
                run.getGeneration(),
                run.getClientRunToken(),
                run.getFrameStride(),
                run.getEnableDehaze(),
                run.getConfigHash(),
                run.getConfigStatus(),
                run.getStartedAt(),
                run.getCompletedAt(),
                run.getFramesProcessed(),
                run.getDetectionsCount(),
                run.getManifestPath(),
                run.getManifestSha256(),
                run.getFailureReason(),
                run.getCreatedAt(),
                run.getUpdatedAt()
        );
    }
}

