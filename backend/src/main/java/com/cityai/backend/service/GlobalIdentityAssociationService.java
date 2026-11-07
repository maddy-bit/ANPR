package com.cityai.backend.service;

import com.cityai.backend.dto.GlobalIdentityDto;
import com.cityai.backend.dto.IdentityAssociationDto;
import com.cityai.backend.dto.ReviewAssociationRequest;
import com.cityai.backend.dto.VehicleDetectionDto;
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
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Global Vehicle Identity Association Engine.
 * Evaluates pairwise evidence across multiple independent signals:
 * 1. FastReID embedding similarity (with model compatibility gates)
 * 2. Plate text similarity and OCR confidence (with conflict detection)
 * 3. Vehicle class and color attributes
 * 4. Spatial-temporal camera topology feasibility
 * 5. Established global identity membership (preventing silent merges)
 */
@Service
public class GlobalIdentityAssociationService {

    private static final Logger log = LoggerFactory.getLogger(GlobalIdentityAssociationService.class);

    private final VehicleDetectionRepository detectionRepository;
    private final GlobalIdentityRepository identityRepository;
    private final IdentityAssociationRepository associationRepository;

    @Autowired
    public GlobalIdentityAssociationService(
            VehicleDetectionRepository detectionRepository,
            GlobalIdentityRepository identityRepository,
            IdentityAssociationRepository associationRepository,
            @Autowired(required = false) JdbcTemplate jdbcTemplate) {
        this.detectionRepository = detectionRepository;
        this.identityRepository = identityRepository;
        this.associationRepository = associationRepository;
    }

    @Transactional
    public IdentityAssociationDto associateDetections(Long sourceId, Long candidateId, Boolean autoAssign) {
        if (Objects.equals(sourceId, candidateId)) {
            throw new IllegalArgumentException("Cannot associate a detection with itself: " + sourceId);
        }

        // 1. Prevent duplicate association evaluations
        var existingAssoc = associationRepository.findBySourceDetection_IdAndCandidateDetection_Id(sourceId, candidateId);
        if (existingAssoc.isPresent()) {
            log.info("Returning existing association audit record for pair ({}, {})", sourceId, candidateId);
            return IdentityAssociationDto.from(existingAssoc.get());
        }

        VehicleDetection source = detectionRepository.findById(Objects.requireNonNull(sourceId, "sourceId must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Source detection not found with id: " + sourceId));
        VehicleDetection candidate = detectionRepository.findById(Objects.requireNonNull(candidateId, "candidateId must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Candidate detection not found with id: " + candidateId));

        boolean doAutoAssign = (autoAssign == null || autoAssign);

        // 2. Compute Individual Signals
        TopologyEvaluation topoEval = evaluateTopology(source, candidate);
        ReidEvaluation reidEval = evaluateReid(source, candidate);
        PlateEvaluation plateEval = evaluatePlate(source, candidate);
        AttributeEvaluation attrEval = evaluateAttributes(source, candidate);

        // 3. Multi-Signal Decision Logic
        DecisionResult decisionResult = decideAssociation(topoEval, reidEval, plateEval, attrEval, source, candidate);

        // 4. Handle Global Identity Persistence (Protected against silent merges)
        GlobalIdentity targetIdentity = null;
        if ("MATCH".equals(decisionResult.decision()) && doAutoAssign) {
            targetIdentity = resolveIdentityAssignment(source, candidate, decisionResult);
        }

        // If automatic merge was blocked, update decision to UNCERTAIN / PENDING_REVIEW
        String finalDecision = decisionResult.decision();
        String finalReason = decisionResult.reason();
        String reviewStatus = "SYSTEM_DECIDED";

        if (decisionResult.isIdentityConflict()) {
            finalDecision = "UNCERTAIN";
            reviewStatus = "PENDING_REVIEW";
            finalReason = decisionResult.reason();
        } else if ("UNCERTAIN".equals(finalDecision)) {
            reviewStatus = "PENDING_REVIEW";
        }

        IdentityAssociation assoc = new IdentityAssociation(
                source,
                candidate,
                targetIdentity,
                reidEval.score(),
                plateEval.score(),
                attrEval.score(),
                topoEval.score(),
                decisionResult.combinedScore(),
                finalDecision,
                finalReason,
                source.getReidModelName(),
                source.getReidModelVersion()
        );
        assoc.setReviewStatus(reviewStatus);

        IdentityAssociation saved = associationRepository.save(assoc);
        log.info("Evaluated association pair ({}, {}): decision={}, score={:.3f}",
                sourceId, candidateId, finalDecision, decisionResult.combinedScore());

        return IdentityAssociationDto.from(saved);
    }

