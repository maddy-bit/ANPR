package com.cityai.backend.model;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.FetchType;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.JoinColumn;
import jakarta.persistence.ManyToOne;
import jakarta.persistence.Table;
import jakarta.persistence.UniqueConstraint;
import java.time.Instant;
import java.util.UUID;

/**
 * Audit trail and provenance record for a pairwise association decision between two detections.
 * Stores individual signal scores, decision, review status, and model metadata.
 */
@Entity
@Table(name = "identity_associations", uniqueConstraints = {
        @UniqueConstraint(name = "uk_identity_association_pair", columnNames = {"source_detection_id", "candidate_detection_id"})
})
public class IdentityAssociation {

    @Id
    @GeneratedValue(strategy = GenerationType.AUTO)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "source_detection_id", nullable = false)
    private VehicleDetection sourceDetection;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "candidate_detection_id", nullable = false)
    private VehicleDetection candidateDetection;

    @ManyToOne(fetch = FetchType.LAZY, optional = true)
    @JoinColumn(name = "global_identity_id")
    private GlobalIdentity globalIdentity;

    @Column(name = "reid_score")
    private Double reidScore;

    @Column(name = "plate_score")
    private Double plateScore;

    @Column(name = "attribute_score")
    private Double attributeScore;

    @Column(name = "topology_score")
    private Double topologyScore;

    @Column(name = "overall_score", nullable = false)
    private double overallScore;

    @Column(nullable = false, length = 50)
    private String decision; // MATCH, NO_MATCH, UNCERTAIN

    @Column(name = "decision_reason", nullable = false, columnDefinition = "TEXT")
    private String decisionReason;

    @Column(name = "review_status", nullable = false, length = 50)
    private String reviewStatus = "SYSTEM_DECIDED"; // SYSTEM_DECIDED, CONFIRMED_BY_USER, REJECTED_BY_USER, FLAGGED_CONFLICT, PENDING_REVIEW

    @Column(name = "review_notes", columnDefinition = "TEXT")
    private String reviewNotes;

    @Column(name = "reid_model_name", length = 100)
    private String reidModelName;

    @Column(name = "reid_model_version", length = 50)
    private String reidModelVersion;

    @Column(name = "created_at", insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected IdentityAssociation() {
        // JPA
    }

    public IdentityAssociation(
            VehicleDetection sourceDetection,
            VehicleDetection candidateDetection,
            GlobalIdentity globalIdentity,
            Double reidScore,
            Double plateScore,
            Double attributeScore,
            Double topologyScore,
            double overallScore,
            String decision,
            String decisionReason,
            String reidModelName,
            String reidModelVersion) {
        this.sourceDetection = sourceDetection;
        this.candidateDetection = candidateDetection;
        this.globalIdentity = globalIdentity;
        this.reidScore = reidScore;
        this.plateScore = plateScore;
        this.attributeScore = attributeScore;
        this.topologyScore = topologyScore;
        this.overallScore = overallScore;
        this.decision = decision;
        this.decisionReason = decisionReason;
        this.reidModelName = reidModelName;
        this.reidModelVersion = reidModelVersion;
        this.reviewStatus = "MATCH".equals(decision) ? "SYSTEM_DECIDED" : ("UNCERTAIN".equals(decision) ? "PENDING_REVIEW" : "SYSTEM_DECIDED");
        this.updatedAt = Instant.now();
    }

    public UUID getId() {
        return id;
    }

    public void setId(UUID id) {
        this.id = id;
    }

    public VehicleDetection getSourceDetection() {
        return sourceDetection;
    }

    public VehicleDetection getCandidateDetection() {
        return candidateDetection;
    }

    public GlobalIdentity getGlobalIdentity() {
        return globalIdentity;
    }

    public void setGlobalIdentity(GlobalIdentity globalIdentity) {
        this.globalIdentity = globalIdentity;
    }

    public Double getReidScore() {
        return reidScore;
    }

    public Double getPlateScore() {
        return plateScore;
    }

    public Double getAttributeScore() {
        return attributeScore;
    }

    public Double getTopologyScore() {
        return topologyScore;
    }

    public double getOverallScore() {
        return overallScore;
    }

    public String getDecision() {
        return decision;
    }

    public void setDecision(String decision) {
        this.decision = decision;
    }

    public String getDecisionReason() {
        return decisionReason;
    }

    public void setDecisionReason(String decisionReason) {
        this.decisionReason = decisionReason;
    }

    public String getReviewStatus() {
        return reviewStatus;
    }

    public void setReviewStatus(String reviewStatus) {
        this.reviewStatus = reviewStatus;
    }

    public String getReviewNotes() {
        return reviewNotes;
    }

    public void setReviewNotes(String reviewNotes) {
        this.reviewNotes = reviewNotes;
    }

    public String getReidModelName() {
        return reidModelName;
    }

    public String getReidModelVersion() {
        return reidModelVersion;
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

