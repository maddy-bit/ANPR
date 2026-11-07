package com.cityai.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

/**
 * A persistent global physical vehicle identity across multi-camera network sightings.
 * Established via multi-signal association (FastReID, OCR, topology, attributes).
 */
@Entity
@Table(name = "global_identities")
public class GlobalIdentity {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @Column(nullable = false, unique = true, length = 100)
    private String label;

    @Column(name = "primary_plate", length = 32)
    private String primaryPlate;

    @Column(name = "plate_confidence")
    private Double plateConfidence;

    @Column(name = "vehicle_class", length = 50)
    private String vehicleClass;

    @Column(length = 50)
    private String color;

    @Column(length = 100)
    private String make;

    @Column(length = 100)
    private String model;

    @Column(name = "representative_reid_embedding", columnDefinition = "TEXT")
    private String representativeReidEmbedding;

    @Column(name = "reid_model_name", length = 100)
    private String reidModelName;

    @Column(name = "reid_model_version", length = 50)
    private String reidModelVersion;

    @Column(name = "reid_dimension")
    private Integer reidDimension;

    @Column(name = "review_status", nullable = false, length = 50)
    private String reviewStatus = "ACTIVE";

    @Column(name = "conflict_notes", columnDefinition = "TEXT")
    private String conflictNotes;

    @Column(name = "first_seen_timestamp", nullable = false)
    private Instant firstSeenTimestamp;

    @Column(name = "last_seen_timestamp", nullable = false)
    private Instant lastSeenTimestamp;

    @Column(name = "detection_count", nullable = false)
    private int detectionCount = 1;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected GlobalIdentity() {
        // JPA
    }

    public GlobalIdentity(
            String label,
            String primaryPlate,
            Double plateConfidence,
            String vehicleClass,
            String color,
            String make,
            String model,
            String representativeReidEmbedding,
            String reidModelName,
            String reidModelVersion,
            Integer reidDimension,
            Instant firstSeenTimestamp,
            Instant lastSeenTimestamp) {
        this.label = label;
        this.primaryPlate = primaryPlate;
        this.plateConfidence = plateConfidence;
        this.vehicleClass = vehicleClass;
        this.color = color;
        this.make = make;
        this.model = model;
        this.representativeReidEmbedding = representativeReidEmbedding;
        this.reidModelName = reidModelName;
        this.reidModelVersion = reidModelVersion;
        this.reidDimension = reidDimension;
        this.firstSeenTimestamp = firstSeenTimestamp;
        this.lastSeenTimestamp = lastSeenTimestamp;
        this.detectionCount = 1;
        this.reviewStatus = "ACTIVE";
        this.updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public String getLabel() {
        return label;
    }

    public void setLabel(String label) {
        this.label = label;
    }

    public String getPrimaryPlate() {
        return primaryPlate;
    }

    public void setPrimaryPlate(String primaryPlate) {
        this.primaryPlate = primaryPlate;
    }

    public Double getPlateConfidence() {
        return plateConfidence;
    }

    public void setPlateConfidence(Double plateConfidence) {
        this.plateConfidence = plateConfidence;
    }

    public String getVehicleClass() {
        return vehicleClass;
    }

    public void setVehicleClass(String vehicleClass) {
        this.vehicleClass = vehicleClass;
    }

    public String getColor() {
        return color;
    }

    public void setColor(String color) {
        this.color = color;
    }

    public String getMake() {
        return make;
    }

    public void setMake(String make) {
        this.make = make;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getRepresentativeReidEmbedding() {
        return representativeReidEmbedding;
    }

    public void setRepresentativeReidEmbedding(String representativeReidEmbedding) {
        this.representativeReidEmbedding = representativeReidEmbedding;
    }

    public String getReidModelName() {
        return reidModelName;
    }

    public void setReidModelName(String reidModelName) {
        this.reidModelName = reidModelName;
    }

    public String getReidModelVersion() {
        return reidModelVersion;
    }

    public void setReidModelVersion(String reidModelVersion) {
        this.reidModelVersion = reidModelVersion;
    }

    public Integer getReidDimension() {
        return reidDimension;
    }

    public void setReidDimension(Integer reidDimension) {
        this.reidDimension = reidDimension;
    }

    public String getReviewStatus() {
        return reviewStatus;
    }

    public void setReviewStatus(String reviewStatus) {
        this.reviewStatus = reviewStatus;
    }

    public String getConflictNotes() {
        return conflictNotes;
    }

    public void setConflictNotes(String conflictNotes) {
        this.conflictNotes = conflictNotes;
    }

    public Instant getFirstSeenTimestamp() {
        return firstSeenTimestamp;
    }

    public void setFirstSeenTimestamp(Instant firstSeenTimestamp) {
        this.firstSeenTimestamp = firstSeenTimestamp;
    }

    public Instant getLastSeenTimestamp() {
        return lastSeenTimestamp;
    }

    public void setLastSeenTimestamp(Instant lastSeenTimestamp) {
        this.lastSeenTimestamp = lastSeenTimestamp;
    }

    public int getDetectionCount() {
        return detectionCount;
    }

    public void setDetectionCount(int detectionCount) {
        this.detectionCount = detectionCount;
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
}

