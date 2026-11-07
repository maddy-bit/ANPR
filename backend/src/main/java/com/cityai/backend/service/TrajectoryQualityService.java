package com.cityai.backend.service;

import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.TrajectoryObservationDto;
import com.cityai.backend.dto.TrajectoryQualityDto;
import com.cityai.backend.dto.TrajectoryQualityDto.*;
import com.cityai.backend.dto.TrajectoryTransitionDto;
import com.cityai.backend.model.GlobalIdentity;
import com.cityai.backend.model.IdentityAssociation;
import com.cityai.backend.repository.GlobalIdentityRepository;
import com.cityai.backend.repository.IdentityAssociationRepository;
import com.cityai.backend.repository.VehicleDetectionRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Trajectory Evidence Reliability & Quality Assessment Service.
 *
 * Implements Phase A5 Batch 3.2 rules:
 * - Decouples evidence quality from uncalibrated statistical percentages.
 * - Evaluates identity membership, detection confidence, OCR/plate consistency,
 *   Re-ID similarity, spatial-temporal feasibility, and completeness.
 * - Preserves all impossible transitions and unverified geodesic qualifications.
 * - Enforces that single-camera sightings are never misrepresented as cross-camera confirmed.
 * - Classifies trajectories into: HIGH_CONFIDENCE, MEDIUM_CONFIDENCE, LOW_CONFIDENCE, INSUFFICIENT_EVIDENCE.
 */
@Service
public class TrajectoryQualityService {

    private final GlobalTrajectoryService trajectoryService;
    private final GlobalIdentityRepository identityRepository;
    private final IdentityAssociationRepository associationRepository;

    @Autowired
    public TrajectoryQualityService(
            GlobalTrajectoryService trajectoryService,
            GlobalIdentityRepository identityRepository,
            IdentityAssociationRepository associationRepository,
            @Autowired(required = false) VehicleDetectionRepository detectionRepository) {
        this.trajectoryService = trajectoryService;
        this.identityRepository = identityRepository;
        this.associationRepository = associationRepository;
    }

    public TrajectoryQualityService(
            GlobalTrajectoryService trajectoryService,
            GlobalIdentityRepository identityRepository,
            IdentityAssociationRepository associationRepository) {
        this(trajectoryService, identityRepository, associationRepository, null);
    }

