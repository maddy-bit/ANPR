package com.cityai.backend.repository;

import com.cityai.backend.model.GlobalIdentity;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface GlobalIdentityRepository extends JpaRepository<GlobalIdentity, UUID> {

    Optional<GlobalIdentity> findByPrimaryPlate(String primaryPlate);

    Optional<GlobalIdentity> findByLabel(String label);

    Page<GlobalIdentity> findByReviewStatus(String reviewStatus, Pageable pageable);
}

