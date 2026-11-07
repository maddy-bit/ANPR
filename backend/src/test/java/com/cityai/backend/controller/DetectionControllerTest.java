package com.cityai.backend.controller;

import com.cityai.backend.dto.CandidateAssociationResponseDto;
import com.cityai.backend.dto.CandidateDetectionDto;
import com.cityai.backend.dto.DetectionIngestRequest;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.service.CandidateAssociationService;
import com.cityai.backend.service.DetectionIngestionService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.time.Instant;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyDouble;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class DetectionControllerTest {

    private DetectionIngestionService ingestionService;
    private CandidateAssociationService candidateAssociationService;
    private DetectionController controller;
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        ingestionService = Mockito.mock(DetectionIngestionService.class);
        candidateAssociationService = Mockito.mock(CandidateAssociationService.class);
        controller = new DetectionController(ingestionService, candidateAssociationService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    @Test
    @DisplayName("POST /api/detections/ingest persists detection and returns 201 Created")
    void ingestDetection_ReturnsCreated() throws Exception {
        Camera cam = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", null);
        VehicleDetection detection = new VehicleDetection(null, cam, Instant.parse("2026-11-04T12:00:00Z"));
        detection.setVehicleClass("car");
        detection.setPlateTextNormalized("MH12AB1234");
        detection.setReidModelName("fastreid_veri_sbs_r50_ibn");
        detection.setReidModelVersion("veri-776-v1");
        detection.setReidDimension(2048);

        when(ingestionService.ingest(any(DetectionIngestRequest.class))).thenReturn(detection);

        DetectionIngestRequest req = new DetectionIngestRequest(
                "CAM-01",
                Instant.parse("2026-11-04T12:00:00Z"),
                "car",
                0.92,
                "MH 12 AB 1234",
                "MH12AB1234",
                0.95,
                1,
                80,
                "CAM-01/crop.jpg",
                0.85,
                List.of(0.1, 0.2),
                null,
                List.of(10.0, 20.0, 100.0, 200.0),
                "fastreid_veri_sbs_r50_ibn",
                "veri-776-v1",
                2048
        );

        mockMvc.perform(post("/api/detections/ingest")
                        .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                        .content(Objects.requireNonNull(objectMapper.writeValueAsString(req))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.cameraId").value("CAM-01"))
                .andExpect(jsonPath("$.plateTextNormalized").value("MH12AB1234"))
                .andExpect(jsonPath("$.reidModelName").value("fastreid_veri_sbs_r50_ibn"))
                .andExpect(jsonPath("$.reidDimension").value(2048));
    }

    @Test
    @DisplayName("GET /api/detections/{id}/candidates returns candidate association payload")
    void getCandidates_ReturnsEvaluatedCandidates() throws Exception {
        CandidateDetectionDto candDto = new CandidateDetectionDto(
                2L,
                "CAM-02",
                Instant.parse("2026-11-04T12:02:00Z"),
                0.85,
                "ROAD_NETWORK_TOPOLOGY",
                120.0,
                25.5,
                "FEASIBLE",
                "Feasible road transit",
                "COMPATIBLE",
                0.88,
                "fastreid_veri_sbs_r50_ibn",
                "veri-776-v1",
                2048,
                "MH12AB1234",
                "car",
                "CAM-02/crop2.jpg"
        );

        CandidateAssociationResponseDto responseDto = new CandidateAssociationResponseDto(
                1L,
                "CAM-01",
                Instant.parse("2026-11-04T12:00:00Z"),
                "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn",
                "veri-776-v1",
                1,
                1,
                List.of(candDto)
        );

        when(candidateAssociationService.findCandidates(eq(1L), anyDouble(), anyDouble(), anyDouble(), anyBoolean()))
                .thenReturn(responseDto);

        mockMvc.perform(get("/api/detections/1/candidates"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sourceDetectionId").value(1))
                .andExpect(jsonPath("$.sourceCameraId").value("CAM-01"))
                .andExpect(jsonPath("$.feasibleCandidatesCount").value(1))
                .andExpect(jsonPath("$.candidates[0].detectionId").value(2))
                .andExpect(jsonPath("$.candidates[0].cameraId").value("CAM-02"))
                .andExpect(jsonPath("$.candidates[0].feasibility").value("FEASIBLE"))
                .andExpect(jsonPath("$.candidates[0].distanceCalculationMethod").value("ROAD_NETWORK_TOPOLOGY"))
                .andExpect(jsonPath("$.candidates[0].reidModelCompatibility").value("COMPATIBLE"))
                .andExpect(jsonPath("$.candidates[0].visualSimilarity").value(0.88));
    }
}
