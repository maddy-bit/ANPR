package com.cityai.backend.repository;

import com.cityai.backend.model.VehicleDetection;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

public interface VehicleDetectionRepository extends JpaRepository<VehicleDetection, Long> {

    List<VehicleDetection> findByVehicle_PlateOrderByTimestampAsc(String plate);

    List<VehicleDetection> findByVehicle_PlateAndTimestampBetweenOrderByTimestampAsc(
            String plate, Instant start, Instant end);

    List<VehicleDetection> findByCamera_IdOrderByTimestampDesc(String cameraId);

    List<VehicleDetection> findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(
            Instant start, Instant end, String cameraId);

    Page<VehicleDetection> findByVideoUpload_IdOrderByTimestampAsc(UUID videoUploadId, Pageable pageable);

    List<VehicleDetection> findByVideoUpload_IdOrderByTimestampAsc(UUID videoUploadId);

    @EntityGraph(attributePaths = {"camera"})
    Page<VehicleDetection> findByGlobalIdentity_IdOrderByTimestampAsc(UUID globalIdentityId, Pageable pageable);

    @EntityGraph(attributePaths = {"camera"})
    List<VehicleDetection> findByGlobalIdentity_IdOrderByTimestampAsc(UUID globalIdentityId);

    @Modifying
    @Transactional
    void deleteByVideoUpload_Id(UUID videoUploadId);

    long countByVideoUpload_Id(UUID videoUploadId);
}
