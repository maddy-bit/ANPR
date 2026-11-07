package com.cityai.backend.service;

import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.TrajectoryObservationDto;
import com.cityai.backend.dto.TrajectoryObservationDto.ObservationProvenanceDto;
import com.cityai.backend.dto.TrajectorySegmentDto;
import com.cityai.backend.dto.TrajectoryTransitionDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.GlobalIdentity;
import com.cityai.backend.model.IdentityAssociation;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.GlobalIdentityRepository;
import com.cityai.backend.repository.IdentityAssociationRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.trajectory.GeoUtils;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Service for reconstructing deterministic, geographically grounded vehicle trajectories
 * from confirmed multi-camera detections.
 *
 * Implements strict membership gating (Rules 1-12 & Semantic Correction):
 * - Separates physical feasibility (FEASIBLE / IMPOSSIBLE / FEASIBILITY_UNKNOWN) from
 *   verified road connectivity (VERIFIED_ROAD_EDGE, UNVERIFIED_GEODESIC, SAME_CAMERA, UNKNOWN).
 * - Same-camera transitions are explicitly labeled SAME_CAMERA and are NOT labeled as verified road topology.
 * - Unverified geodesic transitions are explicitly noted as not proving an actual road route.
 * - Strict seed detection gating ensures unrelated detections with null association records are excluded.
 * - Segments explicitly indicate whether they are VERIFIED_ROAD_CONNECTED_PATH or PLAUSIBLE_CHRONOLOGICAL_SEQUENCE.
 */
@Service
public class GlobalTrajectoryService {

    private static final Logger log = LoggerFactory.getLogger(GlobalTrajectoryService.class);
    private static final double MAX_URBAN_SPEED_KMH = 100.0;
    private static final double MIN_TEMPORAL_WINDOW_SEC = 0.1;
    private static final double MIN_DISTANCE_KM_FOR_INSTANT_SIGHTING = 0.05; // 50 meters

    private final GlobalIdentityRepository identityRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final IdentityAssociationRepository associationRepository;
    private final JdbcTemplate jdbcTemplate;

    @Autowired
    public GlobalTrajectoryService(
            GlobalIdentityRepository identityRepository,
            VehicleDetectionRepository detectionRepository,
            IdentityAssociationRepository associationRepository,
            @Autowired(required = false) JdbcTemplate jdbcTemplate) {
        this.identityRepository = identityRepository;
        this.detectionRepository = detectionRepository;
        this.associationRepository = associationRepository;
        this.jdbcTemplate = jdbcTemplate;
    }

