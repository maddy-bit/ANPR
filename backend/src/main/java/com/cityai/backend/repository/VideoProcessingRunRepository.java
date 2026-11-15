package com.cityai.backend.repository;

import com.cityai.backend.model.VideoProcessingRun;
import jakarta.persistence.LockModeType;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

/**
 * Spring Data JPA repository for persisting and querying VideoProcessingRun records.
 */
@Repository
public interface VideoProcessingRunRepository extends JpaRepository<VideoProcessingRun, UUID> {

    List<VideoProcessingRun> findByVideoUpload_IdOrderByRunNumberDesc(UUID videoUploadId);

    Optional<VideoProcessingRun> findTopByVideoUpload_IdOrderByRunNumberDesc(UUID videoUploadId);

    Optional<VideoProcessingRun> findByVideoUpload_IdAndRunNumber(UUID videoUploadId, Integer runNumber);

    Optional<VideoProcessingRun> findByVideoUpload_IdAndClientRunToken(UUID videoUploadId, String clientRunToken);

    Optional<VideoProcessingRun> findByVideoUpload_IdAndStatusIn(UUID videoUploadId, Collection<String> statuses);

    List<VideoProcessingRun> findByVideoUpload_IdOrderByGenerationDesc(UUID videoUploadId);

    Optional<VideoProcessingRun> findTopByVideoUpload_IdOrderByGenerationDesc(UUID videoUploadId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT r FROM VideoProcessingRun r WHERE r.id = :id")
    Optional<VideoProcessingRun> findByIdForUpdate(@Param("id") UUID id);
}
