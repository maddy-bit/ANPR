package com.cityai.backend.controller;

import com.cityai.backend.dto.VehicleDetectionDto;
import com.cityai.backend.dto.VehicleDto;
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
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


class VehicleControllerTest {

    private VehicleRepository vehicleRepository;
    private VehicleDetectionRepository detectionRepository;
    private VehicleRegistryService registryService;
    private AuditLogService auditLogService;
    private HttpServletRequest request;
    private VehicleController controller;
    private MockMvc mockMvc;

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
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void getVehicle_WithPersistedDetections_ReturnsGenuineMetrics() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate, "Sedan", "Silver", "Toyota", "Prius");
        Camera cam1 = new Camera("CAM-01", "Deccan", 18.51, 73.85, "N", "CONFIGURED", "stream1");
        Camera cam2 = new Camera("CAM-02", "Swargate", 18.50, 73.86, "S", "CONFIGURED", "stream2");

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

        assertThatThrownBy(() -> controller.getVehicle(plate, request))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("No vehicle found for plate: " + plate);
    }

    @Test
    void getVehicle_DetectionOnlyWithoutRegistry_ReturnsNullMakeModelColor() {
        String plate = "MH12RAW999";
        // Vehicle created from raw detection with no external registry match
        Vehicle vehicle = new Vehicle(plate);
        Camera cam = new Camera("CAM-05", "Shivaji Nagar", 18.53, 73.84, "E", "CONFIGURED", "stream5");
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

    @Test
    void getRecentVehicles_WhenNoVehicles_ReturnsEmptyList() {
        when(vehicleRepository.findTop10ByOrderByIdDesc()).thenReturn(List.of());

        List<VehicleDto> recent = controller.getRecentVehicles();

        assertThat(recent).isEmpty();
    }

    @Test
    void getRecentVehicles_WithPersistedVehicles_ReturnsGenuinelyDetectedVehicles() {
        Vehicle v1 = new Vehicle("MH12AB1234", "car", "white", null, null);
        Vehicle v2 = new Vehicle("DL01CD5678", "truck", "blue", null, null);
        when(vehicleRepository.findTop10ByOrderByIdDesc()).thenReturn(List.of(v2, v1));

        List<VehicleDto> recent = controller.getRecentVehicles();

        assertThat(recent).hasSize(2);
        assertThat(recent.get(0).plate()).isEqualTo("DL01CD5678");
        assertThat(recent.get(1).plate()).isEqualTo("MH12AB1234");
    }

    @Test
    void getVehicle_WhenUndetected_ReturnsHttp404NotFoundAndNot500() throws Exception {
        String plate = "UNKNOWN99";
        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/vehicles/" + plate))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("No vehicle found for plate: " + plate))
                .andExpect(jsonPath("$.timestamp").isNotEmpty());
    }

    @Test
    void getVehicle_WhenDetected_ReturnsHttp200() throws Exception {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate, "Sedan", "Silver", "Toyota", "Prius");
        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of());

        mockMvc.perform(get("/api/vehicles/" + plate))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.vehicle.plate").value(plate))
                .andExpect(jsonPath("$.detectionCount").value(0));
    }
}