    @Transactional(readOnly = true)
    public GlobalTrajectoryDto reconstructTrajectory(UUID globalIdentityId) {
        GlobalIdentity identity = identityRepository.findById(Objects.requireNonNull(globalIdentityId, "globalIdentityId must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Global identity not found with id: " + globalIdentityId));

        // 1. Fetch all raw detections associated with this identity
        List<VehicleDetection> rawDetections = detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(globalIdentityId);

        // 2. Fetch all associations involving this global identity
        List<IdentityAssociation> associations = associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(globalIdentityId);

        // Also index associations by detection ID to determine confirmed vs rejected/pending status
        Map<Long, List<IdentityAssociation>> assocByDetId = new HashMap<>();
        for (IdentityAssociation assoc : associations) {
            if (assoc.getSourceDetection() != null) {
                assocByDetId.computeIfAbsent(assoc.getSourceDetection().getId(), k -> new ArrayList<>()).add(assoc);
            }
            if (assoc.getCandidateDetection() != null) {
                assocByDetId.computeIfAbsent(assoc.getCandidateDetection().getId(), k -> new ArrayList<>()).add(assoc);
            }
        }

        // 3. Filter detections to ONLY those with valid, confirmed membership
        boolean identityHasAssociations = !associations.isEmpty();
        List<VehicleDetection> confirmedDetections = new ArrayList<>();
        int excludedCount = 0;

        for (VehicleDetection det : rawDetections) {
            if (isConfirmedMember(det, identity, assocByDetId.get(det.getId()), identityHasAssociations, rawDetections.size())) {
                confirmedDetections.add(det);
            } else {
                excludedCount++;
                log.debug("Excluding detection {} from trajectory for identity {}: membership not confirmed",
                        det.getId(), globalIdentityId);
            }
        }

        // 4. Sort observations chronologically and deterministically (handle null & identical timestamps)
        confirmedDetections.sort(new ObservationComparator());

        // 5. Convert confirmed detections into TrajectoryObservationDto
        List<TrajectoryObservationDto> observations = new ArrayList<>();
        for (int i = 0; i < confirmedDetections.size(); i++) {
            VehicleDetection det = confirmedDetections.get(i);
            ObservationProvenanceDto prov = buildProvenance(det, assocByDetId.get(det.getId()), i == 0);
            observations.add(toObservationDto(det, identity.getId(), prov));
        }

        // 6. Evaluate consecutive transitions
        List<TrajectoryTransitionDto> transitions = new ArrayList<>();
        boolean hasImpossible = false;
        boolean hasUnknown = false;
        double totalFeasibleDistanceKm = 0.0;

        for (int i = 0; i < observations.size() - 1; i++) {
            TrajectoryObservationDto o1 = observations.get(i);
            TrajectoryObservationDto o2 = observations.get(i + 1);
            TrajectoryTransitionDto transition = evaluateTransition(o1, o2);
            transitions.add(transition);

            if ("IMPOSSIBLE".equals(transition.status())) {
                hasImpossible = true;
            } else if ("FEASIBILITY_UNKNOWN".equals(transition.status())) {
                hasUnknown = true;
            } else if ("FEASIBLE".equals(transition.status()) && transition.distanceKm() != null) {
                totalFeasibleDistanceKm += transition.distanceKm();
            }
        }

        // 7. Partition into continuous segments based on transition feasibility
        List<TrajectorySegmentDto> segments = buildSegments(observations, transitions);

        // 8. Duration metrics
        Double totalDurationSeconds = null;
        Instant firstSeen = null;
        Instant lastSeen = null;
        if (!observations.isEmpty()) {
            for (TrajectoryObservationDto obs : observations) {
                if (obs.timestamp() != null) {
                    if (firstSeen == null || obs.timestamp().isBefore(firstSeen)) {
                        firstSeen = obs.timestamp();
                    }
                    if (lastSeen == null || obs.timestamp().isAfter(lastSeen)) {
                        lastSeen = obs.timestamp();
                    }
                }
            }
            if (firstSeen != null && lastSeen != null) {
                totalDurationSeconds = Math.max(0.0, (double) Duration.between(firstSeen, lastSeen).toMillis() / 1000.0);
            }
        }

        return new GlobalTrajectoryDto(
                identity.getId(),
                identity.getLabel(),
                identity.getPrimaryPlate(),
                identity.getVehicleClass(),
                identity.getReviewStatus(),
                rawDetections.size(),
                observations.size(),
                excludedCount,
                segments.size(),
                hasImpossible,
                hasUnknown,
                Math.round(totalFeasibleDistanceKm * 1000.0) / 1000.0,
                totalDurationSeconds,
                firstSeen,
                lastSeen,
                observations,
                transitions,
                segments
        );
    }

    /**
     * Rules 1, 2, 12 & Semantic Correction 4:
     * A detection has confirmed membership if and only if:
     * - If the identity has established associations:
     *     The detection MUST be backed by at least one confirmed association (decision=MATCH,
     *     reviewStatus IN (SYSTEM_DECIDED, CONFIRMED_BY_USER)) and not invalidated by an active rejection override.
     *     An unassociated detection with no association record is strictly EXCLUDED.
     * - If the identity has NO associations at all:
     *     Only the legitimate original single seed detection matching the identity's firstSeenTimestamp can be admitted.
     *     If multiple unassociated detections exist with no associations, none can be verified.
     */
    private boolean isConfirmedMember(
            VehicleDetection det,
            GlobalIdentity identity,
            List<IdentityAssociation> assocsForDet,
            boolean identityHasAssociations,
            int totalRawDetectionsForIdentity) {

        if (identityHasAssociations) {
            if (assocsForDet == null || assocsForDet.isEmpty()) {
                // Strict check: unassociated unrelated detection in an established identity is EXCLUDED!
                return false;
            }

            boolean hasConfirmedAssoc = false;
            boolean hasPendingAssoc = false;
            boolean hasRejectedAssoc = false;

            for (IdentityAssociation a : assocsForDet) {
                String status = a.getReviewStatus();
                String decision = a.getDecision();

                if ("REJECTED_BY_USER".equalsIgnoreCase(status) || "NO_MATCH".equalsIgnoreCase(decision)) {
                    hasRejectedAssoc = true;
                } else if ("PENDING_REVIEW".equalsIgnoreCase(status) || "UNCERTAIN".equalsIgnoreCase(decision) || "FLAGGED_CONFLICT".equalsIgnoreCase(status)) {
                    hasPendingAssoc = true;
                } else if ("MATCH".equalsIgnoreCase(decision) && ("SYSTEM_DECIDED".equalsIgnoreCase(status) || "CONFIRMED_BY_USER".equalsIgnoreCase(status))) {
                    hasConfirmedAssoc = true;
                }
            }

            if (hasRejectedAssoc && !hasConfirmedAssoc) {
                return false;
            }
            if (hasPendingAssoc && !hasConfirmedAssoc) {
                return false;
            }
            return hasConfirmedAssoc;
        }

        // Identity has NO associations at all: only the single legitimate seed detection is accepted
        if (totalRawDetectionsForIdentity == 1) {
            if (det.getTimestamp() != null && identity.getFirstSeenTimestamp() != null) {
                return det.getTimestamp().equals(identity.getFirstSeenTimestamp());
            }
            return true;
        }

        // Multiple unassociated detections claiming the identity with zero associations are all unverified
        return false;
    }