    private TopologyEvaluation evaluateTopology(VehicleDetection d1, VehicleDetection d2) {
        Camera c1 = d1.getCamera();
        Camera c2 = d2.getCamera();
        Instant t1 = d1.getTimestamp();
        Instant t2 = d2.getTimestamp();

        if (c1 == null || c2 == null || t1 == null || t2 == null) {
            return new TopologyEvaluation(0.50, false, true, "Missing camera or timestamp data");
        }

        if (Objects.equals(c1.getId(), c2.getId())) {
            // Same camera observation
            return new TopologyEvaluation(1.0, false, false, "Same camera observation");
        }

        double dtSec = Math.abs(Duration.between(t1, t2).toMillis()) / 1000.0;

        // Check coordinates
        if (isInvalidCoordinate(c1.getLatitude(), c1.getLongitude()) || isInvalidCoordinate(c2.getLatitude(), c2.getLongitude())) {
            return new TopologyEvaluation(0.50, false, true, "Unconfigured camera coordinates; feasibility unknown");
        }

        // Geodesic distance
        double distKm = GeoUtils.distanceKm(c1.getLatitude(), c1.getLongitude(), c2.getLatitude(), c2.getLongitude());

        // Simultaneous sightings at distant cameras
        if (dtSec <= 0.1 && distKm > 0.05) {
            return new TopologyEvaluation(0.0, true, false,
                    String.format("Simultaneous sightings at distant cameras (%.2f km in %.1fs)", distKm, dtSec));
        }

        double hours = dtSec / 3600.0;
        double speed = (hours > 0) ? (distKm / hours) : 9999.0;
        if (speed > 100.0) {
            return new TopologyEvaluation(0.0, true, false,
                    String.format("Apparent speed (%.1f km/h) exceeds maximum limit (100.0 km/h) over %.2f km in %.1fs", speed, distKm, dtSec));
        }

        // Plausible transition: score based on typical urban speeds
        double score = 0.80;
        if (speed >= 10.0 && speed <= 60.0) {
            score = 1.0;
        } else if (speed > 60.0) {
            score = Math.max(0.60, 1.0 - (speed - 60.0) / 100.0);
        }

        return new TopologyEvaluation(score, false, false,
                String.format("Plausible geodesic transit (%.2f km, dt=%.1fs, speed=%.1f km/h)", distKm, dtSec, speed));
    }

    private ReidEvaluation evaluateReid(VehicleDetection d1, VehicleDetection d2) {
        String m1 = d1.getReidModelName();
        String m2 = d2.getReidModelName();
        String v1 = d1.getReidModelVersion();
        String v2 = d2.getReidModelVersion();
        Integer dim1 = d1.getReidDimension();
        Integer dim2 = d2.getReidDimension();

        double[] vec1 = parseEmbedding(d1.getReidEmbedding());
        double[] vec2 = parseEmbedding(d2.getReidEmbedding());

        if (vec1 == null || vec2 == null || vec1.length == 0 || vec2.length == 0) {
            return new ReidEvaluation(null, false, true, "Missing Re-ID embedding");
        }

        // Strict model compatibility check
        boolean compatible = Objects.equals(m1, m2) && Objects.equals(v1, v2) && Objects.equals(dim1, dim2) && vec1.length == vec2.length;
        if (!compatible) {
            return new ReidEvaluation(null, true, false,
                    String.format("Incompatible Re-ID models: [%s v%s] vs [%s v%s]", m1, v1, m2, v2));
        }

        // Cosine similarity
        double dot = 0.0, n1 = 0.0, n2 = 0.0;
        for (int i = 0; i < vec1.length; i++) {
            dot += vec1[i] * vec2[i];
            n1 += vec1[i] * vec1[i];
            n2 += vec2[i] * vec2[i];
        }
        double sim = 0.0;
        if (n1 > 1e-12 && n2 > 1e-12) {
            sim = dot / (Math.sqrt(n1) * Math.sqrt(n2));
            sim = Math.max(0.0, Math.min(1.0, sim));
        }

        return new ReidEvaluation(sim, false, false, String.format("FastReID cosine similarity: %.4f", sim));
    }

