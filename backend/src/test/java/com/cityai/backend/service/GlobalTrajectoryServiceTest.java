package com.cityai.backend.service;

import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.TrajectoryObservationDto;
import com.cityai.backend.dto.TrajectorySegmentDto;
import com.cityai.backend.dto.TrajectoryTransitionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.GlobalIdentity;
import com.cityai.backend.model.IdentityAssociation;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.GlobalIdentityRepository;
import com.cityai.backend.repository.IdentityAssociationRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.when;

/**
 * Unit tests for GlobalTrajectoryService covering all 12 acceptance cases:
 *   1. Two confirmed detections from different cameras.
 *   2. Multiple detections sorted chronologically.
 *   3. Pending-review association excluded.
 *   4. Rejected association excluded.
 *   5. Impossible speed transition flagged.
 *   6. Missing camera coordinates.
 *   7. Missing timestamps.
 *   8. Unverified topology.
 *   9. Same-camera repeated observations.
 *  10. Multiple disconnected trajectory segments.
 *  11. Nonexistent global identity.
 *  12. Empty trajectory.
 */
@SuppressWarnings({"null", "unchecked"})
class GlobalTrajectoryServiceTest {

    private GlobalIdentityRepository identityRepository;
    private VehicleDetectionRepository detectionRepository;
    private IdentityAssociationRepository associationRepository;
    private JdbcTemplate jdbcTemplate;
    private GlobalTrajectoryService trajectoryService;

    private Camera cam1;
    private Camera cam2;
    private Camera cam3;
    private Camera camUnconfigured;

    @BeforeEach
    void setUp() {
        identityRepository = Mockito.mock(GlobalIdentityRepository.class);
        detectionRepository = Mockito.mock(VehicleDetectionRepository.class);
        associationRepository = Mockito.mock(IdentityAssociationRepository.class);
        jdbcTemplate = Mockito.mock(JdbcTemplate.class);

        trajectoryService = new GlobalTrajectoryService(
                identityRepository,
                detectionRepository,
                associationRepository,
                jdbcTemplate
        );

        cam1 = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", null);
        cam2 = new Camera("CAM-02", "FC Road", 18.5236, 73.8478, "S", "ONLINE", null);
        cam3 = new Camera("CAM-06", "Hadapsar", 18.5089, 73.9260, "E", "ONLINE", null);
        camUnconfigured = new Camera("CAM-UNKNOWN", "Unconfigured", 0.0, 0.0, "N", "ONLINE", null);
    }

    private GlobalIdentity createIdentity(UUID id) {
        GlobalIdentity gid = new GlobalIdentity(
                "GLOBAL-VEH-1001",
                "MH12AB1234",
                0.95,
                "car",
                "White",
                "Honda",
                "City",
                null,
                "fastreid-sbs-R50-ibn",
                "1.0",
                512,
                Instant.now().minusSeconds(600),
                Instant.now()
        );
        gid.setId(id);
        return gid;
    }

    private VehicleDetection createDetection(Long id, Camera cam, Instant timestamp, GlobalIdentity gid) {
        VehicleDetection det = new VehicleDetection(null, cam, timestamp);
        det.setId(id);
        det.setLatitude(cam.getLatitude());
        det.setLongitude(cam.getLongitude());
        det.setDirection(cam.getDirection());
        det.setSpeedKmh(45.0);
        det.setVehicleClass("car");
        det.setDetectionConfidence(0.95);
        det.setPlateTextNormalized("MH12AB1234");
        det.setPlateConfidence(0.92);
        det.setGlobalIdentity(gid);
        return det;
    }

    private IdentityAssociation createAssoc(
            VehicleDetection d1,
            VehicleDetection d2,
            GlobalIdentity gid,
            String decision,
            String reviewStatus) {
        IdentityAssociation assoc = new IdentityAssociation(
                d1, d2, gid,
                0.90, 0.95, 1.0, 1.0, 0.92,
                decision, "Test association reason",
                "fastreid-sbs-R50-ibn", "1.0"
        );
        assoc.setId(UUID.randomUUID());
        assoc.setReviewStatus(reviewStatus);
        return assoc;
    }