    private ObservationProvenanceDto buildProvenance(VehicleDetection det, List<IdentityAssociation> assocs, boolean isFirst) {
        if (assocs != null && !assocs.isEmpty()) {
            for (IdentityAssociation a : assocs) {
                if ("MATCH".equalsIgnoreCase(a.getDecision())) {
                    return new ObservationProvenanceDto(
                            a.getId(),
                            a.getDecision(),
                            a.getReviewStatus(),
                            a.getReidScore(),
                            a.getPlateScore(),
                            isFirst
                    );
                }
            }
            IdentityAssociation first = assocs.get(0);
            return new ObservationProvenanceDto(
                    first.getId(),
                    first.getDecision(),
                    first.getReviewStatus(),
                    first.getReidScore(),
                    first.getPlateScore(),
                    isFirst
            );
        }
        return new ObservationProvenanceDto(null, "SEED", "SYSTEM_DECIDED", null, null, isFirst);
    }

    private TrajectoryObservationDto toObservationDto(VehicleDetection d, UUID gid, ObservationProvenanceDto prov) {
        Camera cam = d.getCamera();
        String camId = cam != null ? cam.getId() : "CAM-UNKNOWN";
        String camName = (cam != null && cam.getName() != null) ? cam.getName() : camId;
        Double lat = d.getLatitude();
        Double lon = d.getLongitude();
        if ((lat == null || lon == null) && cam != null) {
            lat = cam.getLatitude();
            lon = cam.getLongitude();
        }

        boolean hasCoords = !isInvalidCoordinate(lat, lon);
        String plate = d.getPlateTextNormalized() != null ? d.getPlateTextNormalized() : d.getPlateTextRaw();

        return new TrajectoryObservationDto(
                d.getId(),
                gid,
                camId,
                camName,
                d.getTimestamp(),
                hasCoords ? lat : null,
                hasCoords ? lon : null,
                hasCoords,
                d.getDirection(),
                d.getSpeedKmh(),
                d.getVehicleClass(),
                d.getDetectionConfidence(),
                plate,
                d.getPlateConfidence(),
                d.getReidConfidence(),
                d.getImagePath(),
                d.getTrackId(),
                d.getFrameNumber(),
                prov
        );
    }

