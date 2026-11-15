package com.cityai.backend.service;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VideoProcessingRunDto;
import com.cityai.backend.dto.VideoUploadDto;
import com.cityai.backend.exception.IdempotencyConflictException;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VideoProcessingRun;
import com.cityai.backend.model.VideoUpload;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VideoProcessingRunRepository;
import com.cityai.backend.repository.VideoUploadRepository;
import com.cityai.backend.storage.StorageObject;
import com.cityai.backend.storage.StorageService;
import com.cityai.backend.storage.VideoSignatureValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.*;

@Service
public class VideoUploadService {

    private static final Logger log = LoggerFactory.getLogger(VideoUploadService.class);
    private static final DateTimeFormatter DATE_PATH_FORMATTER = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    private final VideoUploadRepository uploadRepository;
    private final VideoProcessingRunRepository runRepository;
    private final CameraRepository cameraRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final StorageService storageService;
    private final long maxSizeBytes;
    private final String aiServiceBaseUrl;
    private final String localDir;
    private final int serverPort;
    private RestTemplate restTemplate;

    public VideoUploadService(
            VideoUploadRepository uploadRepository,
            VideoProcessingRunRepository runRepository,
            CameraRepository cameraRepository,
            VehicleDetectionRepository detectionRepository,
            StorageService storageService,
            @Value("${app.storage.max-file-size-mb:500}") long maxFileSizeMb,
            @Value("${ai-service.base-url:http://localhost:8000}") String aiServiceBaseUrl,
            @Value("${app.storage.local-dir:../data/uploads}") String localDir,
            @Value("${server.port:8080}") int serverPort
    ) {
        this.uploadRepository = uploadRepository;
        this.runRepository = runRepository;
        this.cameraRepository = cameraRepository;
        this.detectionRepository = detectionRepository;
        this.storageService = storageService;
        this.maxSizeBytes = maxFileSizeMb * 1024L * 1024L;
        this.aiServiceBaseUrl = aiServiceBaseUrl.replaceAll("/+$", "");
        this.localDir = localDir;
        this.serverPort = serverPort;
        SimpleClientHttpRequestFactory requestFactory = new SimpleClientHttpRequestFactory();
        requestFactory.setConnectTimeout(Duration.ofSeconds(10));
        requestFactory.setReadTimeout(Duration.ofSeconds(30));
        this.restTemplate = new RestTemplate(requestFactory);
        log.info("VideoUploadService initialized using {} (max size: {} MB, AI service: {})",
                storageService.getProviderName(), maxFileSizeMb, this.aiServiceBaseUrl);
    }

    void setRestTemplate(RestTemplate restTemplate) {
        this.restTemplate = Objects.requireNonNull(restTemplate, "restTemplate must not be null");
    }

    public long getMaxSizeBytes() {
        return maxSizeBytes;
    }

