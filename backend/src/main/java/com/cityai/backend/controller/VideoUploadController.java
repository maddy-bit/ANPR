package com.cityai.backend.controller;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VideoProcessingRunDto;
import com.cityai.backend.dto.VideoUploadDto;
import com.cityai.backend.exception.IdempotencyConflictException;
import com.cityai.backend.service.VideoUploadService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.io.InputStreamResource;
import org.springframework.core.io.Resource;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.IOException;
import java.io.InputStream;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;

@RestController
@RequestMapping("/api/videos")
public class VideoUploadController {

    private static final Logger log = LoggerFactory.getLogger(VideoUploadController.class);

    private final VideoUploadService uploadService;

    public VideoUploadController(VideoUploadService uploadService) {
        this.uploadService = uploadService;
    }

    /**
     * Accepts real multipart video file uploads, streams binary to durable storage,
     * validates magic byte signatures, and records metadata in PostgreSQL.
     */
    @PostMapping(value = "/upload", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> uploadVideo(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "camera_id", required = false) String cameraId
    ) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "BAD_REQUEST",
                    "message", "Upload file is empty or missing"
            ));
        }

        if (file.getSize() > uploadService.getMaxSizeBytes()) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of(
                    "error", "PAYLOAD_TOO_LARGE",
                    "message", "Video file exceeds maximum allowed size of " +
                            (uploadService.getMaxSizeBytes() / (1024 * 1024)) + " MB"
            ));
        }

        try (InputStream is = file.getInputStream()) {
            VideoUploadDto dto = uploadService.processUpload(
                    is,
                    file.getOriginalFilename(),
                    file.getContentType(),
                    file.getSize(),
                    cameraId
            );
            return ResponseEntity.status(HttpStatus.CREATED).body(dto);

        } catch (IllegalArgumentException e) {
            log.warn("Validation failure for upload '{}': {}", file.getOriginalFilename(), e.getMessage());
            HttpStatus status = e.getMessage().contains("signature") || e.getMessage().contains("unsupported")
                    ? HttpStatus.UNSUPPORTED_MEDIA_TYPE
                    : HttpStatus.BAD_REQUEST;
            return ResponseEntity.status(status).body(Map.of(
                    "error", status.name(),
                    "message", e.getMessage()
            ));

        } catch (Exception e) {
            log.error("Internal storage failure for upload '{}': {}", file.getOriginalFilename(), e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "STORAGE_ERROR",
                    "message", "Failed to store video file: " + e.getMessage()
            ));
        }
    }

    @GetMapping("/{id}")
    public VideoUploadDto getUpload(@PathVariable("id") UUID id) {
        try {
            return uploadService.getUpload(id);
        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    @GetMapping
    public Page<VideoUploadDto> listUploads(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "10") int size,
            @RequestParam(name = "status", required = false) String status,
            @RequestParam(name = "camera_id", required = false) String cameraId
    ) {
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.max(1, Math.min(100, size));
        return uploadService.listUploads(PageRequest.of(boundedPage, boundedSize), status, cameraId);
    }

    /**
     * Backend-controlled streaming / download of stored video files.
     * Supports standard 200 OK full responses and 206 Partial Content byte ranges for media player seeking.
     */
    @GetMapping("/{id}/stream")
    public ResponseEntity<Resource> streamVideo(
            @PathVariable("id") UUID id,
            @RequestHeader(value = HttpHeaders.RANGE, required = false) String rangeHeader
    ) {
        VideoUploadDto metadata;
        try {
            metadata = uploadService.getUpload(id);
        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Video not found: " + id);
        }

        long totalSize = metadata.fileSize();

        try {
            // Handle HTTP Range request (RFC 7233 / RFC 9110)
            if (rangeHeader != null && rangeHeader.startsWith("bytes=") && totalSize > 0) {
                String byteRange = rangeHeader.substring(6).trim();

                // RFC 9110 § 14.1.2: If multiple ranges are requested (comma-separated),
                // a server that does not support multipart/byteranges MAY ignore the Range header
                // and return the entire representation with 200 OK.
                if (byteRange.contains(",")) {
                    log.debug("Multi-range request '{}' received; returning full 200 OK response as multipart/byteranges is not supported.", rangeHeader);
                    return fullVideoResponse(id, metadata);
                }

                int dashPos = byteRange.indexOf('-');

                long start = 0;
                long end = totalSize - 1;

                try {
                    if (dashPos == 0) {
                        // Suffix byte range: e.g. -500
                        long suffix = Long.parseLong(byteRange.substring(1));
                        start = Math.max(0, totalSize - suffix);
                    } else if (dashPos == byteRange.length() - 1) {
                        // Prefix byte range: e.g. 500-
                        start = Long.parseLong(byteRange.substring(0, dashPos));
                    } else if (dashPos > 0) {
                        // Closed byte range: e.g. 500-1000
                        start = Long.parseLong(byteRange.substring(0, dashPos));
                        end = Math.min(Long.parseLong(byteRange.substring(dashPos + 1)), totalSize - 1);
                    } else {
                        throw new NumberFormatException("Missing dash in range");
                    }
                } catch (NumberFormatException nfe) {
                    return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                            .header(HttpHeaders.CONTENT_RANGE, "bytes */" + totalSize)
                            .build();
                }

                if (start > end || start >= totalSize) {
                    return ResponseEntity.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                            .header(HttpHeaders.CONTENT_RANGE, "bytes */" + totalSize)
                            .build();
                }

                long rangeLength = end - start + 1;
                InputStream is = uploadService.openStream(id, start, rangeLength);
                InputStreamResource resource = new InputStreamResource(Objects.requireNonNull(is, "InputStream must not be null"));

                HttpHeaders headers = new HttpHeaders();
                headers.setContentType(MediaType.parseMediaType(Objects.requireNonNull(metadata.mimeType(), "MIME type must not be null")));
                headers.setContentLength(rangeLength);
                headers.set(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + totalSize);
                headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + metadata.originalFilename() + "\"");
                headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");

                return new ResponseEntity<>(resource, headers, HttpStatus.PARTIAL_CONTENT);
            }

            return fullVideoResponse(id, metadata);

        } catch (Exception e) {
            log.error("Failed to stream video {}: {}", id, e.getMessage(), e);
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to stream video: " + e.getMessage());
        }
    }

    private ResponseEntity<Resource> fullVideoResponse(UUID id, VideoUploadDto metadata) throws IOException {
        InputStream is = uploadService.openStream(id);
        InputStreamResource resource = new InputStreamResource(Objects.requireNonNull(is, "InputStream must not be null"));

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType(Objects.requireNonNull(metadata.mimeType(), "MIME type must not be null")));
        headers.setContentLength(metadata.fileSize());
        headers.set(HttpHeaders.CONTENT_DISPOSITION, "inline; filename=\"" + metadata.originalFilename() + "\"");
        headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");

        return new ResponseEntity<>(resource, headers, HttpStatus.OK);
    }

    /**
     * Starts the AI video inference pipeline on an uploaded video.
     */
    @PostMapping("/{id}/process")
    public ResponseEntity<?> processVideo(
            @PathVariable("id") UUID id,
            @RequestBody(required = false) Map<String, Object> options
    ) {
        String clientRunToken = null;
        boolean reprocess = false;
        boolean enableDehaze = false;
        int frameStride = 5;

        if (options != null) {
            if (options.get("client_run_token") != null) {
                clientRunToken = options.get("client_run_token").toString().trim();
            } else if (options.get("clientRunToken") != null) {
                clientRunToken = options.get("clientRunToken").toString().trim();
            }
            if (clientRunToken != null && clientRunToken.isEmpty()) {
                clientRunToken = null;
            }

            if (options.get("reprocess") instanceof Boolean b) {
                reprocess = b;
            }

            if (options.get("enable_dehaze") instanceof Boolean b) {
                enableDehaze = b;
            } else if (options.get("enableDehaze") instanceof Boolean b) {
                enableDehaze = b;
            }

            if (options.get("frame_stride") instanceof Number n) {
                frameStride = n.intValue();
            } else if (options.get("frameStride") instanceof Number n) {
                frameStride = n.intValue();
            }
        }

        if (frameStride <= 0) {
            return ResponseEntity.badRequest().body(Map.of(
                    "error", "BAD_REQUEST",
                    "message", "frame_stride must be a positive integer, got: " + frameStride
            ));
        }

        try {
            Map<String, Object> result;
            if (clientRunToken != null || reprocess) {
                result = uploadService.triggerInferencePipeline(id, clientRunToken, reprocess, enableDehaze, frameStride);
            } else {
                result = uploadService.triggerInferencePipeline(id, enableDehaze, frameStride);
            }

            HttpStatus status = Boolean.FALSE.equals(result.get("is_created")) ? HttpStatus.OK : HttpStatus.ACCEPTED;
            return ResponseEntity.status(status).body(result);

        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        } catch (IdempotencyConflictException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of(
                    "error", "IDEMPOTENCY_CONFLICT",
                    "message", e.getMessage()
            ));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(Map.of(
                    "error", "AI_SERVICE_UNAVAILABLE",
                    "message", e.getMessage()
            ));
        } catch (Exception e) {
            log.error("Failed to process video {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "PROCESSING_INIT_FAILED",
                    "message", e.getMessage()
            ));
        }
    }

    /**
     * Lists all processing runs for a video upload, ordered by run number descending.
     */
    @GetMapping("/{id}/runs")
    public List<VideoProcessingRunDto> listRuns(@PathVariable("id") UUID id) {
        try {
            return uploadService.listRunsForUpload(id);
        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    /**
     * Retrieves specific processing run for a video upload.
     */
    @GetMapping("/{id}/runs/{runId}")
    public VideoProcessingRunDto getRun(@PathVariable("id") UUID id, @PathVariable("runId") UUID runId) {
        try {
            return uploadService.getRun(id, runId);
        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    /**
     * Retrieves paginated real detection records persisted for this video.
     */
    @GetMapping("/{id}/detections")
    public Page<VehicleDetectionDto> getDetections(
            @PathVariable("id") UUID id,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) {
        try {
            int boundedPage = Math.max(0, page);
            int boundedSize = Math.max(1, Math.min(100, size));
            return uploadService.getDetectionsForVideo(id, PageRequest.of(boundedPage, boundedSize));
        } catch (NoSuchElementException e) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, e.getMessage());
        }
    }

    /**
     * Callback for AI service to record processing completion.
     */
    @PostMapping("/{id}/complete")
    public ResponseEntity<?> completeProcessing(
            @PathVariable("id") UUID id,
            @RequestBody Map<String, Object> completionData
    ) {
        try {
            int frames = completionData.get("frames_processed") instanceof Number n ? n.intValue() : 0;
            int detections = completionData.get("detections_count") instanceof Number n ? n.intValue() : 0;
            Double duration = completionData.get("duration_seconds") instanceof Number n ? n.doubleValue() : null;
            String error = completionData.get("error") != null ? completionData.get("error").toString() : null;

            UUID runId = null;
            if (completionData.get("processing_run_id") != null) {
                try {
                    runId = UUID.fromString(completionData.get("processing_run_id").toString());
                } catch (IllegalArgumentException ignored) {}
            }
            String manifestPath = completionData.get("manifest_path") != null ? completionData.get("manifest_path").toString() : null;
            String manifestSha256 = completionData.get("manifest_sha256") != null ? completionData.get("manifest_sha256").toString() : null;

            uploadService.completeVideoProcessing(id, runId, frames, detections, duration, manifestPath, manifestSha256, error);
            return ResponseEntity.ok(Map.of("status", "UPDATED", "video_upload_id", id.toString()));
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to mark video {} complete: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> deleteUpload(@PathVariable("id") UUID id) {
        try {
            uploadService.deleteUpload(id);
            return ResponseEntity.noContent().build();
        } catch (NoSuchElementException e) {
            return ResponseEntity.notFound().build();
        } catch (Exception e) {
            log.error("Failed to delete video {}: {}", id, e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                    "error", "DELETE_FAILED",
                    "message", e.getMessage()
            ));
        }
    }
}
