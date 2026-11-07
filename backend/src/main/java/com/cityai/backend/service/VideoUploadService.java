package com.cityai.backend.service;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VideoUploadDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VideoUpload;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VideoUploadRepository;
import com.cityai.backend.storage.StorageObject;
import com.cityai.backend.storage.StorageService;
import com.cityai.backend.storage.VideoSignatureValidator;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

import java.io.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.Instant;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.HashMap;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

@Service
public class VideoUploadService {

    private static final Logger log = LoggerFactory.getLogger(VideoUploadService.class);
    private static final DateTimeFormatter DATE_PATH_FORMATTER = DateTimeFormatter.ofPattern("yyyy/MM/dd");

    private final VideoUploadRepository uploadRepository;
    private final CameraRepository cameraRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final StorageService storageService;
    private final long maxSizeBytes;
    private final String aiServiceBaseUrl;
    private final String localDir;
    private final int serverPort;
    private final RestTemplate restTemplate;

    public VideoUploadService(
            VideoUploadRepository uploadRepository,
            CameraRepository cameraRepository,
            VehicleDetectionRepository detectionRepository,
            StorageService storageService,
            @Value("${app.storage.max-file-size-mb:500}") long maxFileSizeMb,
            @Value("${ai-service.base-url:http://localhost:8000}") String aiServiceBaseUrl,
            @Value("${app.storage.local-dir:../data/uploads}") String localDir,
            @Value("${server.port:8080}") int serverPort
    ) {
        this.uploadRepository = uploadRepository;
        this.cameraRepository = cameraRepository;
        this.detectionRepository = detectionRepository;
        this.storageService = storageService;
        this.maxSizeBytes = maxFileSizeMb * 1024L * 1024L;
        this.aiServiceBaseUrl = aiServiceBaseUrl.replaceAll("/+$", "");
        this.localDir = localDir;
        this.serverPort = serverPort;
        this.restTemplate = new RestTemplate();
        log.info("VideoUploadService initialized using {} (max size: {} MB, AI service: {})",
                storageService.getProviderName(), maxFileSizeMb, this.aiServiceBaseUrl);
    }

    public long getMaxSizeBytes() {
        return maxSizeBytes;
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

        // Wrap stream in BufferedInputStream with mark/reset support to read magic bytes without consuming the stream
        BufferedInputStream bufferedStream = new BufferedInputStream(rawStream, 65536);
        bufferedStream.mark(128);
        byte[] headerBytes = new byte[64];
        int bytesRead = bufferedStream.read(headerBytes, 0, headerBytes.length);
        bufferedStream.reset();

        byte[] actualHeader = headerBytes;
        if (bytesRead < headerBytes.length && bytesRead > 0) {
            actualHeader = new byte[bytesRead];
            System.arraycopy(headerBytes, 0, actualHeader, 0, bytesRead);
        }

        // Validate genuine binary container header (MP4, AVI, MKV, MOV)
        VideoSignatureValidator.ValidationResult valResult = VideoSignatureValidator.validate(actualHeader, safeFilename, declaredContentType);
        if (!valResult.isValid()) {
            log.warn("Rejected uploaded file '{}': {}", safeFilename, valResult.errorMessage());
            throw new IllegalArgumentException(valResult.errorMessage());
        }

        UUID uploadId = UUID.randomUUID();
        String ext = VideoSignatureValidator.getFileExtension(safeFilename);
        if (ext.isBlank()) {
            ext = "." + valResult.detectedFormat().toLowerCase();
        }

        // Generate date-partitioned storage key: uploads/YYYY/MM/dd/{uuid}{ext}
        String datePrefix = LocalDate.now().format(DATE_PATH_FORMATTER);
        String storageKey = String.format("uploads/%s/%s%s", datePrefix, uploadId, ext);

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
    public InputStream openStream(UUID id, long start, long length) throws IOException {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(id))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + id));
        return storageService.retrieveRange(upload.getStorageKey(), start, length);
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

    /**
     * Initiates actual AI inference pipeline for an uploaded video.
     * Idempotent: clears prior detections for this video to prevent duplicate records.
     */
    @Transactional
    public Map<String, Object> triggerInferencePipeline(UUID videoUploadId, boolean enableDehaze, int frameStride) {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(videoUploadId))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + videoUploadId));

        // 1. Clear any prior detections to prevent duplicate records on reprocessing
        detectionRepository.deleteByVideoUpload_Id(videoUploadId);

        // 2. Set status to PROCESSING
        upload.setStatus("PROCESSING");
        upload.setUpdatedAt(Instant.now());
        upload.setFailureReason(null);
        uploadRepository.save(upload);

        // 3. Resolve video source path or URL
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

        // 4. Dispatch request to FastAPI AI service
        Map<String, Object> aiRequest = new HashMap<>();
        aiRequest.put("video_upload_id", videoUploadId.toString());
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

            log.info("Dispatched video upload {} to AI service (job: {}, source: {})", videoUploadId, jobId, videoSource);

            Map<String, Object> result = new HashMap<>();
            result.put("video_upload_id", videoUploadId.toString());
            result.put("status", "PROCESSING");
            result.put("job_id", jobId);
            result.put("camera_id", cameraId);
            result.put("message", "Video inference pipeline initiated successfully.");
            return result;

        } catch (Exception e) {
            log.error("Failed to dispatch video upload {} to AI service at {}: {}", videoUploadId, aiUrl, e.getMessage());
            upload.setStatus("FAILED");
            upload.setFailureReason("Failed to connect to AI inference service: " + e.getMessage());
            upload.setUpdatedAt(Instant.now());
            uploadRepository.save(upload);
            throw new IllegalStateException("AI inference service unavailable: " + e.getMessage(), e);
        }
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
            int framesProcessed,
            int detectionsCount,
            Double durationSec,
            String failureReason
    ) {
        VideoUpload upload = uploadRepository.findById(Objects.requireNonNull(videoUploadId))
                .orElseThrow(() -> new NoSuchElementException("Video upload not found with ID: " + videoUploadId));

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
        upload.setUpdatedAt(Instant.now());
        uploadRepository.save(upload);
        log.info("Video upload {} marked as {} (frames={}, detections={}, duration={}s)",
                videoUploadId, upload.getStatus(), framesProcessed, detectionsCount, durationSec);
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
