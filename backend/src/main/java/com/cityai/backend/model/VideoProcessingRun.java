package com.cityai.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.Objects;
import java.util.UUID;

/**
 * Tracks an execution run of the AI inference pipeline for a VideoUpload evidence file.
 * Each run is uniquely numbered per video upload (1, 2, ...).
 * Detections produced during this run are tagged with this run's ID and preserved permanently.
 */
@Entity
@Table(
        name = "video_processing_runs",
        uniqueConstraints = {
                @UniqueConstraint(name = "uk_processing_run_video_run_number", columnNames = {"video_upload_id", "run_number"}),
                @UniqueConstraint(name = "uk_processing_run_upload_client_token", columnNames = {"video_upload_id", "client_run_token"})
        },
        indexes = {
                @Index(name = "idx_processing_runs_upload", columnList = "video_upload_id"),
                @Index(name = "idx_processing_runs_status", columnList = "status"),
                @Index(name = "idx_processing_runs_upload_gen", columnList = "video_upload_id, generation")
        }
)
public class VideoProcessingRun {

    @Id
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "video_upload_id", nullable = false)
    private VideoUpload videoUpload;

    @Column(name = "run_number", nullable = false)
    private Integer runNumber;

    @Column(nullable = false, length = 50)
    private String status;

    @Column(nullable = false)
    private Integer generation;

    @Column(name = "client_run_token", length = 128)
    private String clientRunToken;

    @Column(name = "frame_stride")
    private Integer frameStride;

    @Column(name = "enable_dehaze")
    private Boolean enableDehaze;

    @Column(name = "config_hash", nullable = false, length = 64)
    private String configHash;

    @Column(name = "config_status", nullable = false, length = 30)
    private String configStatus;

    @Column(name = "started_at", nullable = false)
    private Instant startedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    @Column(name = "frames_processed")
    private Integer framesProcessed;

    @Column(name = "detections_count")
    private Integer detectionsCount;

    @Column(name = "manifest_path", length = 500)
    private String manifestPath;

    @Column(name = "manifest_sha256", length = 64)
    private String manifestSha256;

    @Column(name = "failure_reason", columnDefinition = "TEXT")
    private String failureReason;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected VideoProcessingRun() {
        // JPA default constructor
    }

    public VideoProcessingRun(UUID id, VideoUpload videoUpload, Integer runNumber, String status, Instant startedAt) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.videoUpload = Objects.requireNonNull(videoUpload, "videoUpload must not be null");
        this.runNumber = Objects.requireNonNull(runNumber, "runNumber must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.startedAt = Objects.requireNonNull(startedAt, "startedAt must not be null");
        this.generation = runNumber;
        this.configStatus = "LEGACY_UNVERIFIED";
        this.configHash = "legacy:unverified";
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    public VideoProcessingRun(
            UUID id,
            VideoUpload videoUpload,
            Integer runNumber,
            String status,
            Integer generation,
            String clientRunToken,
            Integer frameStride,
            Boolean enableDehaze,
            String configHash,
            String configStatus,
            Instant startedAt
    ) {
        this.id = Objects.requireNonNull(id, "id must not be null");
        this.videoUpload = Objects.requireNonNull(videoUpload, "videoUpload must not be null");
        this.runNumber = Objects.requireNonNull(runNumber, "runNumber must not be null");
        this.status = Objects.requireNonNull(status, "status must not be null");
        this.generation = Objects.requireNonNull(generation, "generation must not be null");
        this.clientRunToken = clientRunToken;
        this.frameStride = frameStride;
        this.enableDehaze = enableDehaze;
        this.configHash = Objects.requireNonNull(configHash, "configHash must not be null");
        this.configStatus = Objects.requireNonNull(configStatus, "configStatus must not be null");
        this.startedAt = Objects.requireNonNull(startedAt, "startedAt must not be null");
        this.createdAt = Instant.now();
        this.updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public VideoUpload getVideoUpload() {
        return videoUpload;
    }

    public void setVideoUpload(VideoUpload videoUpload) {
        this.videoUpload = videoUpload;
    }

    public Integer getRunNumber() {
        return runNumber;
    }

    public void setRunNumber(Integer runNumber) {
        this.runNumber = runNumber;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Integer getGeneration() {
        return generation;
    }

    public void setGeneration(Integer generation) {
        this.generation = generation;
    }

    public String getClientRunToken() {
        return clientRunToken;
    }

    public void setClientRunToken(String clientRunToken) {
        this.clientRunToken = clientRunToken;
    }

    public Integer getFrameStride() {
        return frameStride;
    }

    public void setFrameStride(Integer frameStride) {
        this.frameStride = frameStride;
    }

    public Boolean getEnableDehaze() {
        return enableDehaze;
    }

    public void setEnableDehaze(Boolean enableDehaze) {
        this.enableDehaze = enableDehaze;
    }

    public String getConfigHash() {
        return configHash;
    }

    public void setConfigHash(String configHash) {
        this.configHash = configHash;
    }

    public String getConfigStatus() {
        return configStatus;
    }

    public void setConfigStatus(String configStatus) {
        this.configStatus = configStatus;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public void setStartedAt(Instant startedAt) {
        this.startedAt = startedAt;
    }

    public Instant getCompletedAt() {
        return completedAt;
    }

    public void setCompletedAt(Instant completedAt) {
        this.completedAt = completedAt;
    }

    public Integer getFramesProcessed() {
        return framesProcessed;
    }

    public void setFramesProcessed(Integer framesProcessed) {
        this.framesProcessed = framesProcessed;
    }

    public Integer getDetectionsCount() {
        return detectionsCount;
    }

    public void setDetectionsCount(Integer detectionsCount) {
        this.detectionsCount = detectionsCount;
    }

    public String getManifestPath() {
        return manifestPath;
    }

    public void setManifestPath(String manifestPath) {
        this.manifestPath = manifestPath;
    }

    public String getManifestSha256() {
        return manifestSha256;
    }

    public void setManifestSha256(String manifestSha256) {
        this.manifestSha256 = manifestSha256;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(Instant createdAt) {
        this.createdAt = createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public boolean isCompleted() {
        return "COMPLETED".equalsIgnoreCase(this.status);
    }

    public boolean isFailed() {
        return "FAILED".equalsIgnoreCase(this.status);
    }

    public boolean isAbandoned() {
        return "ABANDONED".equalsIgnoreCase(this.status);
    }

    public boolean isTerminal() {
        return isCompleted() || isFailed() || isAbandoned();
    }
}
