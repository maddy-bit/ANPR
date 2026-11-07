package com.cityai.backend.service;

import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.TrajectoryObservationDto;
import com.cityai.backend.dto.TrajectoryObservationDto.ObservationProvenanceDto;
import com.cityai.backend.dto.TrajectoryQualityDto;
import com.cityai.backend.dto.TrajectorySegmentDto;
import com.cityai.backend.dto.TrajectoryTransitionDto;
import com.cityai.backend.model.GlobalIdentity;
import com.cityai.backend.model.IdentityAssociation;
import com.cityai.backend.repository.GlobalIdentityRepository;
import com.cityai.backend.repository.IdentityAssociationRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

/**
 * Unit tests for TrajectoryQualityService covering all 12 Batch 3.2 acceptance cases:
 *  1. High-quality trajectory with verified road edges.
 *  2. Geodesic-only trajectory.
 *  3. Impossible transition.
 *  4. Missing coordinates.
 *  5. Missing timestamps.
 *  6. Low detection confidence.
 *  7. Contradictory plate evidence.
 *  8. Missing Re-ID similarity.
 *  9. Single-camera-only observations.
 * 10. Empty trajectory.
 * 11. Pending/rejected associations excluded.
 * 12. Mixed-quality trajectory with multiple warnings.
 */
@SuppressWarnings("null")
class TrajectoryQualityServiceTest {

    private GlobalTrajectoryService trajectoryService;
    private GlobalIdentityRepository identityRepository;
    private IdentityAssociationRepository associationRepository;
    private VehicleDetectionRepository detectionRepository;
    private TrajectoryQualityService qualityService;

    @BeforeEach
    void setUp() {
        trajectoryService = Mockito.mock(GlobalTrajectoryService.class);
        identityRepository = Mockito.mock(GlobalIdentityRepository.class);
        associationRepository = Mockito.mock(IdentityAssociationRepository.class);
        detectionRepository = Mockito.mock(VehicleDetectionRepository.class);

        qualityService = new TrajectoryQualityService(
                trajectoryService,
                identityRepository,
                associationRepository,
                detectionRepository
        );
    }

    private GlobalIdentity createIdentity(UUID id) {
        GlobalIdentity gid = new GlobalIdentity(
                "GLOBAL-VEH-1001", "MH12AB1234", 0.95, "car", "White", "Honda", "City",
                null, "fastreid-sbs-R50-ibn", "1.0", 512,
                Instant.now().minusSeconds(600), Instant.now()
        );
        gid.setId(id);
        return gid;
    }

    private TrajectoryObservationDto createObservation(
            Long id, UUID gid, String camId, Instant timestamp,
            Double lat, Double lon, boolean hasCoords,
            Double detConf, String plate, Double plateConf) {
        return new TrajectoryObservationDto(
                id, gid, camId, camId + " Name", timestamp,
                lat, lon, hasCoords, "SE", 45.0, "car", detConf,
                plate, plateConf, 0.90, "/path/crop.jpg", 101, 10,
                new ObservationProvenanceDto(UUID.randomUUID(), "MATCH", "SYSTEM_DECIDED", 0.92, 1.0, id == 1L)
        );
    }

    private IdentityAssociation createAssoc(UUID gid, Double reidScore, String decision, String reviewStatus) {
        IdentityAssociation assoc = new IdentityAssociation(
                null, null, null,
                reidScore, 1.0, 1.0, 1.0, 0.95,
                decision, "Test reason", "fastreid-sbs-R50-ibn", "1.0"
        );
        assoc.setId(UUID.randomUUID());
        assoc.setReviewStatus(reviewStatus);
        return assoc;
    }