    @Transactional(readOnly = true)
    public TrajectoryQualityDto assessTrajectoryQuality(UUID globalIdentityId) {
        if (globalIdentityId == null) {
            throw new IllegalArgumentException("Global identity ID cannot be null");
        }

        GlobalIdentity identity = identityRepository.findById(globalIdentityId)
                .orElseThrow(() -> new NoSuchElementException("Global identity not found with id: " + globalIdentityId));

        // 1. Reconstruct authoritative trajectory using existing service (zero calculation duplication)
        GlobalTrajectoryDto trajectory = trajectoryService.reconstructTrajectory(globalIdentityId);

        // 2. Fetch all association records linked to this identity to inspect audits, conflicts, and rejections
        List<IdentityAssociation> associations = associationRepository
                .findByGlobalIdentity_IdOrderByCreatedAtDesc(globalIdentityId);

        // 3. Evaluate Individual Dimensions
        List<String> supportingEvidence = new ArrayList<>();
        List<String> missingEvidence = new ArrayList<>();
        List<String> warningsAndContradictions = new ArrayList<>();

        IdentityQualityDimensionDto identityDim = evaluateIdentityMembership(trajectory, associations, supportingEvidence, warningsAndContradictions);
        DetectionQualityDimensionDto detectionDim = evaluateDetectionConfidence(trajectory, supportingEvidence, warningsAndContradictions);
        PlateQualityDimensionDto plateDim = evaluatePlateConsistency(trajectory, associations, supportingEvidence, warningsAndContradictions);
        ReidQualityDimensionDto reidDim = evaluateReidSimilarity(associations, trajectory, supportingEvidence, missingEvidence);
        SpatialTemporalQualityDimensionDto spatialDim = evaluateSpatialTemporal(trajectory, supportingEvidence, missingEvidence, warningsAndContradictions);
        CompletenessQualityDimensionDto completenessDim = evaluateCompleteness(trajectory, reidDim.isAvailable(), missingEvidence);

        // 4. Compute Counts
        int totalObs = trajectory.totalObservations();
        int confirmedObs = trajectory.confirmedObservations();
        int excludedObs = trajectory.excludedObservations();

        int uncertainObs = 0;
        for (IdentityAssociation a : associations) {
            if ("PENDING_REVIEW".equalsIgnoreCase(a.getReviewStatus()) || "UNCERTAIN".equalsIgnoreCase(a.getDecision())) {
                uncertainObs++;
            }
        }

        int distinctCams = spatialDim.distinctCameras();
        int totalTrans = trajectory.transitions().size();
        int feasibleTrans = 0;
        int impossibleTrans = 0;
        int unknownTrans = 0;
        int verifiedRoadTrans = spatialDim.verifiedRoadEdges();
        int unverifiedGeodesicTrans = spatialDim.unverifiedGeodesics();
        int sameCameraTrans = spatialDim.sameCameraTransitions();

        for (TrajectoryTransitionDto t : trajectory.transitions()) {
            if ("FEASIBLE".equals(t.status())) {
                feasibleTrans++;
            } else if ("IMPOSSIBLE".equals(t.status())) {
                impossibleTrans++;
            } else {
                unknownTrans++;
            }
        }

        TrajectoryQualityCountsDto counts = new TrajectoryQualityCountsDto(
                totalObs,
                confirmedObs,
                uncertainObs,
                excludedObs,
                distinctCams,
                totalTrans,
                feasibleTrans,
                impossibleTrans,
                unknownTrans,
                verifiedRoadTrans,
                unverifiedGeodesicTrans,
                sameCameraTrans
        );

        TrajectoryDimensionsDto dimensions = new TrajectoryDimensionsDto(
                identityDim,
                detectionDim,
                plateDim,
                reidDim,
                spatialDim,
                completenessDim
        );

        boolean isCrossCameraConfirmed = distinctCams >= 2 && confirmedObs >= 2;
        boolean hasImpossible = impossibleTrans > 0;
        boolean hasContradictions = "CONTRADICTORY".equals(plateDim.status())
                || "CONFLICTED".equals(identityDim.status())
                || hasImpossible;

        // 5. Determine Overall Quality Category
        String overallQuality;
        String summary;

        if (confirmedObs == 0) {
            overallQuality = "INSUFFICIENT_EVIDENCE";
            summary = "Empty trajectory: zero confirmed vehicle observations exist for this identity.";
        } else if (confirmedObs == 1 || distinctCams <= 1) {
            overallQuality = "INSUFFICIENT_EVIDENCE";
            if (distinctCams == 1 && confirmedObs > 1) {
                summary = String.format("Single-camera sighting (%d observations at camera %s); cross-camera corroboration is absent.",
                        confirmedObs, trajectory.observations().get(0).cameraId());
            } else {
                summary = "Single vehicle observation; trajectory continuity cannot be evaluated across space and time.";
            }
        } else if (hasImpossible) {
            overallQuality = "LOW_CONFIDENCE";
            summary = String.format("Trajectory contains %d impossible transition(s) violating physical travel speed constraints.", impossibleTrans);
        } else if ("CONTRADICTORY".equals(plateDim.status())) {
            overallQuality = "LOW_CONFIDENCE";
            summary = "Trajectory contains contradictory license plate readings across confirmed observations.";
        } else if ("CONFLICTED".equals(identityDim.status())) {
            overallQuality = "LOW_CONFIDENCE";
            summary = "Trajectory has conflicted or user-rejected identity association history.";
        } else if ("LOW".equals(detectionDim.status())) {
            overallQuality = "LOW_CONFIDENCE";
            summary = "Trajectory relies on low-confidence vehicle detections below acceptable threshold.";
        } else if (unknownTrans > 0 || !"COMPLETE".equals(completenessDim.status())) {
            overallQuality = "MEDIUM_CONFIDENCE";
            summary = "Trajectory has partial evidence or missing spatial-temporal telemetry preventing complete verification.";
        } else if (verifiedRoadTrans > 0 && unverifiedGeodesicTrans == 0 && "HIGH".equals(detectionDim.status()) && "CONSISTENT".equals(plateDim.status())) {
            overallQuality = "HIGH_CONFIDENCE";
            summary = String.format("High-confidence multi-camera trajectory across %d cameras verified against calibrated road network corridors.", distinctCams);
        } else {
            // Feasible but geodesic / unverified corridors
            overallQuality = "MEDIUM_CONFIDENCE";
            summary = String.format("Physically plausible multi-camera trajectory across %d cameras; camera corridors rely on unverified geodesic bounds.", distinctCams);
        }

        return new TrajectoryQualityDto(
                globalIdentityId,
                identity.getLabel(),
                overallQuality,
                summary,
                isCrossCameraConfirmed,
                hasImpossible,
                hasContradictions,
                counts,
                dimensions,
                supportingEvidence,
                missingEvidence,
                warningsAndContradictions
        );
    }

