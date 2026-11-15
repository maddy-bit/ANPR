package com.cityai.backend.controller;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.core.io.FileSystemResource;
import java.nio.file.Path;
import java.nio.file.Files;
import java.io.IOException;
import org.springframework.web.client.HttpStatusCodeException;
import org.springframework.web.client.RestTemplate;

import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.multipart.MultipartFile;
import java.util.Map;
import java.util.Objects;

/**
 * Controller that proxies AI service endpoints (/watchlist, /security-alerts, /predict-trajectory, /process-video)
 * to the Python AI engine specified by ai-service.base-url.
 * Returns structured HTTP 503 when the upstream AI microservice is unavailable.
 */
@RestController
@RequestMapping("/api")
public class AiProxyController {

    private static final Logger log = LoggerFactory.getLogger(AiProxyController.class);

    private final String aiServiceBaseUrl;
    private final RestTemplate restTemplate;
    private final long maxFileSizeMb;

    @org.springframework.beans.factory.annotation.Autowired
    public AiProxyController(
            @Value("${ai-service.base-url:http://localhost:8000}") String aiServiceBaseUrl,
            @Value("${app.storage.max-file-size-mb:500}") long maxFileSizeMb) {
        this(aiServiceBaseUrl, new RestTemplate(), maxFileSizeMb);
    }

    public AiProxyController(String aiServiceBaseUrl, RestTemplate restTemplate) {
        this(aiServiceBaseUrl, restTemplate, 500L);
    }

    public AiProxyController(String aiServiceBaseUrl, RestTemplate restTemplate, long maxFileSizeMb) {
        this.aiServiceBaseUrl = aiServiceBaseUrl.replaceAll("/+$", "");
        this.restTemplate = restTemplate;
        this.maxFileSizeMb = maxFileSizeMb;
    }

    @GetMapping("/watchlist")
    public ResponseEntity<?> getWatchlist() {
        try {
            String url = aiServiceBaseUrl + "/watchlist";
            Object response = restTemplate.getForObject(url, Object.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.warn("Unable to fetch /watchlist from AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Watchlist service is currently unavailable."));
        }
    }

    @PostMapping("/watchlist")
    public ResponseEntity<?> addWatchlistEntry(@RequestBody Map<String, Object> body) {
        try {
            String url = aiServiceBaseUrl + "/watchlist";
            Object response = restTemplate.postForObject(url, body, Object.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.warn("Unable to post /watchlist to AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Watchlist service is currently unavailable."));
        }
    }

    @PostMapping("/process-video")
    public ResponseEntity<?> processVideoFeed(@RequestBody Map<String, Object> body) {
        try {
            String url = aiServiceBaseUrl + "/process-video";
            Object response = restTemplate.postForObject(url, body, Object.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.warn("Unable to post /process-video to AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Video processing service is currently unavailable."));
        }
    }