    /**
     * Calculates deterministic canonical configuration hash for processing runs.
     * Canonical string format: v1:enable_dehaze={boolean};frame_stride={int}
     */
    public static String calculateConfigHash(boolean enableDehaze, int frameStride) {
        if (frameStride <= 0) {
            throw new IllegalArgumentException("frame_stride must be a positive integer, got: " + frameStride);
        }
        String canonical = String.format("v1:enable_dehaze=%b;frame_stride=%d", enableDehaze, frameStride);
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] digest = md.digest(canonical.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 algorithm not available", e);
        }
    }

    /**
     * Streams video input to storage, validates container signature, and persists metadata.
     */
    @Transactional
    public VideoUploadDto processUpload(
            InputStream rawStream,
            String rawFilename,
            String declaredContentType,
            long reportedSize,
            String cameraId
    ) throws IOException {
        if (rawStream == null) {
            throw new IllegalArgumentException("Upload stream must not be null");
        }

        String safeFilename = sanitizeFilename(rawFilename);
        if (reportedSize <= 0) {
            throw new IllegalArgumentException("Video file is empty (0 bytes)");
        }
        if (reportedSize > maxSizeBytes) {
            throw new IllegalArgumentException("Video file exceeds maximum allowed size of " + (maxSizeBytes / (1024 * 1024)) + " MB");
        }

        UUID uploadId = UUID.randomUUID();
        String datePrefix = LocalDate.now().format(DATE_PATH_FORMATTER);
        String storageKey = String.format("%s/%s_%s", datePrefix, uploadId, safeFilename);

        BufferedInputStream bufferedStream = new BufferedInputStream(rawStream, 65536);
        bufferedStream.mark(65536);

        byte[] headerBytes = new byte[64];
        int bytesRead = bufferedStream.read(headerBytes, 0, 64);
        byte[] actualHeader = new byte[Math.max(0, bytesRead)];
        if (bytesRead > 0) {
            System.arraycopy(headerBytes, 0, actualHeader, 0, bytesRead);
        }

        // Validate genuine binary container header (MP4, AVI, MKV, MOV)
        VideoSignatureValidator.ValidationResult valResult = VideoSignatureValidator.validate(actualHeader, safeFilename, declaredContentType);
        if (!valResult.isValid()) {
            log.warn("Rejected uploaded file '{}': {}", safeFilename, valResult.errorMessage());
            throw new IllegalArgumentException(valResult.errorMessage());
        }

        bufferedStream.reset();

        Camera associatedCamera = null;
        if (cameraId != null && !cameraId.isBlank()) {
            associatedCamera = cameraRepository.findById(Objects.requireNonNull(cameraId.trim())).orElse(null);
        }

        Instant now = Instant.now();
        // Stream directly to durable storage
        StorageObject stored = storageService.store(bufferedStream, storageKey, valResult.canonicalMimeType(), reportedSize);

        VideoUpload upload = new VideoUpload(
                uploadId,
                safeFilename,
                stored.key(),
                storageService.getProviderName(),
                stored.contentType(),
                stored.size(),
                "UPLOADED",
                associatedCamera,
                now,
                now,
                null,
                stored.sha256Hash()
        );

        VideoUpload saved = uploadRepository.save(upload);
        log.info("Successfully completed video upload ID {} ({} bytes, sha256: {})",
                saved.getId(), saved.getFileSize(), saved.getSha256Hash());

        return VideoUploadDto.from(saved);
    }

    @Transactional(readOnly = true)
    public VideoUploadDto getUpload(UUID id) {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(id))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + id));
        return VideoUploadDto.from(upload);
    }

    @Transactional(readOnly = true)
    public Page<VideoUploadDto> listUploads(Pageable pageable, String status, String cameraId) {
        if (status != null && !status.isBlank()) {
            return uploadRepository.findByStatusOrderByCreatedAtDesc(status.trim().toUpperCase(), pageable)
                    .map(VideoUploadDto::from);
        }
        if (cameraId != null && !cameraId.isBlank()) {
            return uploadRepository.findByCamera_IdOrderByCreatedAtDesc(cameraId.trim(), pageable)
                    .map(VideoUploadDto::from);
        }
        return uploadRepository.findAllByOrderByCreatedAtDesc(pageable)
                .map(VideoUploadDto::from);
    }

    @Transactional(readOnly = true)
    public InputStream openStream(UUID id) throws IOException {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(id))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + id));
        return storageService.retrieve(upload.getStorageKey());
    }

    @Transactional(readOnly = true)
    public InputStream openStream(UUID id, long offset, long length) throws IOException {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(id))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + id));
        return storageService.retrieveRange(upload.getStorageKey(), offset, length);
    }

    @Transactional
    public void deleteUpload(UUID id) throws IOException {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(id))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + id));

        try {
            storageService.delete(upload.getStorageKey());
        } catch (Exception e) {
            log.warn("Storage deletion error for key {}: {}", upload.getStorageKey(), e.getMessage());
        }
        uploadRepository.delete(upload);
        log.info("Deleted video upload record {}", id);
    }

    public record RunCreationResult(
            VideoProcessingRun run,
            boolean isCreated
    ) {}

    /**
     * Transactionally creates or idempotently retrieves a VideoProcessingRun.
     * Enforces pessimistic row lock on VideoUpload, request token uniqueness,
     * active run lifecycle (at most 1 active run), and generation monotonicity.
     */
    @Transactional
    public RunCreationResult createOrGetProcessingRun(
            UUID videoUploadId,
            String clientRunToken,
            boolean reprocess,
            boolean enableDehaze,
            int frameStride
    ) {
        if (frameStride <= 0) {
            throw new IllegalArgumentException("frame_stride must be a positive integer, got: " + frameStride);
        }

        String configHash = calculateConfigHash(enableDehaze, frameStride);

        // 1. Lock VideoUpload row via pessimistic write lock
        VideoUpload upload = uploadRepository.findByIdForUpdate(Objects.requireNonNull(videoUploadId))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + videoUploadId));

        if ("FAILED_UPLOAD".equalsIgnoreCase(upload.getStatus())) {
            throw new IllegalStateException("Cannot process video upload in state: " + upload.getStatus());
        }

        // 2. Request Idempotency Check by clientRunToken
        String sanitizedToken = (clientRunToken != null && !clientRunToken.isBlank()) ? clientRunToken.trim() : null;
        if (sanitizedToken != null) {
            Optional<VideoProcessingRun> existingRunOpt = runRepository.findByVideoUpload_IdAndClientRunToken(videoUploadId, sanitizedToken);
            if (existingRunOpt.isPresent()) {
                VideoProcessingRun existingRun = existingRunOpt.get();
                if (!configHash.equals(existingRun.getConfigHash())) {
                    throw new IdempotencyConflictException(
                            String.format("client_run_token '%s' already used for upload %s with conflicting configuration (existing hash: %s, requested: %s)",
                                    sanitizedToken, videoUploadId, existingRun.getConfigHash(), configHash)
                    );
                }
                log.info("Idempotent run retrieval for upload {} with token {} -> run {}", videoUploadId, sanitizedToken, existingRun.getId());
                return new RunCreationResult(existingRun, false);
            }
        }

        // 3. Active Run Inspection (CREATED or PROCESSING)
        Optional<VideoProcessingRun> activeRunOpt = runRepository.findByVideoUpload_IdAndStatusIn(
                videoUploadId, List.of("CREATED", "PROCESSING")
        );

        if (activeRunOpt.isPresent()) {
            VideoProcessingRun activeRun = activeRunOpt.get();
            if (!reprocess) {
                if (sanitizedToken == null) {
                    throw new IdempotencyConflictException(
                            String.format("Active processing run %s (status: %s) already exists for video upload %s. " +
                                    "Request did not include a client_run_token; retries without a client token are not idempotent. " +
                                    "Set reprocess=true to supersede or supply a client_run_token.",
                                    activeRun.getId(), activeRun.getStatus(), videoUploadId)
                    );
                } else {
                    throw new IdempotencyConflictException(
                            String.format("Active processing run %s (status: %s) already exists for video upload %s. Set reprocess=true to supersede.",
                                    activeRun.getId(), activeRun.getStatus(), videoUploadId)
                    );
                }
            }

            // Explicit Reprocess: Supersede active run to ABANDONED
            activeRun.setStatus("ABANDONED");
            activeRun.setFailureReason("Superseded by intentional reprocess request");
            activeRun.setCompletedAt(Instant.now());
            activeRun.setUpdatedAt(Instant.now());
            runRepository.save(activeRun);
            log.info("Superseded active run {} to ABANDONED for video upload {}", activeRun.getId(), videoUploadId);
        }

        // 4. Generation Allocation (Monotonic increment per upload when creating new run)
        int uploadGen = (upload.getActiveRunGeneration() != null) ? upload.getActiveRunGeneration() : 0;
        int maxHistoricalGen = runRepository.findTopByVideoUpload_IdOrderByGenerationDesc(videoUploadId)
                .map(r -> r.getGeneration() != null ? r.getGeneration() : (r.getRunNumber() != null ? r.getRunNumber() : 0))
                .orElse(0);

        int baseGen = Math.max(uploadGen, maxHistoricalGen);
        int nextGen = (baseGen == 0) ? 1 : baseGen + 1;
        upload.setActiveRunGeneration(nextGen);

        // 5. Run Number Allocation
        int nextRunNumber = runRepository.findTopByVideoUpload_IdOrderByRunNumberDesc(videoUploadId)
                .map(r -> r.getRunNumber() + 1)
                .orElse(1);

        // 6. Create New Run in CREATED Status
        UUID runId = UUID.randomUUID();
        Instant now = Instant.now();
        VideoProcessingRun newRun = new VideoProcessingRun(
                runId,
                upload,
                nextRunNumber,
                "CREATED",
                nextGen,
                sanitizedToken,
                frameStride,
                enableDehaze,
                configHash,
                "VERIFIED",
                now
        );

        VideoProcessingRun savedRun;
        try {
            savedRun = runRepository.saveAndFlush(newRun);
        } catch (DataIntegrityViolationException ex) {
            // Concurrent duplicate insertion with same clientRunToken: recover winning run
            if (sanitizedToken != null) {
                Optional<VideoProcessingRun> raced = runRepository.findByVideoUpload_IdAndClientRunToken(videoUploadId, sanitizedToken);
                if (raced.isPresent()) {
                    VideoProcessingRun winner = raced.get();
                    if (!configHash.equals(winner.getConfigHash())) {
                        throw new IdempotencyConflictException(
                                String.format("Concurrent token collision: '%s' exists with conflicting configuration", sanitizedToken)
                        );
                    }
                    return new RunCreationResult(winner, false);
                }
            }
            throw ex;
        }

        // 7. Update VideoUpload
        upload.setCurrentProcessingRun(savedRun);
        upload.setStatus("PROCESSING");
        upload.setUpdatedAt(now);
        upload.setFailureReason(null);
        uploadRepository.save(upload);

        log.info("Created processing run {} (run #{}, gen #{}, status CREATED) for upload {}",
                savedRun.getId(), savedRun.getRunNumber(), savedRun.getGeneration(), videoUploadId);

        return new RunCreationResult(savedRun, true);
    }

    /**
     * Initiates actual AI inference pipeline for an uploaded video.
     * Guarantees atomic run creation, idempotent deduplication, and safe dispatch.
     * Note: Transactional boundary is isolated to createOrGetProcessingRun so the slow
     * outbound HTTP network call to FastAPI does not hold database locks or connections open.
     */
    public Map<String, Object> triggerInferencePipeline(
            UUID videoUploadId,
            String clientRunToken,
            boolean reprocess,
            boolean enableDehaze,
            int frameStride
    ) {
        RunCreationResult result = createOrGetProcessingRun(
                videoUploadId, clientRunToken, reprocess, enableDehaze, frameStride
        );

        VideoProcessingRun run = result.run();
        VideoUpload upload = run.getVideoUpload();

        if (!result.isCreated()) {
            Map<String, Object> resp = new HashMap<>();
            resp.put("video_upload_id", videoUploadId.toString());
            resp.put("processing_run_id", run.getId().toString());
            resp.put("run_id", run.getId().toString());
            resp.put("run_number", run.getRunNumber());
            resp.put("generation", run.getGeneration());
            resp.put("status", run.getStatus());
            resp.put("config_hash", run.getConfigHash());
            resp.put("config_status", run.getConfigStatus());
            resp.put("client_run_token", run.getClientRunToken());
            resp.put("job_id", "job-" + run.getId().toString());
            resp.put("camera_id", upload.getCamera() != null ? upload.getCamera().getId() : "CAM-01");
            resp.put("is_created", false);
            resp.put("idempotent", true);
            resp.put("message", "Idempotent run retrieved successfully.");
            return resp;
        }

        // Resolving video source
        String videoSource;
        if ("LOCAL".equalsIgnoreCase(upload.getStorageProvider())) {
            Path p = Paths.get(localDir).resolve(upload.getStorageKey()).toAbsolutePath().normalize();
            if (Files.exists(p)) {
                videoSource = p.toString();
            } else {
                videoSource = String.format("http://localhost:%d/api/videos/%s/stream", serverPort, videoUploadId);
            }
        } else {
            videoSource = String.format("http://localhost:%d/api/videos/%s/stream", serverPort, videoUploadId);
        }

        String cameraId = upload.getCamera() != null ? upload.getCamera().getId() : "CAM-01";

        // Dispatch request to FastAPI AI service
        Map<String, Object> aiRequest = new HashMap<>();
        aiRequest.put("video_upload_id", videoUploadId.toString());
        aiRequest.put("processing_run_id", run.getId().toString());
        aiRequest.put("run_number", run.getRunNumber());
        aiRequest.put("video_path", videoSource);
        aiRequest.put("camera_id", cameraId);
        aiRequest.put("enable_dehaze", enableDehaze);
        aiRequest.put("frame_stride", frameStride > 0 ? frameStride : 5);

        String aiUrl = aiServiceBaseUrl + "/process-video-upload";
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            HttpEntity<Map<String, Object>> entity = new HttpEntity<>(aiRequest, headers);

            ResponseEntity<?> resp = restTemplate.postForEntity(aiUrl, entity, Map.class);
            Object body = resp.getBody();
            String jobId = null;
            if (body instanceof Map<?, ?> m && m.get("job_id") != null) {
                jobId = m.get("job_id").toString();
            }

            log.info("Dispatched video upload {} (run {}) to AI service (job: {}, source: {})",
                    videoUploadId, run.getId(), jobId, videoSource);

            Map<String, Object> respMap = new HashMap<>();
            respMap.put("video_upload_id", videoUploadId.toString());
            respMap.put("processing_run_id", run.getId().toString());
            respMap.put("run_id", run.getId().toString());
            respMap.put("run_number", run.getRunNumber());
            respMap.put("generation", run.getGeneration());
            respMap.put("status", run.getStatus());
            respMap.put("config_hash", run.getConfigHash());
            respMap.put("config_status", run.getConfigStatus());
            respMap.put("client_run_token", run.getClientRunToken());
            respMap.put("job_id", jobId);
            respMap.put("camera_id", cameraId);
            respMap.put("is_created", true);
            respMap.put("idempotent", run.getClientRunToken() != null);
            respMap.put("message", run.getClientRunToken() != null
                    ? "Video inference pipeline initiated successfully with client token idempotency."
                    : "Video inference pipeline initiated without client run token. Retries are not idempotent.");
            return respMap;

        } catch (Exception e) {
            log.error("Failed to dispatch video upload {} (run {}) to AI service at {}: {}",
                    videoUploadId, run.getId(), aiUrl, e.getMessage());
            markRunAndUploadFailed(run.getId(), videoUploadId, "Failed to connect to AI inference service: " + e.getMessage());
            throw new IllegalStateException("AI inference service unavailable: " + e.getMessage(), e);
        }
    }

    @Transactional
    public void markRunAndUploadFailed(UUID runId, UUID uploadId, String reason) {
        Instant now = Instant.now();
        if (runId != null) {
            runRepository.findById(runId).ifPresent(r -> {
                if (!r.isTerminal()) {
                    r.setStatus("FAILED");
                    r.setFailureReason(reason);
                    r.setUpdatedAt(now);
                    runRepository.save(r);
                }
            });
        }
        if (uploadId != null) {
            uploadRepository.findById(uploadId).ifPresent(u -> {
                if ("PROCESSING".equalsIgnoreCase(u.getStatus())) {
                    u.setStatus("FAILED");
                    u.setFailureReason(reason);
                    u.setUpdatedAt(now);
                    uploadRepository.save(u);
                }
            });
        }
    }

    public Map<String, Object> triggerInferencePipeline(UUID videoUploadId, boolean enableDehaze, int frameStride) {
        return triggerInferencePipeline(videoUploadId, null, false, enableDehaze, frameStride);
    }

    @Transactional(readOnly = true)
    public List<VideoProcessingRunDto> listRunsForUpload(UUID videoUploadId) {
        if (!uploadRepository.existsById(Objects.requireNonNull(videoUploadId))) {
            throw new NoSuchElementException("Video upload not found with ID: " + videoUploadId);
        }
        return runRepository.findByVideoUpload_IdOrderByRunNumberDesc(videoUploadId)
                .stream()
                .map(VideoProcessingRunDto::from)
                .toList();
    }

    @Transactional(readOnly = true)
    public VideoProcessingRunDto getRun(UUID videoUploadId, UUID runId) {
        VideoProcessingRun run = runRepository.findById(Objects.requireNonNull(runId))
                .orElseThrow(() -> new NoSuchElementException("Processing run not found with ID: " + runId));
        if (run.getVideoUpload() == null || !run.getVideoUpload().getId().equals(videoUploadId)) {
            throw new NoSuchElementException("Processing run " + runId + " does not belong to upload " + videoUploadId);
        }
        return VideoProcessingRunDto.from(run);
    }

    @Transactional(readOnly = true)
    public Page<VehicleDetectionDto> getDetectionsForVideo(UUID videoUploadId, Pageable pageable) {
        if (!uploadRepository.existsById(Objects.requireNonNull(videoUploadId))) {
            throw new NoSuchElementException("Video upload not found with ID: " + videoUploadId);
        }
        return detectionRepository.findByVideoUpload_IdOrderByTimestampAsc(videoUploadId, pageable)
                .map(VehicleDetectionDto::from);
    }

    @Transactional
    public void completeVideoProcessing(
            UUID videoUploadId,
            UUID processingRunId,
            int framesProcessed,
            int detectionsCount,
            Double durationSec,
            String manifestPath,
            String manifestSha256,
            String failureReason
    ) {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(videoUploadId))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + videoUploadId));

        Instant now = Instant.now();
        VideoProcessingRun currentRun = upload.getCurrentProcessingRun();

        // Worker fencing: If a specific run ID was sent by caller, verify it matches the active run
        if (processingRunId != null && currentRun != null && !currentRun.getId().equals(processingRunId)) {
            log.warn("Rejected completion callback: processingRunId {} does not match active run {} for upload {}",
                    processingRunId, currentRun.getId(), videoUploadId);
            return;
        }

        // Abandoned check: If current run is already abandoned, reject completion
        if (currentRun != null && currentRun.isAbandoned()) {
            log.warn("Rejected completion callback: active run {} for upload {} is already ABANDONED",
                    currentRun.getId(), videoUploadId);
            return;
        }

        // Idempotency check: If current run is already completed or failed, return cleanly without re-mutating
        if (currentRun != null && currentRun.isCompleted() && (failureReason == null || failureReason.isBlank())) {
            log.info("Idempotent completion callback: run {} for upload {} is already COMPLETED",
                    currentRun.getId(), videoUploadId);
            return;
        }
        if (currentRun != null && currentRun.isFailed() && failureReason != null && !failureReason.isBlank()) {
            log.info("Idempotent completion callback: run {} for upload {} is already FAILED",
                    currentRun.getId(), videoUploadId);
            return;
        }

        if (failureReason != null && !failureReason.isBlank()) {
            upload.setStatus("FAILED");
            upload.setFailureReason(failureReason);
        } else {
            upload.setStatus("COMPLETED");
            upload.setFailureReason(null);
        }
        upload.setFramesProcessed(framesProcessed);
        upload.setDetectionsCount(detectionsCount);
        upload.setProcessingDurationSec(durationSec);
        upload.setUpdatedAt(now);
        uploadRepository.save(upload);

        if (currentRun != null && !currentRun.isTerminal()) {
            if (failureReason != null && !failureReason.isBlank()) {
                currentRun.setStatus("FAILED");
                currentRun.setFailureReason(failureReason);
            } else {
                currentRun.setStatus("COMPLETED");
            }
            currentRun.setFramesProcessed(framesProcessed);
            currentRun.setDetectionsCount(detectionsCount);
            if (manifestPath != null && !manifestPath.isBlank()) {
                currentRun.setManifestPath(manifestPath);
            }
            if (manifestSha256 != null && !manifestSha256.isBlank()) {
                currentRun.setManifestSha256(manifestSha256);
            }
            currentRun.setCompletedAt(now);
            currentRun.setUpdatedAt(now);
            runRepository.save(currentRun);
        }

        log.info("Video upload {} marked as {} (run={}, frames={}, detections={}, duration={}s, manifest={})",
                videoUploadId, upload.getStatus(), currentRun != null ? currentRun.getId() : null,
                framesProcessed, detectionsCount, durationSec, manifestPath);
    }

    @Transactional
    public void completeVideoProcessing(
            UUID videoUploadId,
            int framesProcessed,
            int detectionsCount,
            Double durationSec,
            String failureReason
    ) {
        completeVideoProcessing(videoUploadId, null, framesProcessed, detectionsCount, durationSec, null, null, failureReason);
    }

    public static String sanitizeFilename(String raw) {
        if (raw == null || raw.isBlank()) {
            return "video_" + System.currentTimeMillis() + ".mp4";
        }
        // Remove path traversal elements
        String name = new File(raw).getName();
        name = name.replaceAll("[^a-zA-Z0-9._-]", "_");
        if (name.isBlank() || name.equals(".")) {
            return "video_" + System.currentTimeMillis() + ".mp4";
        }
        return name;
    }
}
