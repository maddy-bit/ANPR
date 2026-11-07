package com.cityai.backend.controller;

import com.cityai.backend.dto.AssociateCandidateRequest;
import com.cityai.backend.dto.GlobalIdentityDto;
import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.IdentityAssociationDto;
import com.cityai.backend.dto.ReviewAssociationRequest;
import com.cityai.backend.dto.TrajectoryQualityDto;
import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.service.GlobalIdentityAssociationService;
import com.cityai.backend.service.GlobalTrajectoryService;
import com.cityai.backend.service.TrajectoryQualityService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class GlobalIdentityControllerTest {

    private GlobalIdentityAssociationService associationService;
    private GlobalTrajectoryService trajectoryService;
    private TrajectoryQualityService qualityService;
    private GlobalIdentityController controller;
    private MockMvc mockMvc;
    private ObjectMapper objectMapper;

    @BeforeEach
    void setUp() {
        associationService = Mockito.mock(GlobalIdentityAssociationService.class);
        trajectoryService = Mockito.mock(GlobalTrajectoryService.class);
        qualityService = Mockito.mock(TrajectoryQualityService.class);
        controller = new GlobalIdentityController(associationService, trajectoryService, qualityService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
        objectMapper = new ObjectMapper();
        objectMapper.registerModule(new JavaTimeModule());
    }

    @Test
    @DisplayName("GET /api/identities/{id} returns 200 OK with identity metadata")
    void getIdentity_Found_ReturnsOk() throws Exception {
        UUID id = UUID.randomUUID();
        Instant now = Instant.now();
        GlobalIdentityDto dto = new GlobalIdentityDto(
                id, "GLOBAL-VEH-1001", "MH12AB1234", 0.95, "car", "Blue", "Toyota", "Corolla",
                "ACTIVE", null, now.minusSeconds(300), now, 3, "FastReID-SBS-R50-ibn", "1.0", 2048
        );

        when(associationService.getGlobalIdentity(id)).thenReturn(dto);

        mockMvc.perform(get("/api/identities/{id}", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id.toString()))
                .andExpect(jsonPath("$.label").value("GLOBAL-VEH-1001"))
                .andExpect(jsonPath("$.primaryPlate").value("MH12AB1234"))
                .andExpect(jsonPath("$.detectionCount").value(3))
                .andExpect(jsonPath("$.reidModelName").value("FastReID-SBS-R50-ibn"));
    }

    @Test
    @DisplayName("GET /api/identities/{id} returns 404 when identity not found")
    void getIdentity_NotFound_Returns404() throws Exception {
        UUID id = UUID.randomUUID();
        when(associationService.getGlobalIdentity(id)).thenThrow(new NoSuchElementException("Global identity not found"));

        mockMvc.perform(get("/api/identities/{id}", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/detections returns 200 with paginated detection history")
    void getIdentityDetections_ReturnsPage() throws Exception {
        UUID id = UUID.randomUUID();
        Camera cam = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", null);
        VehicleDetection det = new VehicleDetection(null, cam, Instant.now());
        det.setId(101L);
        det.setLatitude(18.5308);
        det.setLongitude(73.8474);
        det.setDirection("SE");
        det.setSpeedKmh(45.0);
        det.setVehicleClass("car");
        det.setPlateTextNormalized("MH12AB1234");

        when(associationService.getIdentityDetections(eq(id), any()))
                .thenReturn(new PageImpl<>(Objects.requireNonNull(List.of(VehicleDetectionDto.from(det))), PageRequest.of(0, 20), 1));

        mockMvc.perform(get("/api/identities/{id}/detections", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(101))
                .andExpect(jsonPath("$.content[0].plateTextNormalized").value("MH12AB1234"));
    }

    @Test
    @DisplayName("POST /api/identities/associate evaluates pairwise evidence and returns association")
    void associate_ReturnsAssociationDto() throws Exception {
        UUID assocId = UUID.randomUUID();
        UUID gid = UUID.randomUUID();
        IdentityAssociationDto dto = new IdentityAssociationDto(
                assocId, 1L, 2L, gid, 0.92, 0.95, 1.0, 1.0, 0.93,
                "MATCH", "Multi-signal agreement", "SYSTEM_DECIDED", null,
                "FastReID-SBS-R50-ibn", "1.0", Instant.now()
        );

        when(associationService.associateDetections(1L, 2L, true)).thenReturn(dto);

        AssociateCandidateRequest req = new AssociateCandidateRequest(1L, 2L, true);

        mockMvc.perform(post("/api/identities/associate")
                        .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                        .content(Objects.requireNonNull(objectMapper.writeValueAsString(req))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(assocId.toString()))
                .andExpect(jsonPath("$.decision").value("MATCH"))
                .andExpect(jsonPath("$.sourceDetectionId").value(1))
                .andExpect(jsonPath("$.candidateDetectionId").value(2));
    }

    @Test
    @DisplayName("POST /api/identities/associations/{id}/resolve applies review action")
    void resolveAssociation_ReturnsUpdatedDto() throws Exception {
        UUID assocId = UUID.randomUUID();
        IdentityAssociationDto dto = new IdentityAssociationDto(
                assocId, 1L, 2L, null, 0.88, null, 1.0, 1.0, 0.80,
                "MATCH", "Confirmed by user", "CONFIRMED_BY_USER", "Analyst verified match",
                "FastReID-SBS-R50-ibn", "1.0", Instant.now()
        );

        ReviewAssociationRequest req = new ReviewAssociationRequest("CONFIRM_MATCH", "Analyst verified match", null);
        when(associationService.reviewAssociation(eq(assocId), any())).thenReturn(dto);

        mockMvc.perform(post("/api/identities/associations/{id}/resolve", assocId)
                        .contentType(Objects.requireNonNull(MediaType.APPLICATION_JSON))
                        .content(Objects.requireNonNull(objectMapper.writeValueAsString(req))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.decision").value("MATCH"))
                .andExpect(jsonPath("$.reviewStatus").value("CONFIRMED_BY_USER"))
                .andExpect(jsonPath("$.reviewNotes").value("Analyst verified match"));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory returns 200 OK with trajectory reconstruction")
    void getTrajectory_ReturnsOk() throws Exception {
        UUID id = UUID.randomUUID();
        GlobalTrajectoryDto trajectoryDto = new GlobalTrajectoryDto(
                id, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false,
                1.2, 180.0, Instant.now().minusSeconds(180), Instant.now(),
                List.of(), List.of(), List.of()
        );

        when(trajectoryService.reconstructTrajectory(eq(id))).thenReturn(trajectoryDto);

        mockMvc.perform(get("/api/identities/{id}/trajectory", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.globalIdentityId").value(id.toString()))
                .andExpect(jsonPath("$.primaryPlate").value("MH12AB1234"))
                .andExpect(jsonPath("$.confirmedObservations").value(2))
                .andExpect(jsonPath("$.segmentCount").value(1));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory returns 404 when identity does not exist")
    void getTrajectory_NotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(trajectoryService.reconstructTrajectory(eq(id)))
                .thenThrow(new NoSuchElementException("Global identity not found with id: " + id));

        mockMvc.perform(get("/api/identities/{id}/trajectory", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory returns 400 when UUID is malformed")
    void getTrajectory_InvalidUuid() throws Exception {
        mockMvc.perform(get("/api/identities/invalid-uuid-string/trajectory"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("GET /api/identities returns 200 with paginated identities")
    void listIdentities_ReturnsPage() throws Exception {
        UUID id = UUID.randomUUID();
        GlobalIdentityDto dto = new GlobalIdentityDto(
                id, "GLOBAL-VEH-1001", "MH12AB1234", 0.95, "car", "White", "Honda", "City",
                "ACTIVE", null, Instant.now().minusSeconds(600), Instant.now(), 2, "fastreid-sbs-R50-ibn", "1.0", 512
        );
        when(associationService.listIdentities(any())).thenReturn(new PageImpl<>(Objects.requireNonNull(List.of(dto)), PageRequest.of(0, 20), 1));

        mockMvc.perform(get("/api/identities"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").value(id.toString()))
                .andExpect(jsonPath("$.content[0].label").value("GLOBAL-VEH-1001"));
    }

    @Test
    @DisplayName("GET /api/identities/search returns 200 when identity found")
    void searchIdentity_ReturnsOk() throws Exception {
        UUID id = UUID.randomUUID();
        GlobalIdentityDto dto = new GlobalIdentityDto(
                id, "GLOBAL-VEH-1001", "MH12AB1234", 0.95, "car", "White", "Honda", "City",
                "ACTIVE", null, Instant.now().minusSeconds(600), Instant.now(), 2, "fastreid-sbs-R50-ibn", "1.0", 512
        );
        when(associationService.searchIdentity("MH12AB1234")).thenReturn(dto);

        mockMvc.perform(get("/api/identities/search").param("query", "MH12AB1234"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(id.toString()))
                .andExpect(jsonPath("$.primaryPlate").value("MH12AB1234"));
    }

    @Test
    @DisplayName("GET /api/identities/search returns 400 when query is blank")
    void searchIdentity_BlankQuery_ReturnsBadRequest() throws Exception {
        mockMvc.perform(get("/api/identities/search").param("query", "   "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }

    @Test
    @DisplayName("GET /api/identities/search returns 404 when identity not found")
    void searchIdentity_NotFound_ReturnsNotFound() throws Exception {
        when(associationService.searchIdentity("UNKNOWN-PLATE"))
                .thenThrow(new NoSuchElementException("No global vehicle identity found matching: UNKNOWN-PLATE"));

        mockMvc.perform(get("/api/identities/search").param("query", "UNKNOWN-PLATE"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("GET /api/identities clamps negative page and excessive size bounds")
    void listIdentities_ClampsBounds() throws Exception {
        when(associationService.listIdentities(any()))
                .thenReturn(new PageImpl<>(Objects.requireNonNull(List.<GlobalIdentityDto>of()), PageRequest.of(0, 100), 0));

        mockMvc.perform(get("/api/identities").param("page", "-5").param("size", "500"))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory/quality returns 200 OK with quality assessment")
    void getTrajectoryQuality_ReturnsOk() throws Exception {
        UUID id = UUID.randomUUID();
        TrajectoryQualityDto qualityDto = new TrajectoryQualityDto(
                id, "GLOBAL-VEH-1001", "HIGH_CONFIDENCE", "Verified multi-camera trajectory",
                true, false, false, null, null, List.of("Supporting item"), List.of(), List.of()
        );

        when(qualityService.assessTrajectoryQuality(eq(id))).thenReturn(qualityDto);

        mockMvc.perform(get("/api/identities/{id}/trajectory/quality", id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.globalIdentityId").value(id.toString()))
                .andExpect(jsonPath("$.overallQuality").value("HIGH_CONFIDENCE"))
                .andExpect(jsonPath("$.isCrossCameraConfirmed").value(true));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory/quality returns 404 when identity does not exist")
    void getTrajectoryQuality_NotFound() throws Exception {
        UUID id = UUID.randomUUID();
        when(qualityService.assessTrajectoryQuality(eq(id)))
                .thenThrow(new NoSuchElementException("Global identity not found with id: " + id));

        mockMvc.perform(get("/api/identities/{id}/trajectory/quality", id))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"));
    }

    @Test
    @DisplayName("GET /api/identities/{id}/trajectory/quality returns 400 when UUID is malformed")
    void getTrajectoryQuality_InvalidUuid() throws Exception {
        mockMvc.perform(get("/api/identities/invalid-uuid-string/trajectory/quality"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("INVALID_REQUEST"));
    }
}
