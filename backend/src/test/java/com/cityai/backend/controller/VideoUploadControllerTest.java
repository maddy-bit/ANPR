package com.cityai.backend.controller;

import com.cityai.backend.dto.VideoUploadDto;
import com.cityai.backend.service.VideoUploadService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.io.ByteArrayInputStream;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SuppressWarnings("null")
class VideoUploadControllerTest {

    private VideoUploadService uploadService;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        uploadService = Mockito.mock(VideoUploadService.class);
        VideoUploadController controller = new VideoUploadController(uploadService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();

        when(uploadService.getMaxSizeBytes()).thenReturn(500L * 1024L * 1024L);
    }

    @Test
    void uploadVideo_ValidMp4_Returns201Created() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "traffic.mp4",
                "uploads/2026/11/04/" + id + ".mp4",
                "LOCAL",
                "video/mp4",
                1024L,
                "UPLOADED",
                "CAM-01",
                Instant.now(),
                Instant.now(),
                null,
                "sha256hash123"
        );

        when(uploadService.processUpload(any(), eq("traffic.mp4"), eq("video/mp4"), eq(1024L), eq("CAM-01")))
                .thenReturn(dto);

        MockMultipartFile file = new MockMultipartFile(
                "file",
                "traffic.mp4",
                "video/mp4",
                new byte[1024]
        );

        mockMvc.perform(multipart("/api/videos/upload")
                        .file(file)
                        .param("camera_id", "CAM-01"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").value(id.toString()))
                .andExpect(jsonPath("$.originalFilename").value("traffic.mp4"))
                .andExpect(jsonPath("$.storageProvider").value("LOCAL"))
                .andExpect(jsonPath("$.status").value("UPLOADED"));
    }

    @Test
    void uploadVideo_EmptyFile_Returns400BadRequest() throws Exception {
        MockMultipartFile emptyFile = new MockMultipartFile(
                "file",
                "empty.mp4",
                "video/mp4",
                new byte[0]
        );

        mockMvc.perform(multipart("/api/videos/upload")
                        .file(emptyFile))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("BAD_REQUEST"));
    }

    @Test
    void uploadVideo_SpoofedSignature_Returns415UnsupportedMediaType() throws Exception {
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "spoofed.mp4",
                "video/mp4",
                "Not a video".getBytes()
        );

        when(uploadService.processUpload(any(), anyString(), anyString(), anyLong(), any()))
                .thenThrow(new IllegalArgumentException("File signature does not match any supported video container (MP4, AVI, MKV, MOV)."));

        mockMvc.perform(multipart("/api/videos/upload")
                        .file(file))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.error").value("UNSUPPORTED_MEDIA_TYPE"))
                .andExpect(jsonPath("$.message").value(org.hamcrest.Matchers.containsString("signature does not match")));
    }

    @Test
    void uploadVideo_OversizedFile_Returns413PayloadTooLarge() throws Exception {
        when(uploadService.getMaxSizeBytes()).thenReturn(100L);

        MockMultipartFile largeFile = new MockMultipartFile(
                "file",
                "large.mp4",
                "video/mp4",
                new byte[200]
        );

        mockMvc.perform(multipart("/api/videos/upload")
                        .file(largeFile))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error").value("PAYLOAD_TOO_LARGE"));
    }

    @Test
    void getUpload_ExistingId_Returns200WithDto() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "cctv.mp4",
                "uploads/cctv.mp4",
                "LOCAL",
                "video/mp4",
                2048L,
                "UPLOADED",
                "CAM-02",
                Instant.now(),
                Instant.now(),
                null,
                "hashxyz"
        );

        when(uploadService.getUpload(id)).thenReturn(dto);

        mockMvc.perform(get("/api/videos/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id.toString()))
                .andExpect(jsonPath("$.originalFilename").value("cctv.mp4"));
    }

    @Test
    void getUpload_NonExistentId_Returns404NotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(uploadService.getUpload(id)).thenThrow(new NoSuchElementException("Video not found: " + id));

        mockMvc.perform(get("/api/videos/" + id))
                .andExpect(status().isNotFound());
    }

    @Test
    void listUploads_ReturnsPaginatedList() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "test.mp4",
                "uploads/test.mp4",
                "LOCAL",
                "video/mp4",
                1024L,
                "UPLOADED",
                "CAM-01",
                Instant.now(),
                Instant.now(),
                null,
                "hash"
        );

        when(uploadService.listUploads(any(PageRequest.class), any(), any()))
                .thenReturn(new PageImpl<>(List.of(dto), PageRequest.of(0, 10), 1));

        mockMvc.perform(get("/api/videos?page=0&size=10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id.toString()))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void streamVideo_ExistingId_ReturnsStreamWithHeaders() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "stream.mp4",
                "uploads/stream.mp4",
                "LOCAL",
                "video/mp4",
                12L,
                "UPLOADED",
                "CAM-01",
                Instant.now(),
                Instant.now(),
                null,
                "hash"
        );

        when(uploadService.getUpload(id)).thenReturn(dto);
        when(uploadService.openStream(id)).thenReturn(new ByteArrayInputStream("video-stream".getBytes()));

        mockMvc.perform(get("/api/videos/" + id + "/stream"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "video/mp4"))
                .andExpect(header().string("Accept-Ranges", "bytes"))
                .andExpect(header().longValue("Content-Length", 12L));
    }

    @Test
    void streamVideo_WithValidRangeHeader_Returns206PartialContent() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "stream.mp4",
                "uploads/stream.mp4",
                "LOCAL",
                "video/mp4",
                1000L,
                "UPLOADED",
                "CAM-01",
                Instant.now(),
                Instant.now(),
                null,
                "hash"
        );

        when(uploadService.getUpload(id)).thenReturn(dto);
        when(uploadService.openStream(id, 100L, 201L)).thenReturn(new ByteArrayInputStream(new byte[201]));

        mockMvc.perform(get("/api/videos/" + id + "/stream")
                        .header("Range", "bytes=100-300"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string("Content-Type", "video/mp4"))
                .andExpect(header().string("Content-Range", "bytes 100-300/1000"))
                .andExpect(header().string("Accept-Ranges", "bytes"))
                .andExpect(header().longValue("Content-Length", 201L));
    }

    @Test
    void streamVideo_WithInvalidRangeHeader_Returns416RangeNotSatisfiable() throws Exception {
        UUID id = UUID.randomUUID();
        VideoUploadDto dto = new VideoUploadDto(
                id,
                "stream.mp4",
                "uploads/stream.mp4",
                "LOCAL",
                "video/mp4",
                500L,
                "UPLOADED",
                "CAM-01",
                Instant.now(),
                Instant.now(),
                null,
                "hash"
        );

        when(uploadService.getUpload(id)).thenReturn(dto);

        mockMvc.perform(get("/api/videos/" + id + "/stream")
                        .header("Range", "bytes=600-700"))
                .andExpect(status().isRequestedRangeNotSatisfiable())
                .andExpect(header().string("Content-Range", "bytes */500"));
    }

    @Test
    void deleteUpload_ExistingId_Returns204NoContent() throws Exception {
        UUID id = UUID.randomUUID();
        mockMvc.perform(delete("/api/videos/" + id))
                .andExpect(status().isNoContent());

        Mockito.verify(uploadService).deleteUpload(id);
    }

    @Test
    void deleteUpload_NonExistentId_Returns404NotFound() throws Exception {
        UUID id = UUID.randomUUID();
        doThrow(new NoSuchElementException("Video not found")).when(uploadService).deleteUpload(id);

        mockMvc.perform(delete("/api/videos/" + id))
                .andExpect(status().isNotFound());
    }

    @Test
    void processVideo_ValidId_Returns202Accepted() throws Exception {
        UUID id = UUID.randomUUID();
        when(uploadService.triggerInferencePipeline(eq(id), eq(false), eq(5)))
                .thenReturn(java.util.Map.of("status", "PROCESSING", "job_id", "job-123"));

        mockMvc.perform(post("/api/videos/" + id + "/process")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"enable_dehaze\":false,\"frame_stride\":5}"))
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("PROCESSING"))
                .andExpect(jsonPath("$.job_id").value("job-123"));
    }

    @Test
    void processVideo_NonExistentId_Returns404NotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(uploadService.triggerInferencePipeline(eq(id), anyBoolean(), anyInt()))
                .thenThrow(new NoSuchElementException("Video not found: " + id));

        mockMvc.perform(post("/api/videos/" + id + "/process"))
                .andExpect(status().isNotFound());
    }

    @Test
    void processVideo_AiServiceDown_Returns503ServiceUnavailable() throws Exception {
        UUID id = UUID.randomUUID();
        when(uploadService.triggerInferencePipeline(eq(id), anyBoolean(), anyInt()))
                .thenThrow(new IllegalStateException("AI inference service is unreachable"));

        mockMvc.perform(post("/api/videos/" + id + "/process"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("AI_SERVICE_UNAVAILABLE"));
    }

    @Test
    void getDetections_ValidId_ReturnsPaginatedDetections() throws Exception {
        UUID id = UUID.randomUUID();
        com.cityai.backend.dto.VehicleDetectionDto detDto = new com.cityai.backend.dto.VehicleDetectionDto(
                1L,
                "CAM-01",
                "Traffic Camera 1",
                Instant.now(),
                12.9716,
                77.5946,
                "North",
                45.0,
                "car",
                0.92,
                "MH12AB1234",
                "MH12AB1234",
                0.95,
                0.88,
                null,
                1,
                10,
                null,
                id,
                "0.10,0.15,0.40,0.45"
        );

        when(uploadService.getDetectionsForVideo(eq(id), any()))
                .thenReturn(new PageImpl<>(List.of(detDto), PageRequest.of(0, 20), 1));

        mockMvc.perform(get("/api/videos/" + id + "/detections?page=0&size=20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].plateTextNormalized").value("MH12AB1234"))
                .andExpect(jsonPath("$.content[0].vehicleClass").value("car"))
                .andExpect(jsonPath("$.content[0].bbox").value("0.10,0.15,0.40,0.45"))
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    void completeProcessing_ValidData_Returns200Ok() throws Exception {
        UUID id = UUID.randomUUID();

        mockMvc.perform(post("/api/videos/" + id + "/complete")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"frames_processed\":150,\"detections_count\":42,\"duration_seconds\":5.2}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UPDATED"))
                .andExpect(jsonPath("$.video_upload_id").value(id.toString()));

        Mockito.verify(uploadService).completeVideoProcessing(eq(id), eq(150), eq(42), eq(5.2), isNull());
    }
}