    private PlateEvaluation evaluatePlate(VehicleDetection d1, VehicleDetection d2) {
        String p1 = d1.getPlateTextNormalized();
        String p2 = d2.getPlateTextNormalized();
        Double c1 = d1.getPlateConfidence();
        Double c2 = d2.getPlateConfidence();

        if (p1 == null || p1.isBlank() || p2 == null || p2.isBlank()) {
            return new PlateEvaluation(null, false, true, "One or both plates missing/unreadable");
        }

        double sim = computeStringSimilarity(p1, p2);
        double avgConf = ((c1 != null ? c1 : 0.5) + (c2 != null ? c2 : 0.5)) / 2.0;
        double weightedScore = sim * (0.4 + 0.6 * avgConf);

        boolean isConflict = false;
        if (c1 != null && c1 >= 0.70 && c2 != null && c2 >= 0.70 && sim < 0.60) {
            isConflict = true;
        }

        String reason = isConflict
                ? String.format("Plate conflict: '%s' vs '%s' (conf: %.2f, %.2f)", p1, p2, c1, c2)
                : String.format("Plate match: '%s' vs '%s' (sim: %.2f, weighted: %.2f)", p1, p2, sim, weightedScore);

        return new PlateEvaluation(weightedScore, isConflict, false, reason);
    }

    private AttributeEvaluation evaluateAttributes(VehicleDetection d1, VehicleDetection d2) {
        String class1 = d1.getVehicleClass();
        String class2 = d2.getVehicleClass();

        double classScore = 0.5;
        if (class1 != null && class2 != null) {
            classScore = class1.equalsIgnoreCase(class2) ? 1.0 : 0.0;
        }

        return new AttributeEvaluation(classScore, String.format("Class match: %s vs %s (score: %.1f)", class1, class2, classScore));
    }

