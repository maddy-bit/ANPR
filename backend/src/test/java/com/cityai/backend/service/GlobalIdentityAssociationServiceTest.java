package com.cityai.backend.service;

import com.cityai.backend.dto.IdentityAssociationDto;
import com.cityai.backend.dto.ReviewAssociationRequest;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.GlobalIdentity;
import com.cityai.backend.model.IdentityAssociation;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.GlobalIdentityRepository;
import com.cityai.backend.repository.IdentityAssociationRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@SuppressWarnings("null")
class GlobalIdentityAssociationServiceTest {

    @Mock
    private VehicleDetectionRepository detectionRepository;

    @Mock
    private GlobalIdentityRepository identityRepository;

    @Mock
    private IdentityAssociationRepository associationRepository;

    private GlobalIdentityAssociationService service;

    private Camera cam1;
    private Camera cam2;
    private Camera camDistant;

    private Instant baseTime;

    @BeforeEach
    void setUp() {
        service = new GlobalIdentityAssociationService(detectionRepository, identityRepository, associationRepository, null);

        // Pune coordinates: CAM-01 (18.5308, 73.8474) and CAM-02 (18.5236, 73.8478) are ~0.8 km apart
        cam1 = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", null);
        cam2 = new Camera("CAM-02", "FC Road", 18.5236, 73.8478, "S", "ONLINE", null);
        // CAM-06 (18.5089, 73.9260) is ~8.5 km apart
        camDistant = new Camera("CAM-06", "Hadapsar", 18.5089, 73.9260, "E", "ONLINE", null);

        baseTime = Instant.parse("2026-11-04T12:00:00Z");
    }

    private VehicleDetection createDetection(
            Long id, Camera camera, Instant timestamp,
            String plate, Double plateConf, String vClass,
            String modelName, String modelVer, Integer dim, String embeddingStr) {
        VehicleDetection det = new VehicleDetection(null, camera, timestamp);
        det.setId(id);
        det.setLatitude(camera.getLatitude());
        det.setLongitude(camera.getLongitude());
        det.setDirection("N");
        det.setSpeedKmh(35.0);
        det.setVehicleClass(vClass);
        det.setDetectionConfidence(0.95);
        det.setPlateTextRaw(plate);
        det.setPlateTextNormalized(plate);
        det.setPlateConfidence(plateConf);
        det.setReidConfidence(0.90);
        det.setImagePath("/crops/" + id + ".jpg");
        det.setTrackId(id.intValue());
        det.setFrameNumber(100);
        det.setReidEmbedding(embeddingStr);
        det.setBbox("[10, 10, 100, 100]");
        det.setReidModelName(modelName);
        det.setReidModelVersion(modelVer);
        det.setReidDimension(dim);
        return det;
    }

