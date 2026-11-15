package com.cityai.backend.service;

import com.cityai.backend.dto.DetectionIngestRequest;
import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.exception.IdempotencyConflictException;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.model.VideoProcessingRun;
import com.cityai.backend.model.VideoUpload;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VehicleRepository;
import com.cityai.backend.repository.VideoProcessingRunRepository;
import com.cityai.backend.repository.VideoUploadRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.cache.Cache;
import org.springframework.cache.CacheManager;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * Turns raw AI-pipeline output (DetectionIngestRequest) into stored
 * VehicleDetection rows, resolving/creating the Vehicle identity from a
 * successfully-read plate via VehicleUpsertService, and executing dialect-aware
 * non-overwriting detection insertion via DetectionUpsertService.
 *
 * Implements atomic batch ingestion: all items in a batch commit together
 * or roll back completely. Side-effects (Redis pub/sub, cache evictions)
 * execute strictly after successful transaction commit, and are suppressed for duplicates.
 */
@Service
public class DetectionIngestionService {

    private static final Logger log = LoggerFactory.getLogger(DetectionIngestionService.class);

    public record IngestionBatchResult(
            List<VehicleDetection> detections,
            List<String> statuses
    ) {
        public boolean hasAnyCreated() {
            return statuses.contains("CREATED");
        }

        public boolean isAllDuplicate() {
            return !statuses.isEmpty() && !hasAnyCreated();
        }
    }

    private final CameraRepository cameraRepository;
    private final VehicleRepository vehicleRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final VideoUploadRepository videoUploadRepository;
    private final VideoProcessingRunRepository videoProcessingRunRepository;
    private final CacheManager cacheManager;
    private final RedisPubSubService redisPubSubService;
    private final VehicleUpsertService vehicleUpsertService;
    private final DetectionUpsertService detectionUpsertService;

    public DetectionIngestionService(
            CameraRepository cameraRepository,
            VehicleRepository vehicleRepository,
            VehicleDetectionRepository detectionRepository,
            VideoUploadRepository videoUploadRepository,
            VideoProcessingRunRepository videoProcessingRunRepository,
            CacheManager cacheManager,
            RedisPubSubService redisPubSubService,
            VehicleUpsertService vehicleUpsertService,
            DetectionUpsertService detectionUpsertService) {
        this.cameraRepository = Objects.requireNonNull(cameraRepository, "cameraRepository must not be null");
        this.vehicleRepository = Objects.requireNonNull(vehicleRepository, "vehicleRepository must not be null");
        this.detectionRepository = Objects.requireNonNull(detectionRepository, "detectionRepository must not be null");
        this.videoUploadRepository = Objects.requireNonNull(videoUploadRepository, "videoUploadRepository must not be null");
        this.videoProcessingRunRepository = Objects.requireNonNull(videoProcessingRunRepository, "videoProcessingRunRepository must not be null");
        this.cacheManager = Objects.requireNonNull(cacheManager, "cacheManager must not be null");
        this.redisPubSubService = Objects.requireNonNull(redisPubSubService, "redisPubSubService must not be null");
        this.vehicleUpsertService = Objects.requireNonNull(vehicleUpsertService, "vehicleUpsertService must not be null");
        this.detectionUpsertService = Objects.requireNonNull(detectionUpsertService, "detectionUpsertService must not be null");
    }

