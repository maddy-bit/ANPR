package com.cityai.backend.repository;

import com.cityai.backend.model.VideoUpload;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.Optional;
import java.util.UUID;

@Repository
public interface VideoUploadRepository extends JpaRepository<VideoUpload, UUID> {

    Page<VideoUpload> findAllByOrderByCreatedAtDesc(Pageable pageable);

    Page<VideoUpload> findByStatusOrderByCreatedAtDesc(String status, Pageable pageable);

    Page<VideoUpload> findByCamera_IdOrderByCreatedAtDesc(String cameraId, Pageable pageable);

    Optional<VideoUpload> findByStorageKey(String storageKey);

    Optional<VideoUpload> findBySha256Hash(String sha256Hash);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT v FROM VideoUpload v WHERE v.id = :id")
    Optional<VideoUpload> findByIdForUpdate(@Param("id") UUID id);
}
