package com.cityai.backend.controller;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VehicleDto;
import com.cityai.backend.dto.VehicleSummaryDto;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VehicleRepository;
import com.cityai.backend.service.AuditLogService;
import com.cityai.backend.service.VehicleRegistryService;
import com.cityai.backend.util.PlateNormalizer;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/vehicles")
@Transactional
public class VehicleController {

    private final VehicleRepository vehicleRepository;
    private final VehicleDetectionRepository detectionRepository;
    private final AuditLogService auditLogService;

    public VehicleController(
            VehicleRepository vehicleRepository,
            VehicleDetectionRepository detectionRepository,
            AuditLogService auditLogService) {
        this.vehicleRepository = vehicleRepository;
        this.detectionRepository = detectionRepository;
        this.auditLogService = auditLogService;
    }

    public VehicleController(
            VehicleRepository vehicleRepository,
            VehicleDetectionRepository detectionRepository,
            VehicleRegistryService registryService,
            AuditLogService auditLogService) {
        this(vehicleRepository, detectionRepository, auditLogService);
    }

    /**
     * Returns genuinely detected vehicles recently ingested into the database.
     * When the database is fresh/empty, returns an honest empty list [].
     */
    @GetMapping("/recent")
    public List<VehicleDto> getRecentVehicles() {
        return vehicleRepository.findTop10ByOrderByIdDesc().stream()
                .map(VehicleDto::from)
                .toList();
    }

    @GetMapping("/{plate}")
    public VehicleSummaryDto getVehicle(@PathVariable("plate") String plate, HttpServletRequest request) {
        String normalized = PlateNormalizer.normalize(plate);
        auditLogService.record("VEHICLE_SEARCH", normalized, request);

        // Honest query: only return vehicles that actually exist in the database from genuine detections
        Vehicle vehicle = vehicleRepository.findByPlate(normalized)
                .orElseThrow(() -> new java.util.NoSuchElementException("No vehicle found for plate: " + normalized));

        List<VehicleDetection> detections =
                detectionRepository.findByVehicle_PlateOrderByTimestampAsc(normalized);

        if (detections.isEmpty()) {
            return new VehicleSummaryDto(
                    VehicleDto.from(vehicle),
                    null,
                    null,
                    0,
                    List.of(),
                    0
            );
        }

        List<String> camerasVisited = detections.stream()
                .map(d -> d.getCamera().getId())
                .distinct()
                .toList();

        return new VehicleSummaryDto(
                VehicleDto.from(vehicle),
                detections.get(0).getTimestamp(),
                detections.get(detections.size() - 1).getTimestamp(),
                camerasVisited.size(),
                camerasVisited,
                detections.size()
        );
    }

    @GetMapping("/{plate}/detections")
    public List<VehicleDetectionDto> getDetections(@PathVariable("plate") String plate) {
        String normalized = PlateNormalizer.normalize(plate);
        return detectionRepository.findByVehicle_PlateOrderByTimestampAsc(normalized).stream()
                .map(VehicleDetectionDto::from)
                .collect(Collectors.toList());
    }
}