    /**
     * Genuinely atomic batch ingestion with status tracking.
     * All items in the batch are processed within a single database transaction.
     * Returns matching lists of VehicleDetection entities and their ingestion statuses ("CREATED" | "DUPLICATE").
     */
    @Transactional(rollbackFor = Exception.class)
    public IngestionBatchResult ingestBatchWithStatus(List<DetectionIngestRequest> requests) {
        if (requests == null || requests.isEmpty()) {
            return new IngestionBatchResult(List.of(), List.of());
        }

        Map<UUID, VideoProcessingRun> lockedRuns = new HashMap<>();
        Map<String, Integer> seenKeyIndices = new HashMap<>();
        Map<Integer, Integer> localDuplicateOf = new HashMap<>();

        // 1. Pre-validation and Batch-Local Deduplication
        for (int i = 0; i < requests.size(); i++) {
            DetectionIngestRequest req = requests.get(i);
            validateRequestStructureAndLockRun(req, lockedRuns);

            String key = req.idempotencyKey();
            if (key != null && !key.isBlank()) {
                if (seenKeyIndices.containsKey(key)) {
                    int originalIndex = seenKeyIndices.get(key);
                    DetectionIngestRequest originalReq = requests.get(originalIndex);
                    validateBatchLocalCompatibility(originalReq, req, key);
                    localDuplicateOf.put(i, originalIndex);
                } else {
                    seenKeyIndices.put(key, i);
                }
            }
        }

        List<VehicleDetection> savedDetections = new ArrayList<>(requests.size());
        List<String> statuses = new ArrayList<>(requests.size());
        List<VehicleDetectionDto> dtosToPublish = new ArrayList<>();
        Set<String> platesToEvict = new HashSet<>();

        // Map to store winning entities by batch index for batch-local duplicate resolution
        Map<Integer, VehicleDetection> entityByIndex = new HashMap<>();

        // 2. Process Items
        for (int i = 0; i < requests.size(); i++) {
            DetectionIngestRequest req = requests.get(i);

            if (localDuplicateOf.containsKey(i)) {
                int originalIndex = localDuplicateOf.get(i);
                VehicleDetection originalDet = entityByIndex.get(originalIndex);
                if (originalDet == null) {
                    throw new IllegalStateException("Failed to resolve original batch detection for local duplicate at index " + i);
                }
                savedDetections.add(originalDet);
                statuses.add("DUPLICATE");
                // Duplicates are never published to Redis or cache
                continue;
            }

            // Resolve dependencies
            String cameraId = req.cameraId();
            if (cameraId == null || cameraId.isBlank()) {
                throw new NoSuchElementException("Unknown camera: " + cameraId);
            }
            Camera camera = vehicleUpsertService.upsertCamera(cameraId);

            Vehicle vehicle = null;
            String normalizedPlate = req.plateTextNormalized();
            if (normalizedPlate != null && !normalizedPlate.isBlank()) {
                if (req.plateConfidence() != null && req.plateConfidence() >= 0.30) {
                    vehicle = vehicleUpsertService.upsertVehicle(normalizedPlate);
                }
            }

            VideoUpload videoUpload = null;
            UUID uploadId = req.videoUploadId();
            if (uploadId != null) {
                videoUpload = videoUploadRepository.findById(uploadId).orElse(null);
            }

            VideoProcessingRun processingRun = null;
            UUID runId = req.processingRunId();
            if (runId != null) {
                processingRun = lockedRuns.get(runId);
            }

            // Execute dialect-aware upsert
            DetectionUpsertService.UpsertResult upsertResult = detectionUpsertService.upsertDetection(
                    req, camera, vehicle, videoUpload, processingRun, i
            );

            Long detId = Objects.requireNonNull(upsertResult.id(), "upsertResult.id must not be null");
            VehicleDetection detection = detectionRepository.findById(detId)
                    .orElseThrow(() -> new IllegalStateException("Failed to load detection " + detId));

            if (upsertResult.isCreated()) {
                // If the run was sealed as COMPLETED or superseded as ABANDONED, creating new detections is forbidden
                if (processingRun != null && (processingRun.isCompleted() || processingRun.isAbandoned())) {
                    String reason = processingRun.isAbandoned()
                            ? "Cannot ingest new detection into ABANDONED run " + processingRun.getId()
                            : "Cannot ingest new detection into sealed COMPLETED run " + processingRun.getId();
                    throw new IdempotencyConflictException(
                            req.idempotencyKey(),
                            upsertResult.id(),
                            reason
                    );
                }
                savedDetections.add(detection);
                statuses.add("CREATED");
                entityByIndex.put(i, detection);

                dtosToPublish.add(VehicleDetectionDto.from(detection, "CREATED"));
                if (detection.getVehicle() != null && detection.getVehicle().getPlate() != null) {
                    platesToEvict.add(detection.getVehicle().getPlate());
                }
            } else {
                // Duplicate resolved against existing database row: validate compatibility
                validateDatabaseRowCompatibility(detection, req);
                savedDetections.add(detection);
                statuses.add("DUPLICATE");
                entityByIndex.put(i, detection);
                // Duplicate: side-effects strictly suppressed
            }
        }

        // Register side-effects strictly after transaction commit
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    for (String plate : platesToEvict) {
                        evictPlateCaches(plate);
                    }
                    for (VehicleDetectionDto dto : dtosToPublish) {
                        try {
                            redisPubSubService.publishDetection(dto);
                        } catch (Exception e) {
                            log.warn("Redis publication failed after commit for detection ID {}: {}", dto.id(), e.getMessage());
                        }
                    }
                }
            });
        } else {
            for (String plate : platesToEvict) {
                evictPlateCaches(plate);
            }
            for (VehicleDetectionDto dto : dtosToPublish) {
                try {
                    redisPubSubService.publishDetection(dto);
                } catch (Exception e) {
                    log.warn("Redis publication failed for detection ID {}: {}", dto.id(), e.getMessage());
                }
            }
        }

        return new IngestionBatchResult(savedDetections, statuses);
    }

    /**
     * Backward-compatible batch ingestion returning entity list.
     */
    @Transactional(rollbackFor = Exception.class)
    public List<VehicleDetection> ingestBatch(List<DetectionIngestRequest> requests) {
        return ingestBatchWithStatus(requests).detections();
    }

    /**
     * Backward-compatible single item ingestion returning entity.
     */
    @Transactional(rollbackFor = Exception.class)
    public VehicleDetection ingest(DetectionIngestRequest request) {
        if (request == null) {
            throw new IllegalArgumentException("DetectionIngestRequest must not be null");
        }
        return ingestBatch(List.of(request)).get(0);
    }

    private void validateRequestStructureAndLockRun(
            DetectionIngestRequest req,
            Map<UUID, VideoProcessingRun> lockedRuns
    ) {
        String key = req.idempotencyKey();
        UUID runId = req.processingRunId();
        UUID uploadId = req.videoUploadId();

        // Rule: processingRunId requires an idempotencyKey
        if (runId != null && (key == null || key.isBlank())) {
            throw new IllegalArgumentException("Detections associated with a processingRunId must provide a valid idempotencyKey");
        }

        // Rule: processingRunId requires videoUploadId
        if (runId != null && uploadId == null) {
            throw new IllegalArgumentException("processingRunId requires videoUploadId");
        }

        if (runId != null) {
            VideoProcessingRun run = lockedRuns.computeIfAbsent(runId, id ->
                    videoProcessingRunRepository.findByIdForUpdate(id)
                            .orElseThrow(() -> new NoSuchElementException("VideoProcessingRun not found: " + id))
            );

            // Ownership validation
            if (run.getVideoUpload() == null || !run.getVideoUpload().getId().equals(uploadId)) {
                throw new IdempotencyConflictException("Processing run " + runId + " does not belong to video upload " + uploadId);
            }

            // State validation
            if (run.isFailed()) {
                throw new IdempotencyConflictException("Cannot ingest evidence into FAILED processing run " + runId);
            }
            if (run.isAbandoned()) {
                throw new IdempotencyConflictException("Cannot ingest evidence into ABANDONED processing run " + runId);
            }
        }

        if (key != null && !key.isBlank()) {
            if (key.length() > 128 || !key.matches("^[a-zA-Z0-9:_-]{1,128}$")) {
                throw new IllegalArgumentException("Invalid idempotencyKey format: " + key);
            }

            if (key.startsWith("vid:")) {
                String[] parts = key.split(":");
                if (parts.length != 6 || !"vid".equals(parts[0]) || !"run".equals(parts[2]) || !"seq".equals(parts[4])) {
                    throw new IllegalArgumentException("Malformed manifest idempotencyKey: " + key);
                }

                UUID keyUploadId = parseStrictUuid(parts[1]);
                UUID keyRunId = parseStrictUuid(parts[3]);
                long seq;
                try {
                    seq = Long.parseLong(parts[5]);
                } catch (NumberFormatException e) {
                    throw new IllegalArgumentException("Invalid sequence number in idempotencyKey: " + key);
                }
                if (seq < 0) {
                    throw new IllegalArgumentException("Sequence number in idempotencyKey must be non-negative: " + seq);
                }

                if (uploadId == null || !uploadId.equals(keyUploadId)) {
                    throw new IdempotencyConflictException("Idempotency key videoUploadId mismatch with request: " + key);
                }
                if (runId == null || !runId.equals(keyRunId)) {
                    throw new IdempotencyConflictException("Idempotency key processingRunId mismatch with request: " + key);
                }
            } else {
                // Custom edge camera key: cannot be combined with videoUploadId or processingRunId
                if (uploadId != null || runId != null) {
                    throw new IllegalArgumentException("Custom edge-camera idempotency keys cannot specify videoUploadId or processingRunId");
                }
            }
        }
    }

    private void validateBatchLocalCompatibility(DetectionIngestRequest orig, DetectionIngestRequest dup, String key) {
        boolean isVidKey = key.startsWith("vid:");
        // Tier 1
        if (!Objects.equals(orig.cameraId(), dup.cameraId())) {
            throw new IdempotencyConflictException(key, null, "Tier 1 Camera ID mismatch in batch: " + orig.cameraId() + " vs " + dup.cameraId());
        }
        if (!Objects.equals(orig.videoUploadId(), dup.videoUploadId())) {
            throw new IdempotencyConflictException(key, null, "Tier 1 Video Upload ID mismatch in batch");
        }
        if (!Objects.equals(orig.processingRunId(), dup.processingRunId())) {
            throw new IdempotencyConflictException(key, null, "Tier 1 Processing Run ID mismatch in batch");
        }
        if (!Objects.equals(orig.frameNumber(), dup.frameNumber())) {
            throw new IdempotencyConflictException(key, null, "Tier 1 Frame Number mismatch in batch: " + orig.frameNumber() + " vs " + dup.frameNumber());
        }

        long origMs = orig.timestamp().toEpochMilli();
        long dupMs = dup.timestamp().toEpochMilli();
        if (isVidKey) {
            if (origMs != dupMs) {
                throw new IdempotencyConflictException(key, null, "Tier 1 Deterministic Timestamp mismatch in batch: " + origMs + "ms vs " + dupMs + "ms");
            }
        } else {
            if (Math.abs(origMs - dupMs) > 1) {
                throw new IdempotencyConflictException(key, null, "Tier 1 Timestamp mismatch exceeding 1ms tolerance in batch: " + origMs + "ms vs " + dupMs + "ms");
            }
        }

        // Tier 2
        if (orig.vehicleClass() != null && dup.vehicleClass() != null && !orig.vehicleClass().isBlank() && !dup.vehicleClass().isBlank()) {
            if (!orig.vehicleClass().equalsIgnoreCase(dup.vehicleClass())) {
                throw new IdempotencyConflictException(key, null, "Tier 2 Vehicle Class mismatch in batch: " + orig.vehicleClass() + " vs " + dup.vehicleClass());
            }
        }

        String plateOrig = orig.plateTextNormalized();
        String plateDup = dup.plateTextNormalized();
        Double confOrig = orig.plateConfidence();
        Double confDup = dup.plateConfidence();
        if (plateOrig != null && plateDup != null && !plateOrig.isBlank() && !plateDup.isBlank() &&
                confOrig != null && confOrig >= 0.30 && confDup != null && confDup >= 0.30) {
            if (!plateOrig.equalsIgnoreCase(plateDup)) {
                throw new IdempotencyConflictException(key, null, "Tier 2 High-confidence plate mismatch in batch: " + plateOrig + " vs " + plateDup);
            }
        }
    }

    private void validateDatabaseRowCompatibility(VehicleDetection existing, DetectionIngestRequest req) {
        String key = req.idempotencyKey();
        boolean isVidKey = key != null && key.startsWith("vid:");

        // Tier 1: Immutable Identity
        if (!Objects.equals(existing.getCamera().getId(), req.cameraId())) {
            throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Camera ID mismatch: " + existing.getCamera().getId() + " vs " + req.cameraId());
        }

        UUID existingUploadId = existing.getVideoUpload() != null ? existing.getVideoUpload().getId() : null;
        if (!Objects.equals(existingUploadId, req.videoUploadId())) {
            throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Video Upload ID mismatch");
        }

        UUID existingRunId = existing.getProcessingRun() != null ? existing.getProcessingRun().getId() : null;
        if (!Objects.equals(existingRunId, req.processingRunId())) {
            throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Processing Run ID mismatch");
        }

        if (!Objects.equals(existing.getFrameNumber(), req.frameNumber())) {
            throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Frame Number mismatch: " + existing.getFrameNumber() + " vs " + req.frameNumber());
        }

        long existingMs = existing.getTimestamp().toEpochMilli();
        long reqMs = req.timestamp().toEpochMilli();
        if (isVidKey) {
            if (existingMs != reqMs) {
                throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Deterministic Timestamp mismatch: " + existingMs + "ms vs " + reqMs + "ms");
            }
        } else {
            if (Math.abs(existingMs - reqMs) > 1) {
                throw new IdempotencyConflictException(key, existing.getId(), "Tier 1 Timestamp mismatch exceeding 1ms tolerance: " + existingMs + "ms vs " + reqMs + "ms");
            }
        }

        // Tier 2: Physical Classification
        if (existing.getVehicleClass() != null && req.vehicleClass() != null &&
                !existing.getVehicleClass().isBlank() && !req.vehicleClass().isBlank()) {
            if (!existing.getVehicleClass().equalsIgnoreCase(req.vehicleClass())) {
                throw new IdempotencyConflictException(key, existing.getId(), "Tier 2 Vehicle Class mismatch: " + existing.getVehicleClass() + " vs " + req.vehicleClass());
            }
        }

        String existingPlate = existing.getPlateTextNormalized();
        String reqPlate = req.plateTextNormalized();
        Double existingConf = existing.getPlateConfidence();
        Double reqConf = req.plateConfidence();
        if (existingPlate != null && reqPlate != null && !existingPlate.isBlank() && !reqPlate.isBlank() &&
                existingConf != null && existingConf >= 0.30 && reqConf != null && reqConf >= 0.30) {
            if (!existingPlate.equalsIgnoreCase(reqPlate)) {
                throw new IdempotencyConflictException(key, existing.getId(), "Tier 2 High-confidence plate mismatch: " + existingPlate + " vs " + reqPlate);
            }
        }

        // Tier 3: Sub-pixel bbox, confidence float delta, Re-ID embedding float delta are tolerated
    }

    private static UUID parseStrictUuid(String s) {
        if (s == null || s.length() != 36) {
            throw new IllegalArgumentException("Invalid UUID length: " + s);
        }
        UUID u = UUID.fromString(s);
        if (!u.toString().equalsIgnoreCase(s)) {
            throw new IllegalArgumentException("Non-canonical UUID representation: " + s);
        }
        return u;
    }

    @Transactional
    public void clearDetectionsForVideo(UUID videoUploadId) {
        if (videoUploadId != null) {
            detectionRepository.deleteByVideoUpload_Id(Objects.requireNonNull(videoUploadId));
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
        videoUploadRepository.findById(Objects.requireNonNull(videoUploadId)).ifPresent(upload -> {
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
            log.info("Updated video upload status: id={}, status={}", videoUploadId, status);
        });
    }

    private void evictPlateCaches(String plate) {
        if (plate == null || plate.isBlank()) {
            return;
        }
        try {
            String nonNullPlate = Objects.requireNonNull(plate);
            Cache vehicleCache = cacheManager.getCache("vehicles");
            if (vehicleCache != null) {
                vehicleCache.evict(nonNullPlate);
            }
            Cache trajectoryCache = cacheManager.getCache("trajectories");
            if (trajectoryCache != null) {
                trajectoryCache.evict(nonNullPlate);
            }
            Cache historyCache = cacheManager.getCache("vehicleHistory");
            if (historyCache != null) {
                historyCache.evict(nonNullPlate);
            }
        } catch (Exception e) {
            log.warn("Cache eviction failed for plate {}: {}", plate, e.getMessage());
        }
    }
}