    private DecisionResult decideAssociation(
            TopologyEvaluation topo,
            ReidEvaluation reid,
            PlateEvaluation plate,
            AttributeEvaluation attr,
            VehicleDetection d1,
            VehicleDetection d2) {

        // 1. Hard constraint: Physically impossible transition
        if (topo.isImpossible()) {
            return new DecisionResult("NO_MATCH", 0.0, "Physically impossible transition: " + topo.reason(), false);
        }

        // 2. Hard constraint: High-confidence plate conflict
        if (plate.isConflict()) {
            // Even if visual similarity is high, plate conflict overrides
            return new DecisionResult("NO_MATCH", 0.15,
                    "High-confidence plate conflict overrides visual similarity: " + plate.reason(), false);
        }

        // 3. Check for existing established identity conflict (Prevent silent merges)
        GlobalIdentity g1 = d1.getGlobalIdentity();
        GlobalIdentity g2 = d2.getGlobalIdentity();
        boolean identityConflict = (g1 != null && g2 != null && !Objects.equals(g1.getId(), g2.getId()));

        // 4. Unknown topology constraint
        if (topo.isUnknown()) {
            return new DecisionResult("UNCERTAIN", 0.50,
                    "Camera topology/coordinates unconfigured; cannot verify physical feasibility. Marked UNCERTAIN.", identityConflict);
        }

        // 5. Visual similarity alone rule:
        // Visual similarity alone must not automatically establish identity (due to 30.12% false match rate on same make/model)
        if (plate.isMissing()) {
            if (reid.score() != null && reid.score() >= 0.70) {
                return new DecisionResult("UNCERTAIN", reid.score(),
                        String.format("High visual similarity (%.3f) without plate verification is ambiguous (subject to false-match risk); marked UNCERTAIN for review.", reid.score()),
                        identityConflict);
            }
            if (reid.score() != null && reid.score() < 0.45) {
                return new DecisionResult("NO_MATCH", reid.score(),
                        String.format("Low visual similarity (%.3f) with unreadable plate; rejected as NO_MATCH.", reid.score()), false);
            }
            return new DecisionResult("UNCERTAIN", 0.40,
                    "Plate unreadable and visual evidence inconclusive; marked UNCERTAIN.", identityConflict);
        }

        // 6. Multi-Signal Combination: Plate + ReID + Attributes + Topology
        double sPlate = plate.score() != null ? plate.score() : 0.0;
        double sReid = reid.score() != null ? reid.score() : 0.50; // Neutral if Re-ID missing
        double sAttr = attr.score();
        double sTopo = topo.score();

        // Weights: Plate 0.45, ReID 0.30, Attr 0.15, Topo 0.10
        double combined = (0.45 * sPlate) + (0.30 * sReid) + (0.15 * sAttr) + (0.10 * sTopo);

        // Multi-signal decision thresholding:
        // MATCH requires strong plate agreement AND visual/attribute compatibility AND feasible topology
        if (sPlate >= 0.80 && sReid >= 0.60 && sAttr >= 0.70 && combined >= 0.80) {
            if (identityConflict && g1 != null && g2 != null) {
                return new DecisionResult("UNCERTAIN", combined,
                        String.format("Detections belong to separate existing global identities (%s and %s); automatic merge prohibited. Flagged for review.",
                                g1.getLabel(), g2.getLabel()), true);
            }
            return new DecisionResult("MATCH", combined,
                    String.format("Multi-signal agreement: plate (%.2f), visual (%.3f), attributes (%.1f), topology (%.1f)",
                            sPlate, sReid, sAttr, sTopo), false);
        }

        if (combined < 0.50 || (reid.score() != null && reid.score() < 0.40)) {
            return new DecisionResult("NO_MATCH", combined,
                    String.format("Insufficient evidence across signals (combined: %.3f, reid: %s)",
                            combined, reid.score() != null ? String.format("%.3f", reid.score()) : "N/A"), false);
        }

        return new DecisionResult("UNCERTAIN", combined,
                String.format("Evidence inconclusive (combined: %.3f); marked UNCERTAIN for review.", combined), identityConflict);
    }

    private GlobalIdentity resolveIdentityAssignment(VehicleDetection d1, VehicleDetection d2, DecisionResult decision) {
        GlobalIdentity g1 = d1.getGlobalIdentity();
        GlobalIdentity g2 = d2.getGlobalIdentity();

        if (g1 != null && g2 != null) {
            // Already belonging to same identity
            return g1;
        }

        if (g1 != null) {
            d2.setGlobalIdentity(g1);
            updateIdentityMetrics(g1, d2);
            detectionRepository.save(d2);
            identityRepository.save(g1);
            return g1;
        }

        if (g2 != null) {
            d1.setGlobalIdentity(g2);
            updateIdentityMetrics(g2, d1);
            detectionRepository.save(d1);
            identityRepository.save(g2);
            return g2;
        }

        // Neither has an identity: Create new GlobalIdentity
        String label = "GLOBAL-VEH-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase();
        String primaryPlate = d1.getPlateTextNormalized() != null ? d1.getPlateTextNormalized() : d2.getPlateTextNormalized();
        Double plateConf = d1.getPlateConfidence() != null ? d1.getPlateConfidence() : d2.getPlateConfidence();
        String vClass = d1.getVehicleClass() != null ? d1.getVehicleClass() : d2.getVehicleClass();

        Instant firstSeen = d1.getTimestamp().isBefore(d2.getTimestamp()) ? d1.getTimestamp() : d2.getTimestamp();
        Instant lastSeen = d1.getTimestamp().isAfter(d2.getTimestamp()) ? d1.getTimestamp() : d2.getTimestamp();

        GlobalIdentity newIdentity = new GlobalIdentity(
                label,
                primaryPlate,
                plateConf,
                vClass,
                null,
                null,
                null,
                d1.getReidEmbedding() != null ? d1.getReidEmbedding() : d2.getReidEmbedding(),
                d1.getReidModelName(),
                d1.getReidModelVersion(),
                d1.getReidDimension(),
                firstSeen,
                lastSeen
        );
        newIdentity.setDetectionCount(2);
        GlobalIdentity saved = identityRepository.save(newIdentity);

        d1.setGlobalIdentity(saved);
        d2.setGlobalIdentity(saved);
        detectionRepository.save(d1);
        detectionRepository.save(d2);

        return saved;
    }

