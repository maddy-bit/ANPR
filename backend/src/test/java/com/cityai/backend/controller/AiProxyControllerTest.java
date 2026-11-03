package com.cityai.backend.controller;

import java.util.Map;
import java.util.Objects;
import org.junit.jupiter.api.BeforeEach;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.MultipartFile;


import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

class AiProxyControllerTest {

    private static final String BASE_URL = "http://localhost:8000";
    private RestTemplate restTemplate;
    private AiProxyController controller;

    @BeforeEach
    void setUp() {
        restTemplate = Mockito.mock(RestTemplate.class);
        controller = new AiProxyController(BASE_URL, restTemplate);
    }

    @Test
    void getWatchlist_WhenAiServiceUnavailable_Returns503WithoutFallbackSuspects() {
        when(restTemplate.getForObject(BASE_URL + "/watchlist", Object.class))
                .thenThrow(new RestClientException("Connection refused"));

        ResponseEntity<?> response = controller.getWatchlist();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("AI_SERVICE_UNAVAILABLE");

        // Explicitly assert absence of previous hardcoded demo vehicles
        assertThat(body.toString()).doesNotContain("MH15TC554");
        assertThat(body.toString()).doesNotContain("KL55R2473");
    }

    @Test
    void getSecurityAlerts_WhenAiServiceUnavailable_Returns503WithoutDemoAlert() {
        when(restTemplate.getForObject(BASE_URL + "/security-alerts", Object.class))
                .thenThrow(new RestClientException("Connection refused"));

        ResponseEntity<?> response = controller.getSecurityAlerts();

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("AI_SERVICE_UNAVAILABLE");

        // Explicitly assert absence of previous hardcoded demo alert
        assertThat(body.toString()).doesNotContain("ALT-DEMO-01");
    }

    @Test
    void processVideo_WhenAiServiceUnavailable_Returns503WithoutFabricatedCounts() {
        Map<String, Object> reqBody = Map.of("cameraId", "CAM-01");
        when(restTemplate.postForObject(BASE_URL + "/process-video", reqBody, Object.class))
                .thenThrow(new RestClientException("Timeout"));

        ResponseEntity<?> response = controller.processVideoFeed(reqBody);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).doesNotContain("120");
        assertThat(body.toString()).doesNotContain("15");
    }

    @Test
    void predictTrajectory_WhenAiServiceUnavailable_Returns503() {
        when(restTemplate.getForObject(BASE_URL + "/predict-trajectory/MH12AB1234", Object.class))
                .thenThrow(new RestClientException("Connection refused"));

        ResponseEntity<?> response = controller.predictTrajectory("MH12AB1234");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
    }

    @Test
    void predictTrajectory_WhenNotFoundInAiService_Returns404() {
        when(restTemplate.getForObject(BASE_URL + "/predict-trajectory/UNKNOWN999", Object.class))
                .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));

        ResponseEntity<?> response = controller.predictTrajectory("UNKNOWN999");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("NOT_FOUND");
    }

    @Test
    void getJobStatus_WhenAiServiceReturnsStatus_Returns200() {
        Map<String, Object> jobData = Map.of("job_id", "job-123", "status", "PROCESSING", "progress", 45.0);
        when(restTemplate.getForObject(BASE_URL + "/jobs/job-123", Object.class))
                .thenReturn(jobData);

        ResponseEntity<?> response = controller.getJobStatus("job-123");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("PROCESSING");
    }

    @Test
    void getJobStatus_WhenNotFound_Returns404() {
        when(restTemplate.getForObject(BASE_URL + "/jobs/job-none", Object.class))
                .thenThrow(new HttpClientErrorException(HttpStatus.NOT_FOUND));

        ResponseEntity<?> response = controller.getJobStatus("job-none");

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("NOT_FOUND");
    }

    @Test
    void ingestCamera_WhenServiceUnavailable_Returns503() {
        when(restTemplate.postForObject(BASE_URL + "/ingest-camera/CAM-01", Map.of(), Object.class))
                .thenThrow(new RestClientException("Connection refused"));

        ResponseEntity<?> response = controller.ingestCamera("CAM-01", Map.of());

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("AI_SERVICE_UNAVAILABLE");
    }

    @Test
    void uploadVideo_WhenEmptyFile_Returns400() {
        MultipartFile file = Mockito.mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(true);

        ResponseEntity<?> response = controller.uploadVideo(file, "CAM-01", false, "2026-09-05T12:00:00", 5);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("BAD_REQUEST");
    }

    @Test
    void uploadVideo_WhenFileExceeds150MB_Returns413() {
        MultipartFile file = Mockito.mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(151L * 1024 * 1024);

        ResponseEntity<?> response = controller.uploadVideo(file, "CAM-01", false, "2026-09-05T12:00:00", 5);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.PAYLOAD_TOO_LARGE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("PAYLOAD_TOO_LARGE");
    }

    @Test
    @SuppressWarnings("null")
    void uploadVideo_WhenAiServiceUnavailable_Returns503() throws Exception {
        MultipartFile file = Mockito.mock(MultipartFile.class);
        when(file.isEmpty()).thenReturn(false);
        when(file.getSize()).thenReturn(1024L);
        when(file.getOriginalFilename()).thenReturn("test.mp4");
        Mockito.doNothing().when(file).transferTo(Mockito.any(Path.class));

        when(restTemplate.postForEntity(Mockito.eq(BASE_URL + "/upload-video"), Mockito.any(), Mockito.eq(String.class)))
                .thenThrow(new RestClientException("Connection refused"));

        ResponseEntity<?> response = controller.uploadVideo(file, "CAM-01", false, "2026-09-05T12:00:00", 5);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.SERVICE_UNAVAILABLE);
        Object body = Objects.requireNonNull(response.getBody());
        assertThat(body.toString()).contains("AI_SERVICE_UNAVAILABLE");
    }
}
