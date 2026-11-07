package com.cityai.backend.service;

import com.cityai.backend.dto.DetectionIngestRequest;
import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.model.VideoUpload;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VehicleRepository;
import com.cityai.backend.repository.VideoUploadRepository;
import java.time.Instant;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Turns raw AI-pipeline output (DetectionIngestRequest) into stored
 * VehicleDetection rows, resolving/creating the Vehicle identity from a
 * successfully-read plate via VehicleRegistryService. Detections with no
 * readable plate are still stored (as unlinked evidence) rather than
 * dropped - see VehicleDetection's nullable vehicle field.
 */
@Service
public class DetectionIngestionService {

    private static final Logger log = LoggerFactory.getLogger(DetectionIngestionService.class);

    private final CameraRepository cameraRepository;
    private final VehicleRepository vehicleRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final VideoUploadRepository videoUploadRepository;
    private final CacheManager cacheManager;
    private final RedisPubSubService redisPubSubService;

    public DetectionIngestionService(
            CameraRepository cameraRepository,
            VehicleRepository vehicleRepository,
            VehicleDetectionRepository detectionRepository,
            VideoUploadRepository videoUploadRepository,
            CacheManager cacheManager,
            RedisPubSubService redisPubSubService) {
        this.cameraRepository = cameraRepository;
        this.vehicleRepository = vehicleRepository;
        this.detectionRepository = detectionRepository;
        this.videoUploadRepository = videoUploadRepository;
        this.cacheManager = cacheManager;
        this.redisPubSubService = redisPubSubService;
    }

    @Transactional
    public VehicleDetection ingest(DetectionIngestRequest request) {
        String cameraId = request.cameraId();
        if (cameraId == null) {
            throw new NoSuchElementException("Unknown camera: null");
        }
        Camera camera = cameraRepository.findById(cameraId)
                .orElseGet(() -> {
                    Camera newCam = new Camera(cameraId, "Camera " + cameraId, 0.0, 0.0, "N", "CONFIGURED", null);
                    return cameraRepository.save(newCam);
                });

        Vehicle vehicle = null;
        String normalizedPlate = request.plateTextNormalized();
        if (normalizedPlate != null && !normalizedPlate.isBlank()) {
            // Only associate with vehicle identity if OCR confidence is reliable (>= 0.30)
            if (request.plateConfidence() != null && request.plateConfidence() >= 0.30) {
                vehicle = resolveOrCreateVehicle(normalizedPlate);
            }
        }

        VideoUpload videoUpload = null;
        if (request.videoUploadId() != null) {
            videoUpload = videoUploadRepository.findById(Objects.requireNonNull(request.videoUploadId())).orElse(null);
        }

        VehicleDetection detection = new VehicleDetection(vehicle, camera, request.timestamp());
        detection.setVideoUpload(videoUpload);
        detection.setLatitude(camera.getLatitude());
        detection.setLongitude(camera.getLongitude());
        detection.setDirection(camera.getDirection());
        detection.setVehicleClass(request.vehicleClass());
        detection.setDetectionConfidence(request.detectionConfidence());
        detection.setPlateTextRaw(request.plateTextRaw());
        detection.setPlateTextNormalized(request.plateTextNormalized());
        detection.setPlateConfidence(request.plateConfidence());
        detection.setTrackId(request.trackId());
        detection.setFrameNumber(request.frameNumber());
        detection.setImagePath(request.imagePath());
        detection.setReidConfidence(request.reidConfidence());
        detection.setReidModelName(request.reidModelName());
        detection.setReidModelVersion(request.reidModelVersion());
        detection.setReidDimension(request.reidDimension());
        if (request.reidEmbedding() != null && !request.reidEmbedding().isEmpty()) {
            detection.setReidEmbedding(request.reidEmbedding().toString());
        }
        if (request.bbox() != null && !request.bbox().isEmpty()) {
            detection.setBbox(request.bbox().toString());
        }
        VehicleDetection saved = detectionRepository.save(detection);

        if (vehicle != null) {
            String plate = vehicle.getPlate();
            if (plate != null) {
                evictPlateCaches(plate);
            }
        }

        try {
            redisPubSubService.publishDetection(VehicleDetectionDto.from(saved));
        } catch (Exception e) {
            log.debug("Redis pub/sub unavailable, skipping detection event: {}", e.getMessage());
        }

        return saved;
    }

    @Transactional
    public void clearDetectionsForVideo(UUID videoUploadId) {
        if (videoUploadId != null) {
            detectionRepository.deleteByVideoUpload_Id(videoUploadId);
            log.info("Cleared prior detections for video upload ID: {}", videoUploadId);
        }
    }

    @Transactional
    public void updateVideoUploadStatus(
            UUID videoUploadId,
            String status,
            Integer framesProcessed,
            Integer detectionsCount,
            Double durationSec,
            String failureReason
    ) {
        if (videoUploadId == null) {
            return;
        }
        videoUploadRepository.findById(videoUploadId).ifPresent(upload -> {
            upload.setStatus(status);
            upload.setUpdatedAt(Instant.now());
            if (framesProcessed != null) {
                upload.setFramesProcessed(framesProcessed);
            }
            if (detectionsCount != null) {
                upload.setDetectionsCount(detectionsCount);
            }
            if (durationSec != null) {
                upload.setProcessingDurationSec(durationSec);
            }
            if (failureReason != null) {
                upload.setFailureReason(failureReason);
            }
            videoUploadRepository.save(upload);
            log.info("Updated VideoUpload {} status to {} (frames={}, detections={})",
                    videoUploadId, status, framesProcessed, detectionsCount);
        });
    }

    /**
     * Evicts stale cached entries for the given plate across vehicles and
     * trajectories caches. Uses Objects.requireNonNull to prove non-null to the
     * JDT null checker before passing into the Spring Cache API.
     */
    private void evictPlateCaches(String plate) {
        try {
            Cache vehicleCache = cacheManager.getCache("vehicles");
            if (vehicleCache != null) {
                vehicleCache.evict(Objects.requireNonNull(plate));
            }
            Cache trajectoryCache = cacheManager.getCache("trajectories");
            if (trajectoryCache != null) {
                trajectoryCache.evict(Objects.requireNonNull(plate));
            }
        } catch (Exception e) {
            log.debug("Cache eviction skipped (Redis offline?): {}", e.getMessage());
        }
    }

    private Vehicle resolveOrCreateVehicle(String normalizedPlate) {
        return vehicleRepository.findByPlate(normalizedPlate).orElseGet(() -> {
            Vehicle v = new Vehicle(normalizedPlate);
            return vehicleRepository.save(v);
        });
    }
}