    private void updateIdentityMetrics(GlobalIdentity gid, VehicleDetection newDet) {
        gid.setDetectionCount(gid.getDetectionCount() + 1);
        if (newDet.getTimestamp().isBefore(gid.getFirstSeenTimestamp())) {
            gid.setFirstSeenTimestamp(newDet.getTimestamp());
        }
        if (newDet.getTimestamp().isAfter(gid.getLastSeenTimestamp())) {
            gid.setLastSeenTimestamp(newDet.getTimestamp());
        }
        if (gid.getPrimaryPlate() == null && newDet.getPlateTextNormalized() != null) {
            gid.setPrimaryPlate(newDet.getPlateTextNormalized());
            gid.setPlateConfidence(newDet.getPlateConfidence());
        }
    }

    @Transactional(readOnly = true)
    public GlobalIdentityDto getGlobalIdentity(UUID id) {
        GlobalIdentity gid = identityRepository.findById(Objects.requireNonNull(id, "id must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Global identity not found with id: " + id));
        return GlobalIdentityDto.from(gid);
    }

    @Transactional(readOnly = true)
    public Page<GlobalIdentityDto> listIdentities(Pageable pageable) {
        return identityRepository.findAll(Objects.requireNonNull(pageable, "pageable must not be null")).map(GlobalIdentityDto::from);
    }

    @Transactional(readOnly = true)
    public GlobalIdentityDto searchIdentity(String query) {
        if (query == null || query.isBlank()) {
            throw new IllegalArgumentException("Search query cannot be blank");
        }
        String trimmed = query.trim();
        try {
            UUID id = UUID.fromString(trimmed);
            return getGlobalIdentity(id);
        } catch (IllegalArgumentException ignored) {}

        var byLabel = identityRepository.findByLabel(trimmed);
        if (byLabel.isPresent()) {
            return GlobalIdentityDto.from(byLabel.get());
        }

        var byPlate = identityRepository.findByPrimaryPlate(trimmed.toUpperCase());
        if (byPlate.isPresent()) {
            return GlobalIdentityDto.from(byPlate.get());
        }

        throw new NoSuchElementException("No global vehicle identity found matching: " + trimmed);
    }

    @Transactional(readOnly = true)
    public Page<VehicleDetectionDto> getIdentityDetections(UUID id, Pageable pageable) {
        if (!identityRepository.existsById(Objects.requireNonNull(id, "id must not be null"))) {
            throw new NoSuchElementException("Global identity not found with id: " + id);
        }
        return detectionRepository.findByGlobalIdentity_IdOrderByTimestampAsc(id, pageable)
                .map(VehicleDetectionDto::from);
    }

    @Transactional(readOnly = true)
    public Page<IdentityAssociationDto> getIdentityAssociations(UUID id, Pageable pageable) {
        if (!identityRepository.existsById(Objects.requireNonNull(id, "id must not be null"))) {
            throw new NoSuchElementException("Global identity not found with id: " + id);
        }
        return associationRepository.findByGlobalIdentity_IdOrderByCreatedAtDesc(id, pageable)
                .map(IdentityAssociationDto::from);
    }

