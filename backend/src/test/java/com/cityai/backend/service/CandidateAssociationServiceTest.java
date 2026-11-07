package com.cityai.backend.service;

import com.cityai.backend.dto.CandidateAssociationResponseDto;
import com.cityai.backend.dto.CandidateDetectionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.CameraRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CandidateAssociationServiceTest {

    @Mock
    private VehicleDetectionRepository detectionRepository;

    @Mock
    private CameraRepository cameraRepository;

    private CandidateAssociationService service;

    private Camera cam1;
    private Camera cam2;
    private Camera camDistant;
    private Camera camUnconfigured;

    private Instant baseTime;

    @BeforeEach
    void setUp() {
        service = new CandidateAssociationService(detectionRepository, cameraRepository, null);

        // Pune coordinates: CAM-01 (18.5308, 73.8474) and CAM-02 (18.5236, 73.8478) are ~0.8 km apart
        cam1 = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", null);
        cam2 = new Camera("CAM-02", "FC Road", 18.5236, 73.8478, "S", "ONLINE", null);
        // CAM-06 (18.5089, 73.9260) is ~8.5 km apart
        camDistant = new Camera("CAM-06", "Hadapsar", 18.5089, 73.9260, "E", "ONLINE", null);
        // Unconfigured camera with 0.0 coordinates
        camUnconfigured = new Camera("CAM-UNKNOWN", "Unknown", 0.0, 0.0, "N", "ONLINE", null);

        baseTime = Instant.parse("2026-11-04T12:00:00Z");
    }

    private VehicleDetection createDetection(
            Long id, Camera camera, Instant timestamp,
            String plate, String modelName, String modelVer, Integer dim, String embeddingStr) {
        VehicleDetection d = new VehicleDetection(null, camera, timestamp);
        ReflectionTestUtils.setField(d, "id", id);
        d.setPlateTextNormalized(plate);
        d.setReidModelName(modelName);
        d.setReidModelVersion(modelVer);
        d.setReidDimension(dim);
        d.setReidEmbedding(embeddingStr);
        d.setVehicleClass("car");
        return d;
    }

    @Test
    @DisplayName("Same-camera candidates are strictly excluded from cross-camera association query")
    void sameCameraCandidates_ExcludedFromResults() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        // Repository query method explicitly filters by Camera_IdNot
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of());

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        assertThat(response.sourceCameraId()).isEqualTo("CAM-01");
        assertThat(response.candidates()).isEmpty();
    }

    @Test
    @DisplayName("Feasible transition between adjacent cameras within urban speed bounds is retained")
    void feasibleTransition_RetainedAsFeasible() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        // 120 seconds for ~0.8 km = ~24 km/h
        VehicleDetection candFeasible = createDetection(2L, cam2, baseTime.plusSeconds(120), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candFeasible));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        assertThat(response.feasibleCandidatesCount()).isEqualTo(1);
        CandidateDetectionDto cand = response.candidates().get(0);
        assertThat(cand.feasibility()).isEqualTo("FEASIBLE");
        assertThat(cand.spatialDistanceKm()).isBetween(0.7, 1.0);
        assertThat(cand.apparentSpeedKmh()).isBetween(20.0, 30.0);
        assertThat(cand.reidModelCompatibility()).isEqualTo("COMPATIBLE");
        assertThat(cand.visualSimilarity()).isEqualTo(1.0);
    }

    @Test
    @DisplayName("Impossible travel-time transitions (supersonic speed) are rejected")
    void impossibleFastTransition_RejectedAsImpossible() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        // 10 seconds for ~8.5 km = ~3060 km/h (impossible speed)
        VehicleDetection candSupersonic = createDetection(3L, camDistant, baseTime.plusSeconds(10), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candSupersonic));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        assertThat(response.feasibleCandidatesCount()).isEqualTo(0);
        CandidateDetectionDto cand = response.candidates().get(0);
        assertThat(cand.feasibility()).isEqualTo("IMPOSSIBLE_TRANSITION");
        assertThat(cand.apparentSpeedKmh()).isGreaterThan(100.0);
        assertThat(cand.feasibilityReason()).contains("exceeds maximum plausible limit");
    }

    @Test
    @DisplayName("Simultaneous sighting at distant cameras is rejected as impossible transition")
    void simultaneousDistantSightings_RejectedAsImpossible() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        // Exact same second (dt = 0.0s) at distant camera
        VehicleDetection candInstant = createDetection(4L, camDistant, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candInstant));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        CandidateDetectionDto cand = response.candidates().get(0);
        assertThat(cand.feasibility()).isEqualTo("IMPOSSIBLE_TRANSITION");
        assertThat(cand.feasibilityReason()).contains("Simultaneous");
    }

    @Test
    @DisplayName("Missing or zero coordinates are handled without fabricating zero distances")
    void missingCoordinates_HandledSafelyWithNullDistance() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        VehicleDetection candUnconfigured = createDetection(5L, camUnconfigured, baseTime.plusSeconds(300), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candUnconfigured));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        CandidateDetectionDto cand = response.candidates().get(0);
        assertThat(cand.feasibility()).isEqualTo("FEASIBILITY_UNKNOWN");
        assertThat(cand.distanceCalculationMethod()).isEqualTo("UNKNOWN_COORDINATES");
        assertThat(cand.spatialDistanceKm()).isNull();
        assertThat(cand.feasibilityReason()).contains("Missing or unconfigured destination camera coordinates");
    }

    @Test
    @DisplayName("Missing source camera coordinates are identified explicitly")
    void missingSourceCoordinates_IdentifiedExplicitly() {
        VehicleDetection source = createDetection(1L, camUnconfigured, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        VehicleDetection cand = createDetection(2L, cam2, baseTime.plusSeconds(120), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-UNKNOWN")))
                .thenReturn(List.of(cand));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        CandidateDetectionDto res = response.candidates().get(0);
        assertThat(res.feasibility()).isEqualTo("FEASIBILITY_UNKNOWN");
        assertThat(res.distanceCalculationMethod()).isEqualTo("UNKNOWN_COORDINATES");
        assertThat(res.spatialDistanceKm()).isNull();
        assertThat(res.feasibilityReason()).contains("Missing or unconfigured source camera coordinates");
    }

    @Test
    @DisplayName("Missing candidate detection timestamp yields FEASIBILITY_UNKNOWN")
    void missingTimestamp_HandledSafelyWithUnknownFeasibility() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        VehicleDetection candNoTime = createDetection(2L, cam2, null, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candNoTime));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        CandidateDetectionDto res = response.candidates().get(0);
        assertThat(res.feasibility()).isEqualTo("FEASIBILITY_UNKNOWN");
        assertThat(res.feasibilityReason()).contains("Missing detection timestamp");
    }

    @Test
    @DisplayName("Old embeddings are strictly prevented from direct comparison with new FastReID embeddings")
    void incompatibleReIdModels_ComparisonRejected() {
        // Source uses new FastReID 2048-dim embedding
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        // Candidate has legacy ImageNet embedding from A4 (also 2048-dim, but completely incompatible latent space!)
        VehicleDetection candLegacy = createDetection(6L, cam2, baseTime.plusSeconds(120), "MH12AB1234",
                "resnet50_imagenet", "legacy-v0", 2048, "[1.0, 0.0]");

        // Candidate with null model metadata (historical pre-A5 record)
        VehicleDetection candHistorical = createDetection(7L, cam2, baseTime.plusSeconds(150), "MH12AB1234",
                null, null, null, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candLegacy, candHistorical));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, false);

        assertThat(response.candidates()).hasSize(2);

        CandidateDetectionDto dtoLegacy = response.candidates().get(0);
        assertThat(dtoLegacy.reidModelCompatibility()).isEqualTo("INCOMPATIBLE_MODEL_VERSION");
        assertThat(dtoLegacy.visualSimilarity()).isNull();

        CandidateDetectionDto dtoHistorical = response.candidates().get(1);
        assertThat(dtoHistorical.reidModelCompatibility()).isEqualTo("INCOMPATIBLE_MODEL_VERSION");
        assertThat(dtoHistorical.visualSimilarity()).isNull();
    }

    @Test
    @DisplayName("feasibleOnly parameter filters out impossible and out-of-window candidates")
    void feasibleOnly_FiltersNonFeasibleCandidates() {
        VehicleDetection source = createDetection(1L, cam1, baseTime, "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        VehicleDetection candFeasible = createDetection(2L, cam2, baseTime.plusSeconds(120), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        VehicleDetection candImpossible = createDetection(3L, camDistant, baseTime.plusSeconds(10), "MH12AB1234",
                "fastreid_veri_sbs_r50_ibn", "veri-776-v1", 2048, "[1.0, 0.0]");

        when(detectionRepository.findById(1L)).thenReturn(Optional.of(source));
        when(detectionRepository.findByTimestampBetweenAndCamera_IdNotOrderByTimestampAsc(any(), any(), eq("CAM-01")))
                .thenReturn(List.of(candFeasible, candImpossible));

        CandidateAssociationResponseDto response = service.findCandidates(1L, 5.0, 100.0, 7200.0, true);

        assertThat(response.totalCandidatesEvaluated()).isEqualTo(2);
        assertThat(response.feasibleCandidatesCount()).isEqualTo(1);
        assertThat(response.candidates()).hasSize(1);
        assertThat(response.candidates().get(0).detectionId()).isEqualTo(2L);
    }
}