    @PostMapping("/detect-plate")
    public ResponseEntity<?> detectPlate(@RequestBody Map<String, Object> body) {
        try {
            String url = aiServiceBaseUrl + "/detect-plate";
            Object response = restTemplate.postForObject(url, body, Object.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.warn("Unable to post /detect-plate to AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            Map<String, Object> fallback = new HashMap<>();
            fallback.put("success", false);
            fallback.put("detected", false);
            fallback.put("message", "AI service detection temporarily unavailable: " + e.getMessage());
            return ResponseEntity.ok(fallback);
        }
    }

    @GetMapping("/security-alerts")
    public ResponseEntity<?> getSecurityAlerts() {
        try {
            String url = aiServiceBaseUrl + "/security-alerts";
            Object response = restTemplate.getForObject(url, Object.class);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.warn("Unable to fetch /security-alerts from AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Security alerts service is currently unavailable."));
        }
    }

    @GetMapping("/predict-trajectory/{globalId}")
    public ResponseEntity<?> predictTrajectory(@PathVariable("globalId") String globalId) {
        try {
            String url = aiServiceBaseUrl + "/predict-trajectory/" + globalId;
            Object response = restTemplate.getForObject(url, Object.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 404) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "NOT_FOUND", "message", "Vehicle identifier not found in AI registry: " + globalId));
            }
            log.warn("AI service returned HTTP error {} for /predict-trajectory/{}: {}", e.getStatusCode(), globalId, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "AI prediction microservice returned an error."));
        } catch (Exception e) {
            log.warn("Unable to fetch /predict-trajectory from AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "AI prediction microservice is currently unavailable."));
        }
    }

    @GetMapping("/jobs/{jobId}")
    public ResponseEntity<?> getJobStatus(@PathVariable("jobId") String jobId) {
        try {
            String url = aiServiceBaseUrl + "/jobs/" + jobId;
            Object response = restTemplate.getForObject(url, Object.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 404) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "NOT_FOUND", "message", "Processing job not found: " + jobId));
            }
            log.warn("AI service returned HTTP error {} for /jobs/{}: {}", e.getStatusCode(), jobId, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "AI job service returned an error."));
        } catch (Exception e) {
            log.warn("Unable to fetch /jobs/{} from AI service ({}): {}", jobId, aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "AI job tracking service is currently unavailable."));
        }
    }

    @PostMapping("/ingest-camera/{cameraId}")
    public ResponseEntity<?> ingestCamera(@PathVariable("cameraId") String cameraId, @RequestBody(required = false) Map<String, Object> body) {
        try {
            String url = aiServiceBaseUrl + "/ingest-camera/" + cameraId;
            Object response = restTemplate.postForObject(url, body != null ? body : Map.of(), Object.class);
            return ResponseEntity.ok(response);
        } catch (HttpStatusCodeException e) {
            if (e.getStatusCode().value() == 404) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND)
                        .body(Map.of("error", "NOT_FOUND", "message", "Camera footage not found for: " + cameraId));
            }
            log.warn("AI service returned HTTP error {} for /ingest-camera/{}: {}", e.getStatusCode(), cameraId, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Camera ingestion service returned an error."));
        } catch (Exception e) {
            log.warn("Unable to post /ingest-camera/{} to AI service ({}): {}", cameraId, aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Camera ingestion service is currently unavailable."));
        }
    }

    @PostMapping(value = "/upload-video", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> uploadVideo(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "camera_id", defaultValue = "CAM-01") String cameraId,
            @RequestParam(value = "enable_dehaze", defaultValue = "false") boolean enableDehaze,
            @RequestParam(value = "start_time", defaultValue = "2026-09-05T12:00:00") String startTime,
            @RequestParam(value = "frame_stride", defaultValue = "5") int frameStride
    ) {
        if (file == null || file.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "BAD_REQUEST", "message", "File must not be empty"));
        }

        long maxBytes = maxFileSizeMb * 1024L * 1024L;
        if (file.getSize() > maxBytes) {
            return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                    .body(Map.of("error", "PAYLOAD_TOO_LARGE", "message", "Video file exceeds " + maxFileSizeMb + "MB limit."));
        }

        Path tempFile = null;
        try {
            // File-backed streaming: avoid loading the entire video into heap memory
            tempFile = Files.createTempFile("cityai-upload-", ".tmp");
            file.transferTo(Objects.requireNonNull(tempFile));

            if (Files.size(tempFile) > maxBytes) {
                return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                        .body(Map.of("error", "PAYLOAD_TOO_LARGE", "message", "Video file exceeds " + maxFileSizeMb + "MB limit."));
            }

            String url = aiServiceBaseUrl + "/upload-video";
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.MULTIPART_FORM_DATA);

            String rawFilename = file.getOriginalFilename();
            final String safeFilename = (rawFilename != null && !rawFilename.isBlank())
                    ? rawFilename
                    : "upload.mp4";

            FileSystemResource fileResource = new FileSystemResource(Objects.requireNonNull(tempFile)) {
                @Override
                @org.springframework.lang.NonNull
                public String getFilename() {
                    return safeFilename;
                }
            };

            MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
            body.add("file", fileResource);
            body.add("camera_id", cameraId);
            body.add("enable_dehaze", String.valueOf(enableDehaze));
            body.add("start_time", startTime);
            body.add("frame_stride", String.valueOf(frameStride));

            HttpEntity<MultiValueMap<String, Object>> requestEntity = new HttpEntity<>(body, headers);
            ResponseEntity<String> response = restTemplate.postForEntity(url, requestEntity, String.class);
            return ResponseEntity.status(response.getStatusCode())
                    .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                    .body(response.getBody());
        } catch (HttpStatusCodeException e) {
            log.warn("AI service returned HTTP error {} for /upload-video: {}", e.getStatusCode(), e.getMessage());
            return ResponseEntity.status(e.getStatusCode())
                    .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                    .body(e.getResponseBodyAsString());
        } catch (Exception e) {
            log.warn("Unable to forward /upload-video to AI service ({}): {}", aiServiceBaseUrl, e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("error", "AI_SERVICE_UNAVAILABLE", "message", "Video upload processing service is currently unavailable."));
        } finally {
            if (tempFile != null) {
                try {
                    Files.deleteIfExists(tempFile);
                } catch (IOException e) {
                    log.warn("Failed to delete temp upload file {}: {}", tempFile, e.getMessage());
                }
            }
        }
    }
}