    @Transactional
    public IdentityAssociationDto reviewAssociation(UUID associationId, ReviewAssociationRequest request) {
        IdentityAssociation assoc = associationRepository.findById(Objects.requireNonNull(associationId, "associationId must not be null"))
                .orElseThrow(() -> new NoSuchElementException("Identity association not found with id: " + associationId));

        String action = request.action();
        if ("CONFIRM_MATCH".equalsIgnoreCase(action)) {
            assoc.setDecision("MATCH");
            assoc.setReviewStatus("CONFIRMED_BY_USER");
            assoc.setReviewNotes(request.reviewNotes());

            // Target identity
            GlobalIdentity target = null;
            if (request.targetGlobalIdentityId() != null) {
                target = identityRepository.findById(Objects.requireNonNull(request.targetGlobalIdentityId())).orElse(null);
            }
            if (target == null) {
                target = resolveIdentityAssignment(assoc.getSourceDetection(), assoc.getCandidateDetection(),
                        new DecisionResult("MATCH", assoc.getOverallScore(), "Confirmed by user", false));
            }
            assoc.setGlobalIdentity(target);
        } else if ("REJECT_MATCH".equalsIgnoreCase(action)) {
            assoc.setDecision("NO_MATCH");
            assoc.setReviewStatus("REJECTED_BY_USER");
            assoc.setReviewNotes(request.reviewNotes());
        } else if ("FLAG_CONFLICT".equalsIgnoreCase(action)) {
            assoc.setReviewStatus("FLAGGED_CONFLICT");
            assoc.setReviewNotes(request.reviewNotes());
        } else {
            throw new IllegalArgumentException("Unknown review action: " + action);
        }

        assoc.setUpdatedAt(Instant.now());
        IdentityAssociation saved = associationRepository.save(assoc);
        return IdentityAssociationDto.from(saved);
    }

    private double computeStringSimilarity(String s1, String s2) {
        if (s1.equalsIgnoreCase(s2)) {
            return 1.0;
        }
        int dist = levenshteinDistance(s1, s2);
        int maxLen = Math.max(s1.length(), s2.length());
        if (maxLen == 0) {
            return 1.0;
        }
        return Math.max(0.0, 1.0 - ((double) dist / maxLen));
    }

    private int levenshteinDistance(String s1, String s2) {
        int[][] dp = new int[s1.length() + 1][s2.length() + 1];
        for (int i = 0; i <= s1.length(); i++) dp[i][0] = i;
        for (int j = 0; j <= s2.length(); j++) dp[0][j] = j;

        for (int i = 1; i <= s1.length(); i++) {
            for (int j = 1; j <= s2.length(); j++) {
                int cost = (s1.charAt(i - 1) == s2.charAt(j - 1)) ? 0 : 1;
                dp[i][j] = Math.min(Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1), dp[i - 1][j - 1] + cost);
            }
        }
        return dp[s1.length()][s2.length()];
    }

    private boolean isInvalidCoordinate(double lat, double lon) {
        return (Math.abs(lat) < 1e-4 && Math.abs(lon) < 1e-4) || lat < -90.0 || lat > 90.0 || lon < -180.0 || lon > 180.0;
    }

    private double[] parseEmbedding(String str) {
        if (str == null || str.isBlank()) return null;
        try {
            String c = str.trim();
            if (c.startsWith("[")) c = c.substring(1);
            if (c.endsWith("]")) c = c.substring(0, c.length() - 1);
            if (c.isBlank()) return null;
            String[] p = c.split(",");
            double[] arr = new double[p.length];
            for (int i = 0; i < p.length; i++) arr[i] = Double.parseDouble(p[i].trim());
            return arr;
        } catch (Exception e) {
            return null;
        }
    }

    private record TopologyEvaluation(double score, boolean isImpossible, boolean isUnknown, String reason) {}
    private record ReidEvaluation(Double score, boolean isIncompatible, boolean isMissing, String reason) {}
    private record PlateEvaluation(Double score, boolean isConflict, boolean isMissing, String reason) {}
    private record AttributeEvaluation(double score, String reason) {}
    private record DecisionResult(String decision, double combinedScore, String reason, boolean isIdentityConflict) {}
}

