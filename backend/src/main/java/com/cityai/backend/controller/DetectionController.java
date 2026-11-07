package com.cityai.backend.controller;

import com.cityai.backend.dto.CandidateAssociationResponseDto;
import com.cityai.backend.dto.DetectionIngestRequest;
import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.service.CandidateAssociationService;
import com.cityai.backend.service.DetectionIngestionService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Ingestion and candidate association endpoints for AI detection evidence.
 */
@RestController
@RequestMapping("/api/detections")
public class DetectionController {

    private final DetectionIngestionService ingestionService;
    private final CandidateAssociationService candidateAssociationService;

    public DetectionController(
            DetectionIngestionService ingestionService,
            CandidateAssociationService candidateAssociationService) {
        this.ingestionService = ingestionService;
        this.candidateAssociationService = candidateAssociationService;
    }

    @PostMapping("/ingest")
    public ResponseEntity<VehicleDetectionDto> ingest(@Valid @RequestBody DetectionIngestRequest request) {
        var saved = ingestionService.ingest(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(VehicleDetectionDto.from(saved));
    }

    @PostMapping("/ingest/batch")
    public ResponseEntity<List<VehicleDetectionDto>> ingestBatch(@Valid @RequestBody List<DetectionIngestRequest> requests) {
        List<VehicleDetectionDto> saved = requests.stream()
                .map(ingestionService::ingest)
                .map(VehicleDetectionDto::from)
                .toList();
        return ResponseEntity.status(HttpStatus.CREATED).body(saved);
    }

    /**
     * Phase A5 Candidate Association API:
     * Accepts a source detection ID and evaluates spatial-temporal feasibility and
     * Re-ID model compatibility against candidate detections from other cameras.
     */
    @GetMapping("/{id}/candidates")
    public ResponseEntity<CandidateAssociationResponseDto> getCandidates(
            @PathVariable("id") Long id,
            @RequestParam(name = "minSpeedKmh", defaultValue = "5.0") Double minSpeedKmh,
            @RequestParam(name = "maxSpeedKmh", defaultValue = "100.0") Double maxSpeedKmh,
            @RequestParam(name = "maxTimeWindowSec", defaultValue = "7200.0") Double maxTimeWindowSec,
            @RequestParam(name = "feasibleOnly", defaultValue = "false") boolean feasibleOnly) {

        CandidateAssociationResponseDto response = candidateAssociationService.findCandidates(
                id, minSpeedKmh, maxSpeedKmh, maxTimeWindowSec, feasibleOnly
        );
        return ResponseEntity.ok(response);
    }
}