    private IdentityQualityDimensionDto evaluateIdentityMembership(
            GlobalTrajectoryDto trajectory,
            List<IdentityAssociation> associations,
            List<String> supporting,
            List<String> warnings) {

        int confirmed = trajectory.confirmedObservations();
        int excluded = trajectory.excludedObservations();

        Set<String> statuses = new HashSet<>();
        boolean hasRejected = false;
        boolean hasConflict = false;

        for (IdentityAssociation a : associations) {
            if (a.getReviewStatus() != null) {
                statuses.add(a.getReviewStatus());
            }
            if ("REJECTED_BY_USER".equalsIgnoreCase(a.getReviewStatus()) || "NO_MATCH".equalsIgnoreCase(a.getDecision())) {
                hasRejected = true;
            }
            if ("FLAGGED_CONFLICT".equalsIgnoreCase(a.getReviewStatus())) {
                hasConflict = true;
            }
        }

        String status;
        String summary;

        if (confirmed == 0) {
            status = "INSUFFICIENT_DATA";
            summary = "No confirmed observations associated with identity.";
        } else if (hasConflict || hasRejected) {
            status = "CONFLICTED";
            summary = String.format("Identity has %d confirmed observations, but contains user-rejected or conflicted associations.", confirmed);
            warnings.add("Active association conflict or user rejection recorded in identity history.");
        } else if (excluded > 0) {
            status = "HAS_EXCLUSIONS";
            summary = String.format("Identity has %d confirmed observations and %d excluded/unverified detection(s).", confirmed, excluded);
            warnings.add(String.format("%d unconfirmed detection(s) excluded from trajectory reconstruction.", excluded));
        } else {
            status = "CONFIRMED";
            summary = String.format("All %d observations backed by confirmed match decisions.", confirmed);
            supporting.add(String.format("Authoritative identity membership confirmed across %d observation(s).", confirmed));
        }

        return new IdentityQualityDimensionDto(
                status,
                confirmed,
                excluded,
                new ArrayList<>(statuses),
                summary
        );
    }