    /**
     * Evaluates spatial-temporal feasibility between two consecutive observations.
     * Enforces:
     * - Physical feasibility (FEASIBLE / IMPOSSIBLE / FEASIBILITY_UNKNOWN) separated from
     *   verified road connectivity (VERIFIED_ROAD_EDGE, UNVERIFIED_GEODESIC, SAME_CAMERA, UNKNOWN).
     * - Same-camera transitions are explicitly labeled SAME_CAMERA and isVerifiedTopology is false.
     * - Unverified geodesic transitions explicitly note that they do not prove an actual road route.
     * - Speed limits and simultaneous sighting rejection (Rule 10).
     */
    private TrajectoryTransitionDto evaluateTransition(TrajectoryObservationDto o1, TrajectoryObservationDto o2) {
        Long id1 = o1.detectionId();
        Long id2 = o2.detectionId();
        String cam1 = o1.cameraId();
        String cam2 = o2.cameraId();
        Instant t1 = o1.timestamp();
        Instant t2 = o2.timestamp();

        // 1. Missing Timestamps
        if (t1 == null || t2 == null) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    null, null, "UNKNOWN_TIMESTAMPS", "UNKNOWN", false, null,
                    "FEASIBILITY_UNKNOWN",
                    "Missing observation timestamp; temporal feasibility cannot be evaluated."
            );
        }

        double dtSec = (double) Duration.between(t1, t2).toMillis() / 1000.0;
        if (dtSec < 0.0) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, null, "REVERSE_CHRONOLOGY", "UNKNOWN", false, null,
                    "IMPOSSIBLE",
                    String.format("Reverse chronological transition (dt=%.1fs); physical movement must be forward in time.", dtSec)
            );
        }

        // 2. Same Camera Observation (Not verified road topology; explicit SAME_CAMERA)
        if (Objects.equals(cam1, cam2)) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, 0.0, "SAME_CAMERA", "SAME_CAMERA", false, 0.0,
                    "FEASIBLE",
                    String.format("Consecutive observation at the same camera %s (dt=%.1fs); stationary or repeated sighting, not a road transition.", cam1, dtSec)
            );
        }

        // 3. Different Cameras: Check Calibrated Road Network in camera_edges
        RoadEdgeLookup roadEdge = lookupCameraEdge(cam1, cam2);
        if (roadEdge != null && roadEdge.isVerified()) {
            double distKm = roadEdge.roadDistanceMeters() / 1000.0;
            Double minSec = roadEdge.minTravelTimeSec();
            Double apparentSpeed = (dtSec > 0.0) ? (distKm / (dtSec / 3600.0)) : 9999.0;

            if (minSec != null && dtSec < minSec) {
                return new TrajectoryTransitionDto(
                        id1, id2, cam1, cam2, t1, t2,
                        dtSec, distKm, "VERIFIED_ROAD_NETWORK", "VERIFIED_ROAD_EDGE", true, apparentSpeed,
                        "IMPOSSIBLE",
                        String.format("Travel time (%.1fs) is less than calibrated minimum road transit time (%.1fs) on verified road edge '%s'",
                                dtSec, minSec, roadEdge.roadName())
                );
            }

            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, distKm, "VERIFIED_ROAD_NETWORK", "VERIFIED_ROAD_EDGE", true, apparentSpeed,
                    "FEASIBLE",
                    String.format("Feasible transit via verified road edge '%s' (%.2f km in %.1fs, speed=%.1f km/h)",
                            roadEdge.roadName(), distKm, dtSec, apparentSpeed)
            );
        }

        // 4. Missing or Unconfigured Coordinates
        if (!o1.hasCoordinates() || !o2.hasCoordinates()) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, null, "UNKNOWN_COORDINATES", "UNKNOWN", false, null,
                    "FEASIBILITY_UNKNOWN",
                    String.format("Missing camera coordinates (%s: %s, %s: %s); spatial distance cannot be evaluated.",
                            cam1, o1.hasCoordinates() ? "OK" : "MISSING",
                            cam2, o2.hasCoordinates() ? "OK" : "MISSING")
            );
        }

        // 5. Geodesic Distance Evaluation (Unverified Road Topology)
        double distKm = computeGeodesicDistanceKm(o1.latitude(), o1.longitude(), o2.latitude(), o2.longitude());
        String method = (roadEdge != null) ? "UNVERIFIED_ROAD_ESTIMATE" : "POSTGIS_GEODESIC_SPHERE";

        // Simultaneous sighting check: dt <= 0.1s at distant cameras
        if (dtSec <= MIN_TEMPORAL_WINDOW_SEC && distKm > MIN_DISTANCE_KM_FOR_INSTANT_SIGHTING) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, distKm, method, "UNVERIFIED_GEODESIC", false, 9999.0,
                    "IMPOSSIBLE",
                    String.format("Simultaneous sightings at geographically separated cameras (%.2f km in %.1fs); physically impossible for a single vehicle.",
                            distKm, dtSec)
            );
        }

        // Speed check: apparent straight-line speed > MAX_URBAN_SPEED_KMH
        double hours = dtSec / 3600.0;
        double apparentSpeed = (hours > 0.0) ? (distKm / hours) : 9999.0;

        if (apparentSpeed > MAX_URBAN_SPEED_KMH) {
            return new TrajectoryTransitionDto(
                    id1, id2, cam1, cam2, t1, t2,
                    dtSec, distKm, method, "UNVERIFIED_GEODESIC", false, apparentSpeed,
                    "IMPOSSIBLE",
                    String.format("Apparent straight-line speed (%.1f km/h) exceeds physical threshold (%.1f km/h) over %.2f km in %.1fs; unverified geodesic transition.",
                            apparentSpeed, MAX_URBAN_SPEED_KMH, distKm, dtSec)
            );
        }

        return new TrajectoryTransitionDto(
                id1, id2, cam1, cam2, t1, t2,
                dtSec, distKm, method, "UNVERIFIED_GEODESIC", false, apparentSpeed,
                "FEASIBLE",
                String.format("Physically feasible geodesic transition (%.2f km, dt=%.1fs, apparent speed=%.1f km/h); unverified geodesic path, does not prove actual travelled road route.",
                        distKm, dtSec, apparentSpeed)
        );
    }

    private List<TrajectorySegmentDto> buildSegments(
            List<TrajectoryObservationDto> observations,
            List<TrajectoryTransitionDto> transitions) {

        List<TrajectorySegmentDto> segments = new ArrayList<>();
        if (observations.isEmpty()) {
            return segments;
        }

        if (observations.size() == 1) {
            TrajectoryObservationDto single = observations.get(0);
            segments.add(new TrajectorySegmentDto(
                    1,
                    "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE",
                    false,
                    1,
                    single.detectionId(),
                    single.detectionId(),
                    single.timestamp(),
                    single.timestamp(),
                    0.0,
                    0.0,
                    List.of(single),
                    null
            ));
            return segments;
        }

        List<TrajectoryObservationDto> currentSegmentObs = new ArrayList<>();
        List<TrajectoryTransitionDto> currentSegmentTrans = new ArrayList<>();
        currentSegmentObs.add(observations.get(0));
        double currentDistKm = 0.0;
        String breakReasonForNext = null;
        int segmentIndex = 1;

        for (int i = 0; i < transitions.size(); i++) {
            TrajectoryTransitionDto t = transitions.get(i);
            TrajectoryObservationDto nextObs = observations.get(i + 1);

            if ("FEASIBLE".equals(t.status())) {
                currentSegmentObs.add(nextObs);
                currentSegmentTrans.add(t);
                if (t.distanceKm() != null) {
                    currentDistKm += t.distanceKm();
                }
            } else {
                // Break segment
                segments.add(createSegment(segmentIndex++, currentSegmentObs, currentSegmentTrans, currentDistKm, breakReasonForNext));

                // Start new segment
                currentSegmentObs = new ArrayList<>();
                currentSegmentTrans = new ArrayList<>();
                currentSegmentObs.add(nextObs);
                currentDistKm = 0.0;
                breakReasonForNext = String.format("Segment break at detection %d -> %d: [%s] %s",
                        t.fromDetectionId(), t.toDetectionId(), t.status(), t.reason());
            }
        }

        if (!currentSegmentObs.isEmpty()) {
            segments.add(createSegment(segmentIndex, currentSegmentObs, currentSegmentTrans, currentDistKm, breakReasonForNext));
        }

        return segments;
    }

    private TrajectorySegmentDto createSegment(
            int index,
            List<TrajectoryObservationDto> obsList,
            List<TrajectoryTransitionDto> transList,
            double distKm,
            String breakReason) {

        TrajectoryObservationDto start = obsList.get(0);
        TrajectoryObservationDto end = obsList.get(obsList.size() - 1);
        Double duration = null;
        if (start.timestamp() != null && end.timestamp() != null) {
            duration = Math.max(0.0, (double) Duration.between(start.timestamp(), end.timestamp()).toMillis() / 1000.0);
        }

        boolean allVerifiedRoad = !transList.isEmpty();
        for (TrajectoryTransitionDto tr : transList) {
            if (!"VERIFIED_ROAD_EDGE".equals(tr.connectivity())) {
                allVerifiedRoad = false;
                break;
            }
        }
        String segmentType = allVerifiedRoad ? "VERIFIED_ROAD_CONNECTED_PATH" : "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE";

        return new TrajectorySegmentDto(
                index,
                segmentType,
                allVerifiedRoad,
                obsList.size(),
                start.detectionId(),
                end.detectionId(),
                start.timestamp(),
                end.timestamp(),
                duration,
                Math.round(distKm * 1000.0) / 1000.0,
                new ArrayList<>(obsList),
                breakReason
        );
    }

    private double computeGeodesicDistanceKm(double lat1, double lon1, double lat2, double lon2) {
        if (jdbcTemplate != null) {
            try {
                String postgisSql = """
                        SELECT ST_Distance(
                            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography,
                            ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography
                        ) / 1000.0 AS dist_km
                        """;
                Double dist = jdbcTemplate.queryForObject(postgisSql, Double.class, lon1, lat1, lon2, lat2);
                if (dist != null) {
                    return dist;
                }
            } catch (Exception e) {
                log.debug("PostGIS ST_Distance query failed, falling back to Haversine: {}", e.getMessage());
            }
        }
        return GeoUtils.distanceKm(lat1, lon1, lat2, lon2);
    }

    private RoadEdgeLookup lookupCameraEdge(String fromCam, String toCam) {
        if (jdbcTemplate == null) {
            return null;
        }
        try {
            String sql = """
                    SELECT road_distance_meters, min_travel_time_sec, max_travel_time_sec, road_name, is_verified
                    FROM camera_edges
                    WHERE from_camera_id = ? AND to_camera_id = ?
                    """;
            List<RoadEdgeLookup> results = jdbcTemplate.query(sql, (rs, rowNum) -> new RoadEdgeLookup(
                    rs.getDouble("road_distance_meters"),
                    rs.getObject("min_travel_time_sec") != null ? rs.getDouble("min_travel_time_sec") : null,
                    rs.getObject("max_travel_time_sec") != null ? rs.getDouble("max_travel_time_sec") : null,
                    rs.getString("road_name"),
                    rs.getBoolean("is_verified")
            ), fromCam, toCam);
            return results.isEmpty() ? null : results.get(0);
        } catch (Exception e) {
            log.debug("camera_edges lookup failed: {}", e.getMessage());
            return null;
        }
    }

    private boolean isInvalidCoordinate(Double lat, Double lon) {
        if (lat == null || lon == null) {
            return true;
        }
        return (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4) || lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0;
    }

    private static final class RoadEdgeLookup {
        private final double roadDistanceMeters;
        private final Double minTravelTimeSec;
        private final Double maxTravelTimeSec;
        private final String roadName;
        private final boolean isVerified;

        public RoadEdgeLookup(
                double roadDistanceMeters,
                Double minTravelTimeSec,
                Double maxTravelTimeSec,
                String roadName,
                boolean isVerified) {
            this.roadDistanceMeters = roadDistanceMeters;
            this.minTravelTimeSec = minTravelTimeSec;
            this.maxTravelTimeSec = maxTravelTimeSec;
            this.roadName = roadName;
            this.isVerified = isVerified;
        }

        public double roadDistanceMeters() {
            return roadDistanceMeters;
        }

        public Double minTravelTimeSec() {
            return minTravelTimeSec;
        }

        public Double maxTravelTimeSec() {
            return maxTravelTimeSec;
        }

        public String roadName() {
            return roadName;
        }

        public boolean isVerified() {
            return isVerified;
        }
    }

    /**
     * Deterministic observation comparator:
     * 1. Observations with non-null timestamps come before null timestamps.
     * 2. Non-null timestamps are sorted ascending.
     * 3. Tied timestamps are sorted deterministically by detection ID ascending.
     * 4. Null timestamps are sorted deterministically by detection ID ascending.
     */
    private static class ObservationComparator implements Comparator<VehicleDetection> {
        @Override
        public int compare(VehicleDetection d1, VehicleDetection d2) {
            Instant t1 = d1.getTimestamp();
            Instant t2 = d2.getTimestamp();

            if (t1 != null && t2 != null) {
                int cmp = t1.compareTo(t2);
                if (cmp != 0) {
                    return cmp;
                }
                return Long.compare(d1.getId() != null ? d1.getId() : 0L, d2.getId() != null ? d2.getId() : 0L);
            }

            if (t1 != null) {
                return -1;
            }
            if (t2 != null) {
                return 1;
            }

            return Long.compare(d1.getId() != null ? d1.getId() : 0L, d2.getId() != null ? d2.getId() : 0L);
        }
    }
}
