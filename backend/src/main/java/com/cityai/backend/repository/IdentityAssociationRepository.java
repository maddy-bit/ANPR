package com.cityai.backend.repository;

import com.cityai.backend.model.IdentityAssociation;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface IdentityAssociationRepository extends JpaRepository<IdentityAssociation, UUID> {

    Optional<IdentityAssociation> findBySourceDetection_IdAndCandidateDetection_Id(Long sourceId, Long candidateId);

    @EntityGraph(attributePaths = {"sourceDetection", "candidateDetection", "globalIdentity"})
    Page<IdentityAssociation> findByGlobalIdentity_IdOrderByCreatedAtDesc(UUID globalIdentityId, Pageable pageable);

    @EntityGraph(attributePaths = {"sourceDetection", "candidateDetection", "globalIdentity"})
    List<IdentityAssociation> findByGlobalIdentity_IdOrderByCreatedAtDesc(UUID globalIdentityId);

    Page<IdentityAssociation> findByReviewStatus(String reviewStatus, Pageable pageable);

    List<IdentityAssociation> findBySourceDetection_IdOrCandidateDetection_Id(Long id1, Long id2);
}