    private DetectionQualityDimensionDto evaluateDetectionConfidence(
            GlobalTrajectoryDto trajectory,
            List<String> supporting,
            List<String> warnings) {

        List<Double> confs = new ArrayList<>();
        int lowCount = 0;

        for (TrajectoryObservationDto obs : trajectory.observations()) {
            if (obs.detectionConfidence() != null) {
                confs.add(obs.detectionConfidence());
                if (obs.detectionConfidence() < 0.70) {
                    lowCount++;
                }
            }
        }

        if (confs.isEmpty()) {
            return new DetectionQualityDimensionDto("INSUFFICIENT_DATA", null, null, null, 0, "No detection confidence scores available.");
        }

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        double sum = 0.0;
        for (Double c : confs) {
            double val = c != null ? c : 0.0;
            if (val < min) min = val;
            if (val > max) max = val;
            sum += val;
        }
        double avg = sum / confs.size();

        String status;
        String summary;

        if (avg >= 0.85 && lowCount == 0) {
            status = "HIGH";
            summary = String.format("High detection confidence (avg=%.2f, min=%.2f, max=%.2f).", avg, min, max);
            supporting.add(String.format("High vehicle detection confidence (average %.1f%% across %d detections).", avg * 100.0, confs.size()));
        } else if (avg >= 0.70 && lowCount == 0) {
            status = "ACCEPTABLE";
            summary = String.format("Acceptable detection confidence (avg=%.2f, min=%.2f, max=%.2f).", avg, min, max);
            supporting.add(String.format("Acceptable vehicle detection confidence (average %.1f%%).", avg * 100.0));
        } else {
            status = "LOW";
            summary = String.format("Low detection confidence (avg=%.2f, min=%.2f, %d detection(s) < 0.70).", avg, min, lowCount);
            warnings.add(String.format("Low detection confidence: %d detection(s) below 0.70 threshold (min=%.2f, avg=%.2f).", lowCount, min, avg));
        }

        return new DetectionQualityDimensionDto(
                status,
                Math.round(min * 1000.0) / 1000.0,
                Math.round(avg * 1000.0) / 1000.0,
                Math.round(max * 1000.0) / 1000.0,
                lowCount,
                summary
        );
    }

    private PlateQualityDimensionDto evaluatePlateConsistency(
            GlobalTrajectoryDto trajectory,
            List<IdentityAssociation> associations,
            List<String> supporting,
            List<String> warnings) {

        Set<String> plates = new HashSet<>();
        List<Double> confs = new ArrayList<>();
        int plateReadingsCount = 0;

        for (TrajectoryObservationDto obs : trajectory.observations()) {
            if (obs.plateText() != null && !obs.plateText().isBlank()) {
                plates.add(obs.plateText().trim().toUpperCase());
                plateReadingsCount++;
            }
            if (obs.plateConfidence() != null) {
                confs.add(obs.plateConfidence());
            }
        }

        Double minConf = null;
        Double avgConf = null;
        if (!confs.isEmpty()) {
            double minVal = Double.MAX_VALUE;
            double sumVal = 0.0;
            for (Double c : confs) {
                double val = c != null ? c : 0.0;
                if (val < minVal) minVal = val;
                sumVal += val;
            }
            minConf = minVal;
            avgConf = sumVal / confs.size();
        }

        if (minConf != null) {
            minConf = Math.round(minConf * 1000.0) / 1000.0;
        }
        if (avgConf != null) {
            avgConf = Math.round(avgConf * 1000.0) / 1000.0;
        }

        String status;
        String summary;

        if (plates.isEmpty()) {
            status = "NO_READINGS";
            summary = "No license plate readings available across observations.";
        } else if (plates.size() > 1) {
            status = "CONTRADICTORY";
            summary = String.format("Contradictory license plates detected across observations: %s", plates);
            warnings.add(String.format("Plate contradiction: Conflicting license plate texts detected %s.", plates));
        } else {
            String plate = plates.iterator().next();
            if (plateReadingsCount > 1) {
                status = "CONSISTENT";
                summary = String.format("Consistent license plate '%s' across all %d plate readings (avg confidence=%.2f).",
                        plate, plateReadingsCount, avgConf != null ? avgConf : 0.0);
                supporting.add(String.format("Consistent license plate '%s' observed across multiple sightings (avg OCR confidence %.1f%%).",
                        plate, (avgConf != null ? avgConf : 0.0) * 100.0));
            } else {
                status = "SINGLE_READING";
                summary = String.format("Single license plate reading '%s' (confidence=%.2f).", plate, avgConf != null ? avgConf : 0.0);
            }
        }

        return new PlateQualityDimensionDto(
                status,
                new ArrayList<>(plates),
                minConf,
                avgConf,
                summary
        );
    }