    private String createUnitEmbedding(int dim, double fill) {
        double[] arr = new double[dim];
        for (int i = 0; i < dim; i++) arr[i] = fill;
        double norm = Math.sqrt(dim * fill * fill);
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < dim; i++) {
            if (i > 0) sb.append(", ");
            sb.append(String.format("%.6f", arr[i] / norm));
        }
        sb.append("]");
        return sb.toString();
    }

    @Test
    @DisplayName("Matching plates + high visual similarity + feasible topology -> MATCH and creates GlobalIdentity")
    void associate_MatchingPlatesAndHighVisual_ReturnsMatch() {
        String emb = createUnitEmbedding(2048, 0.05);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.92, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), "MH12AB1234", 0.90, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(identityRepository.save(any(GlobalIdentity.class))).thenAnswer(inv -> {
            GlobalIdentity g = inv.getArgument(0);
            g.setId(UUID.randomUUID());
            return g;
        });
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.decision()).isEqualTo("MATCH");
        assertThat(result.overallScore()).isGreaterThanOrEqualTo(0.80);
        assertThat(result.globalIdentityId()).isNotNull();
        assertThat(d1.getGlobalIdentity()).isNotNull();
        assertThat(d2.getGlobalIdentity()).isNotNull();
        assertThat(d1.getGlobalIdentity().getId()).isEqualTo(d2.getGlobalIdentity().getId());
    }

    @Test
    @DisplayName("High-confidence plate conflict overrides visual similarity -> NO_MATCH")
    void associate_ConflictingPlates_ReturnsNoMatch() {
        String emb = createUnitEmbedding(2048, 0.05);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.92, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), "DL01XY9999", 0.90, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.decision()).isEqualTo("NO_MATCH");
        assertThat(result.decisionReason()).containsIgnoringCase("plate conflict");
        assertThat(d1.getGlobalIdentity()).isNull();
        assertThat(d2.getGlobalIdentity()).isNull();
        verify(identityRepository, never()).save(any());
    }

    @Test
    @DisplayName("Visual similarity alone without plate verification must not declare MATCH -> UNCERTAIN")
    void associate_MissingPlateHighVisual_ReturnsUncertain() {
        String emb = createUnitEmbedding(2048, 0.05);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, null, null, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), null, null, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.decision()).isEqualTo("UNCERTAIN");
        assertThat(result.reviewStatus()).isEqualTo("PENDING_REVIEW");
        assertThat(result.decisionReason()).containsIgnoringCase("visual similarity");
        assertThat(d1.getGlobalIdentity()).isNull();
        verify(identityRepository, never()).save(any());
    }

    @Test
    @DisplayName("Physically impossible speed transition -> NO_MATCH")
    void associate_ImpossibleTransition_ReturnsNoMatch() {
        String emb = createUnitEmbedding(2048, 0.05);
        // 8.5 km distance in 1 second = 30,600 km/h (violates 100 km/h max speed)
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.92, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, camDistant, baseTime.plusSeconds(1), "MH12AB1234", 0.90, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.decision()).isEqualTo("NO_MATCH");
        assertThat(result.decisionReason()).containsIgnoringCase("exceeds maximum limit");
        assertThat(result.overallScore()).isEqualTo(0.0);
    }

    @Test
    @DisplayName("Incompatible Re-ID models rejects embedding comparison")
    void associate_IncompatibleModels_RejectsComparison() {
        String emb2048 = createUnitEmbedding(2048, 0.05);
        String emb512 = createUnitEmbedding(512, 0.1);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, null, null, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb2048);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), null, null, "car",
                "ImageNet-ResNet50", "0.1", 512, emb512);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.reidScore()).isNull();
        assertThat(result.decision()).isEqualTo("UNCERTAIN");
    }

    @Test
    @DisplayName("Existing separate global identities prevents silent automatic merge -> UNCERTAIN / PENDING_REVIEW")
    void associate_ExistingSeparateIdentities_PreventsSilentMerge() {
        String emb = createUnitEmbedding(2048, 0.05);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.92, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), "MH12AB1234", 0.90, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        GlobalIdentity g1 = new GlobalIdentity("GLOBAL-VEH-1001", "MH12AB1234", 0.92, "car", null, null, null, emb, "FastReID", "1.0", 2048, baseTime, baseTime);
        g1.setId(UUID.randomUUID());
        d1.setGlobalIdentity(g1);

        GlobalIdentity g2 = new GlobalIdentity("GLOBAL-VEH-1002", "MH12AB1234", 0.90, "car", null, null, null, emb, "FastReID", "1.0", 2048, baseTime.plusSeconds(80), baseTime.plusSeconds(80));
        g2.setId(UUID.randomUUID());
        d2.setGlobalIdentity(g2);

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.empty());
        when(detectionRepository.findById(1L)).thenReturn(Optional.of(d1));
        when(detectionRepository.findById(2L)).thenReturn(Optional.of(d2));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> {
            IdentityAssociation a = inv.getArgument(0);
            a.setId(UUID.randomUUID());
            return a;
        });

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.decision()).isEqualTo("UNCERTAIN");
        assertThat(result.reviewStatus()).isEqualTo("PENDING_REVIEW");
        assertThat(result.decisionReason()).containsIgnoringCase("separate existing global identities");
        // Detections must retain their original separate identities (no destructive merge)
        assertThat(d1.getGlobalIdentity().getId()).isEqualTo(g1.getId());
        assertThat(d2.getGlobalIdentity().getId()).isEqualTo(g2.getId());
    }

    @Test
    @DisplayName("Review resolution: CONFIRM_MATCH assigns identity and marks CONFIRMED_BY_USER")
    void reviewAssociation_ConfirmMatch_UpdatesRecord() {
        String emb = createUnitEmbedding(2048, 0.05);
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.92, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), "MH12AB1234", 0.90, "car",
                "FastReID-SBS-R50-ibn", "1.0", 2048, emb);

        UUID assocId = UUID.randomUUID();
        IdentityAssociation assoc = new IdentityAssociation(d1, d2, null, 0.95, 0.92, 1.0, 1.0, 0.93,
                "UNCERTAIN", "Pending review", "FastReID", "1.0");
        assoc.setId(assocId);
        assoc.setReviewStatus("PENDING_REVIEW");

        when(associationRepository.findById(assocId)).thenReturn(Optional.of(assoc));
        when(identityRepository.save(any(GlobalIdentity.class))).thenAnswer(inv -> {
            GlobalIdentity g = inv.getArgument(0);
            g.setId(UUID.randomUUID());
            return g;
        });
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> inv.getArgument(0));

        ReviewAssociationRequest req = new ReviewAssociationRequest("CONFIRM_MATCH", "Verified by analyst", null);
        IdentityAssociationDto result = service.reviewAssociation(assocId, req);

        assertThat(result.decision()).isEqualTo("MATCH");
        assertThat(result.reviewStatus()).isEqualTo("CONFIRMED_BY_USER");
        assertThat(result.reviewNotes()).isEqualTo("Verified by analyst");
    }

    @Test
    @DisplayName("Review resolution: REJECT_MATCH sets NO_MATCH and REJECTED_BY_USER")
    void reviewAssociation_RejectMatch_SetsNoMatch() {
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, null, null, "car", null, null, null, null);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), null, null, "car", null, null, null, null);

        UUID assocId = UUID.randomUUID();
        IdentityAssociation assoc = new IdentityAssociation(d1, d2, null, 0.85, null, 1.0, 1.0, 0.75,
                "UNCERTAIN", "Visual only", null, null);
        assoc.setId(assocId);
        assoc.setReviewStatus("PENDING_REVIEW");

        when(associationRepository.findById(assocId)).thenReturn(Optional.of(assoc));
        when(associationRepository.save(any(IdentityAssociation.class))).thenAnswer(inv -> inv.getArgument(0));

        ReviewAssociationRequest req = new ReviewAssociationRequest("REJECT_MATCH", "Different stickers on bumper", null);
        IdentityAssociationDto result = service.reviewAssociation(assocId, req);

        assertThat(result.decision()).isEqualTo("NO_MATCH");
        assertThat(result.reviewStatus()).isEqualTo("REJECTED_BY_USER");
        assertThat(result.reviewNotes()).isEqualTo("Different stickers on bumper");
    }

    @Test
    @DisplayName("Duplicate association request returns existing audit record without duplicate re-evaluation")
    void associate_DuplicateRequest_ReturnsExistingRecord() {
        VehicleDetection d1 = createDetection(1L, cam1, baseTime, "MH12AB1234", 0.90, "car", null, null, null, null);
        VehicleDetection d2 = createDetection(2L, cam2, baseTime.plusSeconds(80), "MH12AB1234", 0.90, "car", null, null, null, null);

        IdentityAssociation existing = new IdentityAssociation(d1, d2, null, 0.90, 0.95, 1.0, 1.0, 0.92,
                "MATCH", "Initial match", null, null);
        existing.setId(UUID.randomUUID());

        when(associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(1L, 2L)).thenReturn(Optional.of(existing));

        IdentityAssociationDto result = service.associateDetections(1L, 2L, true);

        assertThat(result.id()).isEqualTo(existing.getId());
        assertThat(result.decision()).isEqualTo("MATCH");
        verify(detectionRepository, never()).findById(any());
    }

    @Test
    @DisplayName("Associating detection with itself throws IllegalArgumentException")
    void associate_SameDetection_ThrowsException() {
        assertThatThrownBy(() -> service.associateDetections(1L, 1L, true))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("Cannot associate a detection with itself");
    }
}
