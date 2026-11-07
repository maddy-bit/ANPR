package com.cityai.backend.dto;

import com.cityai.backend.model.IdentityAssociation;
import java.time.Instant;
import java.util.UUID;

public record IdentityAssociationDto(
        UUID id,
        Long sourceDetectionId,
        Long candidateDetectionId,
        UUID globalIdentityId,
        Double reidScore,
        Double plateScore,
        Double attributeScore,
        Double topologyScore,
        double overallScore,
        String decision,
        String decisionReason,
        String reviewStatus,
        String reviewNotes,
        String reidModelName,
        String reidModelVersion,
        Instant createdAt
) {
    public static IdentityAssociationDto from(IdentityAssociation entity) {
        if (entity == null) {
            return null;
        }
        return new IdentityAssociationDto(
                entity.getId(),
                entity.getSourceDetection().getId(),
                entity.getCandidateDetection().getId(),
                entity.getGlobalIdentity() != null ? entity.getGlobalIdentity().getId() : null,
                entity.getReidScore(),
                entity.getPlateScore(),
                entity.getAttributeScore(),
                entity.getTopologyScore(),
                entity.getOverallScore(),
                entity.getDecision(),
                entity.getDecisionReason(),
                entity.getReviewStatus(),
                entity.getReviewNotes(),
                entity.getReidModelName(),
                entity.getReidModelVersion(),
                entity.getCreatedAt()
        );
    }
}

