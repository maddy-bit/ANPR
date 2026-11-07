package com.cityai.backend.controller;

import com.cityai.backend.dto.AssociateCandidateRequest;
import com.cityai.backend.dto.GlobalIdentityDto;
import com.cityai.backend.dto.GlobalTrajectoryDto;
import com.cityai.backend.dto.IdentityAssociationDto;
import com.cityai.backend.dto.ReviewAssociationRequest;
import com.cityai.backend.dto.TrajectoryQualityDto;
import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.service.GlobalIdentityAssociationService;
import com.cityai.backend.service.GlobalTrajectoryService;
import com.cityai.backend.service.TrajectoryQualityService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * REST API for Global Vehicle Identity Registry, Multi-Signal Association, and Trajectory Reconstruction.
 */
@RestController
@RequestMapping("/api/identities")
public class GlobalIdentityController {

    private final GlobalIdentityAssociationService associationService;
    private final GlobalTrajectoryService trajectoryService;
    private final TrajectoryQualityService qualityService;

    public GlobalIdentityController(
            GlobalIdentityAssociationService associationService,
            GlobalTrajectoryService trajectoryService,
            TrajectoryQualityService qualityService) {
        this.associationService = associationService;
        this.trajectoryService = trajectoryService;
        this.qualityService = qualityService;
    }

    /**
     * Retrieve paginated list of global vehicle identities.
     */
    @GetMapping
    public ResponseEntity<Page<GlobalIdentityDto>> listIdentities(
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) {
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.max(1, Math.min(100, size));
        return ResponseEntity.ok(associationService.listIdentities(PageRequest.of(boundedPage, boundedSize)));
    }

    /**
     * Search for a global vehicle identity by UUID, label, or primary plate.
     */
    @GetMapping("/search")
    public ResponseEntity<GlobalIdentityDto> searchIdentity(@RequestParam("query") String query) {
        if (query == null || query.trim().isEmpty()) {
            throw new IllegalArgumentException("Search query cannot be blank");
        }
        return ResponseEntity.ok(associationService.searchIdentity(query.trim()));
    }

    /**
     * Retrieve a global vehicle identity by UUID.
     */
    @GetMapping("/{id}")
    public ResponseEntity<GlobalIdentityDto> getIdentity(@PathVariable("id") UUID id) {
        return ResponseEntity.ok(associationService.getGlobalIdentity(id));
    }

    /**
     * Retrieve chronologically ordered detections linked to this global identity.
     */
    @GetMapping("/{id}/detections")
    public ResponseEntity<Page<VehicleDetectionDto>> getIdentityDetections(
            @PathVariable("id") UUID id,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) {
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.max(1, Math.min(100, size));
        Page<VehicleDetectionDto> detections = associationService
                .getIdentityDetections(id, PageRequest.of(boundedPage, boundedSize));
        return ResponseEntity.ok(detections);
    }

    /**
     * Retrieve association audit records for this global identity.
     */
    @GetMapping("/{id}/associations")
    public ResponseEntity<Page<IdentityAssociationDto>> getIdentityAssociations(
            @PathVariable("id") UUID id,
            @RequestParam(name = "page", defaultValue = "0") int page,
            @RequestParam(name = "size", defaultValue = "20") int size
    ) {
        int boundedPage = Math.max(0, page);
        int boundedSize = Math.max(1, Math.min(100, size));
        Page<IdentityAssociationDto> associations = associationService
                .getIdentityAssociations(id, PageRequest.of(boundedPage, boundedSize));
        return ResponseEntity.ok(associations);
    }

    /**
     * Evaluate pairwise multi-signal association between a source detection and candidate detection.
     */
    @PostMapping("/associate")
    public ResponseEntity<IdentityAssociationDto> associate(
            @Valid @RequestBody AssociateCandidateRequest request
    ) {
        IdentityAssociationDto result = associationService.associateDetections(
                request.sourceDetectionId(),
                request.candidateDetectionId(),
                request.autoAssign()
        );
        return ResponseEntity.ok(result);
    }

    /**
     * Resolve or review an association (e.g. manual confirmation, rejection, conflict flag).
     */
    @PostMapping("/associations/{id}/resolve")
    public ResponseEntity<IdentityAssociationDto> resolveAssociation(
            @PathVariable("id") UUID id,
            @Valid @RequestBody ReviewAssociationRequest request
    ) {
        IdentityAssociationDto result = associationService.reviewAssociation(id, request);
        return ResponseEntity.ok(result);
    }

    /**
     * Reconstruct chronologically ordered, geographically grounded trajectory for a global identity.
     */
    @GetMapping("/{id}/trajectory")
    public ResponseEntity<GlobalTrajectoryDto> getTrajectory(@PathVariable("id") UUID id) {
        return ResponseEntity.ok(trajectoryService.reconstructTrajectory(id));
    }

    /**
     * Assess trajectory evidence quality and reliability across multiple independent dimensions.
     */
    @GetMapping("/{id}/trajectory/quality")
    public ResponseEntity<TrajectoryQualityDto> getTrajectoryQuality(@PathVariable("id") UUID id) {
        return ResponseEntity.ok(qualityService.assessTrajectoryQuality(id));
    }
}

