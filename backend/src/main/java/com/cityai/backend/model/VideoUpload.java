package com.cityai.backend.model;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

/**
 * Persisted metadata for uploaded CCTV video evidence files.
 * The video binary itself is never stored in the relational database;
 * it is durably persisted via the configured StorageService (Local or Supabase),
 * while this entity tracks the lifecycle, storage key, provider, size, and camera association.
 */
@Entity
@Table(name = "video_uploads", indexes = {
        @Index(name = "idx_video_uploads_status", columnList = "status"),
        @Index(name = "idx_video_uploads_camera", columnList = "camera_id"),
        @Index(name = "idx_video_uploads_created_at", columnList = "created_at DESC")
})
public class VideoUpload {

    @Id
    private UUID id;

    @Column(name = "original_filename", nullable = false)
    private String originalFilename;

    @Column(name = "storage_key", nullable = false, unique = true, length = 500)
    private String storageKey;

    @Column(name = "storage_provider", nullable = false, length = 50)
    private String storageProvider;

    @Column(name = "mime_type", nullable = false, length = 100)
    private String mimeType;

    @Column(name = "file_size", nullable = false)
    private long fileSize;

    @Column(nullable = false, length = 50)
    private String status;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "camera_id")
    private Camera camera;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    @Column(name = "failure_reason", columnDefinition = "TEXT")
    private String failureReason;

    @Column(name = "sha256_hash", length = 64)
    private String sha256Hash;

    @Column(name = "frames_processed")
    private Integer framesProcessed;

    @Column(name = "detections_count")
    private Integer detectionsCount;

    @Column(name = "processing_duration_sec")
    private Double processingDurationSec;

    protected VideoUpload() {
        // JPA
    }

    public VideoUpload(
            UUID id,
            String originalFilename,
            String storageKey,
            String storageProvider,
            String mimeType,
            long fileSize,
            String status,
            Camera camera,
            Instant createdAt,
            Instant updatedAt,
            String failureReason,
            String sha256Hash
    ) {
        this.id = id;
        this.originalFilename = originalFilename;
        this.storageKey = storageKey;
        this.storageProvider = storageProvider;
        this.mimeType = mimeType;
        this.fileSize = fileSize;
        this.status = status;
        this.camera = camera;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.failureReason = failureReason;
        this.sha256Hash = sha256Hash;
    }

    public UUID getId() {
        return id;
    }

    public String getOriginalFilename() {
        return originalFilename;
    }

    public String getStorageKey() {
        return storageKey;
    }

    public String getStorageProvider() {
        return storageProvider;
    }

    public String getMimeType() {
        return mimeType;
    }

    public long getFileSize() {
        return fileSize;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }

    public Camera getCamera() {
        return camera;
    }

    public void setCamera(Camera camera) {
        this.camera = camera;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(Instant updatedAt) {
        this.updatedAt = updatedAt;
    }

    public String getFailureReason() {
        return failureReason;
    }

    public void setFailureReason(String failureReason) {
        this.failureReason = failureReason;
    }

    public String getSha256Hash() {
        return sha256Hash;
    }

    public void setSha256Hash(String sha256Hash) {
        this.sha256Hash = sha256Hash;
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

    public Double getProcessingDurationSec() {
        return processingDurationSec;
    }

    public void setProcessingDurationSec(Double processingDurationSec) {
        this.processingDurationSec = processingDurationSec;
    }
}