    private ReidQualityDimensionDto evaluateReidSimilarity(
            List<IdentityAssociation> associations,
            GlobalTrajectoryDto trajectory,
            List<String> supporting,
            List<String> missing) {

        List<Double> scores = new ArrayList<>();
        String modelName = null;

        for (IdentityAssociation a : associations) {
            if ("MATCH".equalsIgnoreCase(a.getDecision()) && a.getReidScore() != null) {
                scores.add(a.getReidScore());
                if (modelName == null && a.getReidModelName() != null) {
                    modelName = a.getReidModelName();
                }
            }
        }

        if (scores.isEmpty()) {
            missing.add("Vehicle Re-ID visual appearance similarity scores missing or uncomputed.");
            return new ReidQualityDimensionDto(
                    "MISSING_EVIDENCE",
                    false,
                    null,
                    null,
                    null,
                    null,
                    "No Re-ID visual appearance similarity scores available."
            );
        }

        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        double sum = 0.0;
        for (Double s : scores) {
            double val = s != null ? s : 0.0;
            if (val < min) min = val;
            if (val > max) max = val;
            sum += val;
        }
        double avg = sum / scores.size();

        String status;
        String summary;

        if (avg >= 0.85) {
            status = "HIGH_SIMILARITY";
            summary = String.format("High Re-ID visual appearance similarity (avg=%.3f, model=%s).", avg, modelName != null ? modelName : "unknown");
            supporting.add(String.format("High visual Re-ID appearance similarity (avg=%.3f using %s).", avg, modelName != null ? modelName : "Re-ID model"));
        } else if (avg >= 0.70) {
            status = "MODERATE_SIMILARITY";
            summary = String.format("Moderate Re-ID appearance similarity (avg=%.3f).", avg);
            supporting.add(String.format("Moderate visual Re-ID appearance similarity (avg=%.3f).", avg));
        } else {
            status = "LOW_SIMILARITY";
            summary = String.format("Low Re-ID appearance similarity (avg=%.3f).", avg);
        }

        return new ReidQualityDimensionDto(
                status,
                true,
                Math.round(min * 1000.0) / 1000.0,
                Math.round(avg * 1000.0) / 1000.0,
                Math.round(max * 1000.0) / 1000.0,
                modelName,
                summary
        );
    }

