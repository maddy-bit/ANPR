package com.cityai.backend.controller;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VehicleSummaryDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VehicleRepository;
import com.cityai.backend.service.AuditLogService;
import com.cityai.backend.service.VehicleRegistryService;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

class VehicleControllerTest {

    private VehicleRepository vehicleRepository;
    private VehicleDetectionRepository detectionRepository;
    private VehicleRegistryService registryService;
    private AuditLogService auditLogService;
    private HttpServletRequest request;
    private VehicleController controller;

    @BeforeEach
    void setUp() {
        vehicleRepository = Mockito.mock(VehicleRepository.class);
        detectionRepository = Mockito.mock(VehicleDetectionRepository.class);
        registryService = Mockito.mock(VehicleRegistryService.class);
        auditLogService = Mockito.mock(AuditLogService.class);
        request = Mockito.mock(HttpServletRequest.class);

        controller = new VehicleController(
                vehicleRepository,
                detectionRepository,
                registryService,
                auditLogService
        );
    }

    @Test
    void getVehicle_WithPersistedDetections_ReturnsGenuineMetrics() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate, "Sedan", "Silver", "Toyota", "Prius");
        Camera cam1 = new Camera("CAM-01", "Deccan", 18.51, 73.85, "N", "ONLINE", "stream1");
        Camera cam2 = new Camera("CAM-02", "Swargate", 18.50, 73.86, "S", "ONLINE", "stream2");

        Instant t1 = Instant.parse("2026-11-01T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-01T10:30:00Z");

        VehicleDetection d1 = new VehicleDetection(vehicle, cam1, t1);
        VehicleDetection d2 = new VehicleDetection(vehicle, cam2, t2);

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of(d1, d2));

        VehicleSummaryDto summary = controller.getVehicle(plate, request);

        assertThat(summary.vehicle().plate()).isEqualTo(plate);
        assertThat(summary.vehicle().make()).isEqualTo("Toyota");
        assertThat(summary.vehicle().model()).isEqualTo("Prius");
        assertThat(summary.firstSeen()).isEqualTo(t1);
        assertThat(summary.lastSeen()).isEqualTo(t2);
        assertThat(summary.cameraCount()).isEqualTo(2);
        assertThat(summary.camerasVisited()).containsExactly("CAM-01", "CAM-02");
        assertThat(summary.detectionCount()).isEqualTo(2);
    }

    @Test
    void getVehicle_WhenNoDetectionsInDatabase_ReturnsZeroedSummaryWithoutFallback() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate, "Sedan", "Silver", "Toyota", "Prius");

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of());

        VehicleSummaryDto summary = controller.getVehicle(plate, request);

        // Verification of honest zero/null states
        assertThat(summary.firstSeen()).isNull();
        assertThat(summary.lastSeen()).isNull();
        assertThat(summary.cameraCount()).isEqualTo(0);
        assertThat(summary.camerasVisited()).isEmpty();
        assertThat(summary.detectionCount()).isEqualTo(0);

        // Explicitly assert absence of previously hardcoded demo values
        assertThat(summary.detectionCount()).isNotEqualTo(15);
        assertThat(summary.camerasVisited()).doesNotContain("CAM-03", "CAM-07", "CAM-11");
    }

    @Test
    void getVehicle_WhenUndetectedAndUnregistered_ThrowsNoSuchElementException() {
        String plate = "MH12UNKNOWN";

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.empty());
        when(registryService.lookup(plate)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.getVehicle(plate, request))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("No vehicle found for plate: " + plate);
    }

    @Test
    void getVehicle_DetectionOnlyWithoutRegistry_ReturnsNullMakeModelColor() {
        String plate = "MH12RAW999";
        // Vehicle created from raw detection with no external registry match
        Vehicle vehicle = new Vehicle(plate);
        Camera cam = new Camera("CAM-05", "Shivaji Nagar", 18.53, 73.84, "E", "ONLINE", "stream5");
        Instant t = Instant.parse("2026-11-01T12:00:00Z");
        VehicleDetection d = new VehicleDetection(vehicle, cam, t);

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of(d));

        VehicleSummaryDto summary = controller.getVehicle(plate, request);

        assertThat(summary.vehicle().plate()).isEqualTo(plate);
        assertThat(summary.vehicle().make()).isNull();
        assertThat(summary.vehicle().model()).isNull();
        assertThat(summary.vehicle().color()).isNull();
        assertThat(summary.vehicle().vehicleType()).isNull();
        assertThat(summary.detectionCount()).isEqualTo(1);
    }

    @Test
    void getDetections_WhenEmpty_ReturnsEmptyList() {
        String plate = "MH12EMPTY";
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of());

        List<VehicleDetectionDto> detections = controller.getDetections(plate);

        assertThat(detections).isEmpty();
    }
}