    @Test
    @DisplayName("Case 1: Two confirmed detections from different cameras form a feasible transition")
    void testCase1_TwoConfirmedDetections_DifferentCameras() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z"); // 120s later

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        IdentityAssociation assoc = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertNotNull(trajectory);
        assertEquals(2, trajectory.confirmedObservations());
        assertEquals(0, trajectory.excludedObservations());
        assertEquals(1, trajectory.transitions().size());
        assertEquals(1, trajectory.segmentCount());

        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals(1L, transition.fromDetectionId());
        assertEquals(2L, transition.toDetectionId());
        assertEquals("CAM-01", transition.fromCameraId());
        assertEquals("CAM-02", transition.toCameraId());
        assertEquals("FEASIBLE", transition.status());
        assertEquals("UNVERIFIED_GEODESIC", transition.connectivity());
        assertFalse(transition.isVerifiedTopology());
        assertFalse(trajectory.hasImpossibleTransitions());
        assertEquals("PLAUSIBLE_CHRONOLOGICAL_SEQUENCE", trajectory.segments().get(0).segmentType());
        assertFalse(trajectory.segments().get(0).isFullyVerifiedRoadRoute());
    }

    @Test
    @DisplayName("Case 2: Multiple detections sorted chronologically, handling identical timestamps deterministically")
    void testCase2_MultipleDetections_SortedChronologically_AndDeterministicTies() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:05:00Z");

        // Two detections with identical timestamps at different cameras, plus an earlier one
        VehicleDetection d3 = createDetection(30L, cam2, t2, identity);
        VehicleDetection d2 = createDetection(20L, cam1, t2, identity); // Tied timestamp with d3, smaller ID
        VehicleDetection d1 = createDetection(10L, cam1, t1, identity);

        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");
        IdentityAssociation a23 = createAssoc(d2, d3, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        // Intentionally provide out of order in mock
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d3, d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12, a23));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(3, trajectory.confirmedObservations());
        List<TrajectoryObservationDto> obs = trajectory.observations();
        // d1 (10L) must be first (10:00:00Z)
        assertEquals(10L, obs.get(0).detectionId());
        // For identical timestamp 10:05:00Z, d2 (20L) must precede d3 (30L)
        assertEquals(20L, obs.get(1).detectionId());
        assertEquals(30L, obs.get(2).detectionId());
    }

    @Test
    @DisplayName("Case 3: Detection connected only through PENDING_REVIEW association is excluded")
    void testCase3_PendingReviewAssociation_Excluded() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        // Only a PENDING_REVIEW association exists
        IdentityAssociation pendingAssoc = createAssoc(d1, d2, identity, "UNCERTAIN", "PENDING_REVIEW");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(pendingAssoc));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        // Both d1 and d2 have ONLY a PENDING_REVIEW association; neither is confirmed!
        assertEquals(0, trajectory.confirmedObservations());
        assertEquals(2, trajectory.excludedObservations());
        assertEquals(0, trajectory.segmentCount());
    }

    @Test
    @DisplayName("Case 4: Detection connected only through rejected association is excluded")
    void testCase4_RejectedAssociation_Excluded() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");
        Instant t3 = Instant.parse("2026-11-04T10:04:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        VehicleDetection d3 = createDetection(3L, cam3, t3, identity);

        // d1 & d2 confirmed
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");
        // d3 rejected
        IdentityAssociation a23 = createAssoc(d2, d3, identity, "NO_MATCH", "REJECTED_BY_USER");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2, d3));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12, a23));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(2, trajectory.confirmedObservations());
        assertEquals(1, trajectory.excludedObservations());
        assertEquals(1L, trajectory.observations().get(0).detectionId());
        assertEquals(2L, trajectory.observations().get(1).detectionId());
    }

    @Test
    @DisplayName("Case 5: Impossible speed transition flagged as IMPOSSIBLE and not discarded")
    void testCase5_ImpossibleSpeedTransition_Flagged() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:00:02Z"); // 2 seconds later for 8.64 km (~15547 km/h)

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam3, t2, identity); // Hadapsar (8.64 km away)
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(2, trajectory.confirmedObservations());
        assertEquals(1, trajectory.transitions().size());
        assertTrue(trajectory.hasImpossibleTransitions());

        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("IMPOSSIBLE", transition.status());
        assertTrue(transition.apparentSpeedKmh() > 1000.0);
        assertTrue(transition.reason().contains("exceeds physical threshold"));
    }

    @Test
    @DisplayName("Case 6: Missing camera coordinates evaluated as FEASIBILITY_UNKNOWN without fabricating location")
    void testCase6_MissingCameraCoordinates_FeasibilityUnknown() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, camUnconfigured, t2, identity); // Coordinates 0.0, 0.0
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(2, trajectory.confirmedObservations());
        assertFalse(trajectory.observations().get(1).hasCoordinates());
        assertNull(trajectory.observations().get(1).latitude());

        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBILITY_UNKNOWN", transition.status());
        assertEquals("UNKNOWN_COORDINATES", transition.distanceMethod());
        assertNull(transition.distanceKm());
        assertTrue(trajectory.hasUnknownFeasibility());
    }

    @Test
    @DisplayName("Case 7: Missing timestamp evaluated as FEASIBILITY_UNKNOWN")
    void testCase7_MissingTimestamp_FeasibilityUnknown() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, null, identity); // Missing timestamp
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(2, trajectory.confirmedObservations());
        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBILITY_UNKNOWN", transition.status());
        assertEquals("UNKNOWN_TIMESTAMPS", transition.distanceMethod());
        assertNull(transition.deltaSeconds());
    }

    @Test
    @DisplayName("Case 8: Unverified topology remains explicitly unverified without assuming road route")
    void testCase8_UnverifiedTopology_RemainsExplicitlyUnverified() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:03:00Z"); // 180s later

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12));
        // Return null for road edge lookup to simulate absence of verified road topology
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(), any())).thenReturn(Collections.emptyList());

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertFalse(transition.isVerifiedTopology());
        assertEquals("UNVERIFIED_GEODESIC", transition.connectivity());
        assertTrue(transition.reason().contains("unverified geodesic path"));
        assertNotEquals("VERIFIED_ROAD_NETWORK", transition.distanceMethod());
    }

    @Test
    @DisplayName("Case 9: Same-camera repeated observations evaluated as 0.0 km and FEASIBLE")
    void testCase9_SameCameraObservations_Feasible() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:00:30Z"); // 30s later at same camera

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam1, t2, identity); // Same camera
        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(2, trajectory.confirmedObservations());
        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBLE", transition.status());
        assertEquals("SAME_CAMERA", transition.distanceMethod());
        assertEquals("SAME_CAMERA", transition.connectivity());
        assertEquals(0.0, transition.distanceKm());
        assertFalse(transition.isVerifiedTopology());
    }

    @Test
    @DisplayName("Case 10: Multiple disconnected trajectory segments created when transitions are impossible")
    void testCase10_MultipleDisconnectedSegments_WhenTransitionImpossible() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:01:30Z"); // Feasible to cam2
        Instant t3 = Instant.parse("2026-11-04T10:01:32Z"); // Impossible jump to cam3 (2s for 8.6km)
        Instant t4 = Instant.parse("2026-11-04T10:03:00Z"); // Feasible after cam3

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        VehicleDetection d3 = createDetection(3L, cam3, t3, identity);
        VehicleDetection d4 = createDetection(4L, cam3, t4, identity);

        IdentityAssociation a12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");
        IdentityAssociation a23 = createAssoc(d2, d3, identity, "MATCH", "CONFIRMED_BY_USER");
        IdentityAssociation a34 = createAssoc(d3, d4, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2, d3, d4));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(a12, a23, a34));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(4, trajectory.confirmedObservations());
        assertEquals(3, trajectory.transitions().size());
        // Trajectory must have 2 disconnected segments because transition 2->3 is impossible
        assertEquals(2, trajectory.segmentCount());

        TrajectorySegmentDto seg1 = trajectory.segments().get(0);
        assertEquals(1, seg1.segmentIndex());
        assertEquals(2, seg1.observationCount());
        assertEquals(1L, seg1.startObservationId());
        assertEquals(2L, seg1.endObservationId());
        assertNull(seg1.breakReason());

        TrajectorySegmentDto seg2 = trajectory.segments().get(1);
        assertEquals(2, seg2.segmentIndex());
        assertEquals(2, seg2.observationCount());
        assertEquals(3L, seg2.startObservationId());
        assertEquals(4L, seg2.endObservationId());
        assertNotNull(seg2.breakReason());
        assertTrue(seg2.breakReason().contains("Segment break at detection 2 -> 3"));
    }

    @Test
    @DisplayName("Case 11: Nonexistent global identity throws NoSuchElementException")
    void testCase11_NonexistentGlobalIdentity_ThrowsException() {
        UUID nonexistent = UUID.randomUUID();
        when(identityRepository.findById(nonexistent)).thenReturn(Optional.empty());

        assertThrows(NoSuchElementException.class, () -> {
            trajectoryService.reconstructTrajectory(nonexistent);
        });
    }

    @Test
    @DisplayName("Case 12: Empty trajectory for identity with zero detections returns valid empty DTO")
    void testCase12_EmptyTrajectory_ReturnsValidEmptyDto() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(Collections.emptyList());
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(Collections.emptyList());

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertNotNull(trajectory);
        assertEquals(0, trajectory.totalObservations());
        assertEquals(0, trajectory.confirmedObservations());
        assertEquals(0, trajectory.excludedObservations());
        assertEquals(0, trajectory.segmentCount());
        assertTrue(trajectory.observations().isEmpty());
        assertTrue(trajectory.transitions().isEmpty());
        assertTrue(trajectory.segments().isEmpty());
        assertFalse(trajectory.hasImpossibleTransitions());
        assertFalse(trajectory.hasUnknownFeasibility());
    }

    @Test
    @DisplayName("Semantic 1: Unverified geodesic transition labelled distinctly from verified road connectivity")
    void testSemantic_UnverifiedGeodesic_DistinctFromVerifiedRoadConnectivity() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        IdentityAssociation assoc = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));
        // No verified road edge in DB
        when(jdbcTemplate.query(anyString(), any(RowMapper.class), any(), any())).thenReturn(Collections.emptyList());

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(1, trajectory.transitions().size());
        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBLE", transition.status());
        assertEquals("UNVERIFIED_GEODESIC", transition.connectivity());
        assertFalse(transition.isVerifiedTopology());
        assertEquals("POSTGIS_GEODESIC_SPHERE", transition.distanceMethod());
        assertTrue(transition.reason().contains("does not prove actual travelled road route"));

        TrajectorySegmentDto segment = trajectory.segments().get(0);
        assertEquals("PLAUSIBLE_CHRONOLOGICAL_SEQUENCE", segment.segmentType());
        assertFalse(segment.isFullyVerifiedRoadRoute());
    }

    @Test
    @DisplayName("Semantic 2: Same-camera transition not labelled verified road topology")
    void testSemantic_SameCamera_NotLabelledVerifiedRoadTopology() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:01:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam1, t2, identity);
        IdentityAssociation assoc = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(1, trajectory.transitions().size());
        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBLE", transition.status());
        assertEquals("SAME_CAMERA", transition.connectivity());
        assertFalse(transition.isVerifiedTopology());
        assertEquals("SAME_CAMERA", transition.distanceMethod());
        assertEquals(0.0, transition.distanceKm());
        assertTrue(transition.reason().contains("stationary or repeated sighting, not a road transition"));
    }

    @Test
    @DisplayName("Semantic 3: Unassociated unrelated detection excluded when identity has confirmed associations")
    void testSemantic_UnassociatedUnrelatedDetection_Excluded() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");
        Instant t3 = Instant.parse("2026-11-04T10:04:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        // d3 is tagged with gid foreign key in vehicle_detections, but NO association record links d3
        VehicleDetection d3 = createDetection(3L, cam3, t3, identity);

        IdentityAssociation assoc12 = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2, d3));
        // associations only contain assoc12
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc12));

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(3, trajectory.totalObservations());
        assertEquals(2, trajectory.confirmedObservations());
        assertEquals(1, trajectory.excludedObservations());
        assertEquals(1, trajectory.transitions().size());
        assertEquals(1L, trajectory.observations().get(0).detectionId());
        assertEquals(2L, trajectory.observations().get(1).detectionId());
    }

    @Test
    @DisplayName("Semantic 4: Verified road-edge transition correctly identified as VERIFIED_ROAD_EDGE")
    void testSemantic_VerifiedRoadEdgeTransition_CorrectlyIdentified() {
        UUID gid = UUID.randomUUID();
        GlobalIdentity identity = createIdentity(gid);
        Instant t1 = Instant.parse("2026-11-04T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-04T10:02:00Z");

        VehicleDetection d1 = createDetection(1L, cam1, t1, identity);
        VehicleDetection d2 = createDetection(2L, cam2, t2, identity);
        IdentityAssociation assoc = createAssoc(d1, d2, identity, "MATCH", "SYSTEM_DECIDED");

        when(identityRepository.findById(gid)).thenReturn(Optional.of(identity));
        when(detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(gid)).thenReturn(List.of(d1, d2));
        when(associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(gid)).thenReturn(List.of(assoc));

        // Mock camera_edges query returning a verified road edge
        when(jdbcTemplate.query(
                anyString(),
                any(RowMapper.class),
                eq("CAM-01"),
                eq("CAM-02")
        )).thenAnswer(invocation -> {
            RowMapper<?> mapper = invocation.getArgument(1);
            java.sql.ResultSet rs = Mockito.mock(java.sql.ResultSet.class);
            when(rs.getDouble("road_distance_meters")).thenReturn(1200.0);
            when(rs.getObject("min_travel_time_sec")).thenReturn(60.0);
            when(rs.getDouble("min_travel_time_sec")).thenReturn(60.0);
            when(rs.getObject("max_travel_time_sec")).thenReturn(300.0);
            when(rs.getDouble("max_travel_time_sec")).thenReturn(300.0);
            when(rs.getString("road_name")).thenReturn("FC Road Corridor");
            when(rs.getBoolean("is_verified")).thenReturn(true);
            return List.of(mapper.mapRow(rs, 1));
        });

        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(gid);

        assertEquals(1, trajectory.transitions().size());
        TrajectoryTransitionDto transition = trajectory.transitions().get(0);
        assertEquals("FEASIBLE", transition.status());
        assertEquals("VERIFIED_ROAD_EDGE", transition.connectivity());
        assertTrue(transition.isVerifiedTopology());
        assertEquals("VERIFIED_ROAD_NETWORK", transition.distanceMethod());
        assertEquals(1.2, transition.distanceKm());

        TrajectorySegmentDto segment = trajectory.segments().get(0);
        assertEquals("VERIFIED_ROAD_CONNECTED_PATH", segment.segmentType());
        assertTrue(segment.isFullyVerifiedRoadRoute());
    }
}