    @Test
    @DisplayName("Case 1: High-quality trajectory with verified road edges achieves HIGH_CONFIDENCE")
    void testCase1_HighQualityTrajectory_VerifiedRoadEdges() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.95, "MH12AB1234", 0.96);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.93, "MH12AB1234", 0.94);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 1.2,
                "VERIFIED_ROAD_NETWORK", "VERIFIED_ROAD_EDGE", true, 36.0,
                "FEASIBLE", "Feasible transit via verified road edge"
        );

        TrajectorySegmentDto seg = new TrajectorySegmentDto(
                1, "VERIFIED_ROAD_CONNECTED_PATH", true, 2, 1L, 2L, t1, t2, 120.0, 1.2, List.of(o1, o2), null
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 1.2, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of(seg)
        );

        IdentityAssociation assoc = createAssoc(gid, 0.92, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("HIGH_CONFIDENCE", quality.overallQuality());
        assertTrue(quality.isCrossCameraConfirmed());
        assertFalse(quality.hasImpossibleTransitions());
        assertFalse(quality.hasContradictions());
        assertEquals(2, quality.counts().distinctCameraCount());
        assertEquals(1, quality.counts().verifiedRoadTransitions());
        assertEquals(0, quality.counts().unverifiedGeodesicTransitions());
        assertEquals("VERIFIED_ROAD_NETWORK", quality.dimensions().spatialTemporalFeasibility().status());
        assertEquals("HIGH", quality.dimensions().detectionConfidence().status());
        assertEquals("CONSISTENT", quality.dimensions().ocrAndPlateConsistency().status());
        assertTrue(quality.dimensions().reidSimilarity().isAvailable());
        assertEquals("COMPLETE", quality.dimensions().evidenceCompleteness().status());
    }

    @Test
    @DisplayName("Case 2: Geodesic-only trajectory is physically feasible but classified MEDIUM_CONFIDENCE")
    void testCase2_GeodesicOnlyTrajectory_MediumConfidence() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.92, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.91, "MH12AB1234", 0.89);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible geodesic transit; road topology unverified"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        IdentityAssociation assoc = createAssoc(gid, 0.88, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("MEDIUM_CONFIDENCE", quality.overallQuality());
        assertTrue(quality.isCrossCameraConfirmed());
        assertEquals("PLAUSIBLE_GEODESIC", quality.dimensions().spatialTemporalFeasibility().status());
        assertEquals(1, quality.counts().unverifiedGeodesicTransitions());
        assertEquals(0, quality.counts().verifiedRoadTransitions());
        assertTrue(quality.missingEvidence().stream().anyMatch(e -> e.contains("Road network calibration missing")));
    }

    @Test
    @DisplayName("Case 3: Impossible transition flagged and reduces quality to LOW_CONFIDENCE")
    void testCase3_ImpossibleTransition_LowConfidence() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:00:02Z"); // 2s for 8.6km

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-06", t2, 18.5089, 73.9260, true, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-06", t1, t2, 2.0, 8.6,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 15480.0,
                "IMPOSSIBLE", "Apparent straight-line speed (15480.0 km/h) exceeds physical threshold (100.0 km/h)"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 2, true, false, 0.0, 2.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("LOW_CONFIDENCE", quality.overallQuality());
        assertTrue(quality.hasImpossibleTransitions());
        assertEquals("CONTAINS_IMPOSSIBLE_TRANSITIONS", quality.dimensions().spatialTemporalFeasibility().status());
        assertTrue(quality.warningsAndContradictions().stream().anyMatch(w -> w.contains("Impossible transition")));
    }

    @Test
    @DisplayName("Case 4: Missing camera coordinates reduces completeness and evaluates unknown feasibility")
    void testCase4_MissingCoordinates_ReducesCompleteness() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        // o2 has missing coordinates
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-UNKNOWN", t2, null, null, false, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-UNKNOWN", t1, t2, 120.0, null,
                "UNKNOWN_COORDINATES", "UNKNOWN", false, null,
                "FEASIBILITY_UNKNOWN", "Missing camera coordinates"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, true, 0.0, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("MEDIUM_CONFIDENCE", quality.overallQuality());
        assertEquals("INSUFFICIENT", quality.dimensions().evidenceCompleteness().status());
        assertEquals(1, quality.dimensions().evidenceCompleteness().missingCoordinatesCount());
        assertTrue(quality.missingEvidence().stream().anyMatch(m -> m.contains("Missing camera coordinates")));
    }

    @Test
    @DisplayName("Case 5: Missing timestamp reduces completeness and evaluates unknown feasibility")
    void testCase5_MissingTimestamp_ReducesCompleteness() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        // o2 missing timestamp
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", null, 18.5236, 73.8478, true, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, null, null, null,
                "UNKNOWN_TIMESTAMPS", "UNKNOWN", false, null,
                "FEASIBILITY_UNKNOWN", "Missing observation timestamp"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, true, 0.0, null, t1, null,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("MEDIUM_CONFIDENCE", quality.overallQuality());
        assertEquals("INSUFFICIENT", quality.dimensions().evidenceCompleteness().status());
        assertEquals(1, quality.dimensions().evidenceCompleteness().missingTimestampsCount());
        assertTrue(quality.missingEvidence().stream().anyMatch(m -> m.contains("Missing timestamps")));
    }

    @Test
    @DisplayName("Case 6: Low detection confidence evaluates as LOW and flags warning")
    void testCase6_LowDetectionConfidence_FlagsWarning() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        // Detections with 0.45 and 0.50 confidence
        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.45, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.50, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible transit"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("LOW_CONFIDENCE", quality.overallQuality());
        assertEquals("LOW", quality.dimensions().detectionConfidence().status());
        assertEquals(2, quality.dimensions().detectionConfidence().lowConfidenceCount());
        assertTrue(quality.warningsAndContradictions().stream().anyMatch(w -> w.contains("Low detection confidence")));
    }

    @Test
    @DisplayName("Case 7: Contradictory plate evidence evaluates as CONTRADICTORY and flags contradiction")
    void testCase7_ContradictoryPlateEvidence_FlagsContradiction() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        // Two conflicting plate readings: MH12AB1234 vs MH12CD5678
        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.95);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.90, "MH12CD5678", 0.94);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible transit"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("LOW_CONFIDENCE", quality.overallQuality());
        assertTrue(quality.hasContradictions());
        assertEquals("CONTRADICTORY", quality.dimensions().ocrAndPlateConsistency().status());
        assertEquals(2, quality.dimensions().ocrAndPlateConsistency().platesSeen().size());
        assertTrue(quality.warningsAndContradictions().stream().anyMatch(w -> w.contains("Plate contradiction")));
    }

    @Test
    @DisplayName("Case 8: Missing Re-ID similarity is not fabricated and noted in missing evidence")
    void testCase8_MissingReidSimilarity_NotFabricated() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible transit"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        // Association with NULL reidSimilarity
        IdentityAssociation assocWithoutReid = createAssoc(gid, null, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assocWithoutReid));

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertFalse(quality.dimensions().reidSimilarity().isAvailable());
        assertEquals("MISSING_EVIDENCE", quality.dimensions().reidSimilarity().status());
        assertNull(quality.dimensions().reidSimilarity().avgScore());
        assertTrue(quality.missingEvidence().stream().anyMatch(m -> m.contains("Vehicle Re-ID")));
    }

    @Test
    @DisplayName("Case 9: Single-camera observations are not misrepresented as cross-camera confirmed")
    void testCase9_SingleCameraObservations_NotCrossCameraConfirmed() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:00:30Z"); // Same camera 30s later

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-01", t2, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-01", t1, t2, 30.0, 0.0,
                "SAME_CAMERA", "SAME_CAMERA", false, 0.0,
                "FEASIBLE", "Same camera observation"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                2, 2, 0, 1, false, false, 0.0, 30.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("INSUFFICIENT_EVIDENCE", quality.overallQuality());
        assertFalse(quality.isCrossCameraConfirmed());
        assertEquals(1, quality.counts().distinctCameraCount());
        assertEquals("SINGLE_POINT_OR_SAME_CAMERA", quality.dimensions().spatialTemporalFeasibility().status());
        assertTrue(quality.warningsAndContradictions().stream().anyMatch(w -> w.contains("Repeated observations originate from a single camera")));
    }

    @Test
    @DisplayName("Case 10: Empty trajectory returns INSUFFICIENT_EVIDENCE")
    void testCase10_EmptyTrajectory_InsufficientEvidence() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", null, null, "ACTIVE",
                0, 0, 0, 0, false, false, 0.0, 0.0, null, null,
                List.of(), List.of(), List.of()
        );

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of());

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("INSUFFICIENT_EVIDENCE", quality.overallQuality());
        assertEquals(0, quality.counts().confirmedObservations());
        assertFalse(quality.isCrossCameraConfirmed());
        assertEquals("INSUFFICIENT_DATA", quality.dimensions().identityMembership().status());
    }

    @Test
    @DisplayName("Case 11: Trajectory with rejected/conflicted associations reflects CONFLICTED identity membership")
    void testCase11_RejectedOrConflictedAssociations_FlagsConflicted() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.90, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.90, "MH12AB1234", 0.90);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible transit"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                3, 2, 1, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        // Association with user rejection
        IdentityAssociation rejectedAssoc = createAssoc(gid, 0.60, "NO_MATCH", "REJECTED_BY_USER");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(rejectedAssoc));

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("LOW_CONFIDENCE", quality.overallQuality());
        assertTrue(quality.hasContradictions());
        assertEquals("CONFLICTED", quality.dimensions().identityMembership().status());
        assertEquals(1, quality.counts().excludedObservations());
        assertTrue(quality.warningsAndContradictions().stream().anyMatch(w -> w.contains("Active association conflict or user rejection")));
    }

    @Test
    @DisplayName("Case 12: Mixed-quality trajectory aggregates multiple warnings and missing evidence")
    void testCase12_MixedQualityTrajectory_AggregatesWarnings() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        // Det 1 has low confidence (0.45), plate missing on Det 2
        TrajectoryObservationDto o1 = createObservation(1L, gid, "CAM-01", t1, 18.5308, 73.8474, true, 0.45, "MH12AB1234", 0.90);
        TrajectoryObservationDto o2 = createObservation(2L, gid, "CAM-02", t2, 18.5236, 73.8478, true, 0.88, null, null);

        TrajectoryTransitionDto trans = new TrajectoryTransitionDto(
                1L, 2L, "CAM-01", "CAM-02", t1, t2, 120.0, 0.8,
                "POSTGIS_GEODESIC_SPHERE", "UNVERIFIED_GEODESIC", false, 24.0,
                "FEASIBLE", "Feasible transit"
        );

        GlobalTrajectoryDto trajectory = new GlobalTrajectoryDto(
                gid, "GLOBAL-VEH-1001", "MH12AB1234", "car", "ACTIVE",
                3, 2, 1, 1, false, false, 0.8, 120.0, t1, t2,
                List.of(o1, o2), List.of(trans), List.of()
        );

        // Re-ID missing
        IdentityAssociation assoc = createAssoc(gid, null, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(trajectoryService.reconstructTrajectory(gid)).thenReturn(trajectory);
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        TrajectoryQualityDto quality = qualityService.assessTrajectoryQuality(gid);

        assertEquals("LOW_CONFIDENCE", quality.overallQuality()); // Due to low detection confidence
        assertEquals("LOW", quality.dimensions().detectionConfidence().status());
        assertFalse(quality.dimensions().reidSimilarity().isAvailable());
        assertEquals("SINGLE_READING", quality.dimensions().ocrAndPlateConsistency().status());
        assertEquals("PARTIAL", quality.dimensions().evidenceCompleteness().status());

        // Verify aggregated warnings and missing evidence
        assertTrue(quality.warningsAndContradictions().size() >= 2);
        assertTrue(quality.missingEvidence().size() >= 2);
    }
}