    private SpatialTemporalQualityDimensionDto evaluateSpatialTemporal(
            GlobalTrajectoryDto trajectory,
            List<String> supporting,
            List<String> missing,
            List<String> warnings) {

        Set<String> cameras = new HashSet<>();
        for (TrajectoryObservationDto o : trajectory.observations()) {
            if (o.cameraId() != null) {
                cameras.add(o.cameraId());
            }
        }

        int distinctCams = cameras.size();
        int verifiedRoadEdges = 0;
        int unverifiedGeodesics = 0;
        int sameCameraTransitions = 0;
        int impossible = 0;
        int unknown = 0;

        for (TrajectoryTransitionDto t : trajectory.transitions()) {
            if ("SAME_CAMERA".equals(t.connectivity())) {
                sameCameraTransitions++;
            } else if ("VERIFIED_ROAD_EDGE".equals(t.connectivity())) {
                verifiedRoadEdges++;
            } else if ("UNVERIFIED_GEODESIC".equals(t.connectivity())) {
                unverifiedGeodesics++;
            }

            if ("IMPOSSIBLE".equals(t.status())) {
                impossible++;
                warnings.add(String.format("Impossible transition from %s to %s: %s",
                        t.fromCameraId(), t.toCameraId(), t.reason()));
            } else if ("FEASIBILITY_UNKNOWN".equals(t.status())) {
                unknown++;
                warnings.add(String.format("Feasibility unknown from %s to %s: %s",
                        t.fromCameraId(), t.toCameraId(), t.reason()));
            }
        }

        String status;
        String summary;

        if (trajectory.confirmedObservations() <= 1 || distinctCams <= 1) {
            status = "SINGLE_POINT_OR_SAME_CAMERA";
            summary = String.format("Single point or same-camera observations only (%d camera(s)); no cross-camera transit.", distinctCams);
            if (distinctCams == 1 && trajectory.confirmedObservations() > 1) {
                warnings.add("Repeated observations originate from a single camera; cannot corroborate cross-camera travel.");
            }
        } else if (impossible > 0) {
            status = "CONTAINS_IMPOSSIBLE_TRANSITIONS";
            summary = String.format("%d impossible transition(s) detected violating physical travel thresholds.", impossible);
        } else if (unknown > 0) {
            status = "FEASIBILITY_UNKNOWN";
            summary = String.format("%d transition(s) with unknown spatial-temporal feasibility.", unknown);
        } else if (verifiedRoadEdges > 0 && unverifiedGeodesics == 0) {
            status = "VERIFIED_ROAD_NETWORK";
            summary = String.format("All %d multi-camera transitions verified against calibrated road network topology.", verifiedRoadEdges);
            supporting.add(String.format("All camera transitions verified along calibrated road network corridors across %d cameras.", distinctCams));
        } else {
            status = "PLAUSIBLE_GEODESIC";
            summary = String.format("Transitions are physically feasible under urban speed limits, but %d corridor(s) rely on unverified geodesic bounds.", unverifiedGeodesics);
            missing.add(String.format("Road network calibration missing for %d cross-camera corridor(s); straight-line geodesic used.", unverifiedGeodesics));
            supporting.add(String.format("Multi-camera transition feasible within urban speed thresholds across %d cameras.", distinctCams));
        }

        return new SpatialTemporalQualityDimensionDto(
                status,
                distinctCams,
                verifiedRoadEdges,
                unverifiedGeodesics,
                sameCameraTransitions,
                impossible,
                unknown,
                summary
        );
    }

    private CompletenessQualityDimensionDto evaluateCompleteness(
            GlobalTrajectoryDto trajectory,
            boolean hasReid,
            List<String> missing) {

        int missingTimestamps = 0;
        int missingCoords = 0;
        int missingPlates = 0;

        for (TrajectoryObservationDto o : trajectory.observations()) {
            if (o.timestamp() == null) {
                missingTimestamps++;
            }
            if (!o.hasCoordinates() || o.latitude() == null || o.longitude() == null) {
                missingCoords++;
            }
            if (o.plateText() == null || o.plateText().isBlank()) {
                missingPlates++;
            }
        }

        if (missingTimestamps > 0) {
            missing.add(String.format("Missing timestamps on %d observation(s).", missingTimestamps));
        }
        if (missingCoords > 0) {
            missing.add(String.format("Missing camera coordinates on %d observation(s).", missingCoords));
        }
        if (missingPlates > 0) {
            missing.add(String.format("Missing license plate readings on %d observation(s).", missingPlates));
        }

        int missingReid = hasReid ? 0 : trajectory.confirmedObservations();

        String status;
        String summary;

        if (missingTimestamps == 0 && missingCoords == 0 && hasReid && missingPlates == 0) {
            status = "COMPLETE";
            summary = "All required telemetry, appearance embeddings, and OCR evidence are present.";
        } else if (missingTimestamps == 0 && missingCoords == 0) {
            status = "PARTIAL";
            summary = "Spatial-temporal telemetry is complete, but some OCR or Re-ID evidence is missing.";
        } else {
            status = "INSUFFICIENT";
            summary = String.format("Missing critical telemetry (%d timestamp(s), %d coordinate(s)).", missingTimestamps, missingCoords);
        }

        return new CompletenessQualityDimensionDto(
                status,
                missingTimestamps,
                missingCoords,
                missingReid,
                missingPlates,
                summary
        );
    }
}
