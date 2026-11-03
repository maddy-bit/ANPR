package com.cityai.backend.trajectory;

import com.cityai.backend.dto.TrajectoryResponseDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.model.Vehicle;
import com.cityai.backend.model.VehicleDetection;
import com.cityai.backend.repository.VehicleDetectionRepository;
import com.cityai.backend.repository.VehicleRepository;
import com.cityai.backend.service.VehicleRegistryService;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

class TrajectoryEngineTest {

    private VehicleRepository vehicleRepository;
    private VehicleDetectionRepository detectionRepository;
    private VehicleRegistryService registryService;
    private TrajectoryScoringService scoringService;
    private TrajectoryEngine engine;

    @BeforeEach
    void setUp() {
        vehicleRepository = Mockito.mock(VehicleRepository.class);
        detectionRepository = Mockito.mock(VehicleDetectionRepository.class);
        registryService = Mockito.mock(VehicleRegistryService.class);
        scoringService = Mockito.mock(TrajectoryScoringService.class);

        engine = new TrajectoryEngine(
                vehicleRepository,
                detectionRepository,
                registryService,
                scoringService
        );
    }

    @Test
    void reconstruct_WhenNoDetections_ReturnsEmptyTrajectoryWithoutFallback() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate);

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of());

        TrajectoryEngine.TrajectoryResult result = engine.reconstruct(plate);

        assertThat(result.visits()).isEmpty();
        assertThat(result.transitions()).isEmpty();
        assertThat(result.overallConfidence()).isNull();
        assertThat(result.totalDistanceKm()).isEqualTo(0.0);
        assertThat(result.totalDurationMinutes()).isEqualTo(0);
        assertThat(result.warning()).contains("NO_TRAJECTORY_FOUND");

        // Verify DTO representation for API clients
        TrajectoryResponseDto dto = result.toDto();
        assertThat(dto.points()).isEmpty();
        assertThat(dto.overallConfidence()).isNull();
        assertThat(dto.estimatedDistanceKm()).isEqualTo(0.0);
        assertThat(dto.estimatedDurationMinutes()).isEqualTo(0);
        assertThat(dto.warning()).contains("NO_TRAJECTORY_FOUND");

        // Explicitly assert absence of previous hardcoded fallback demo values
        assertThat(dto.estimatedDistanceKm()).isNotEqualTo(11.2);
        assertThat(dto.estimatedDurationMinutes()).isNotEqualTo(34L);
        if (dto.overallConfidence() != null) { assertThat(dto.overallConfidence()).isNotEqualTo(0.94); }
    }

    @Test
    void reconstruct_WhenSingleDetection_ReturnsSingleVisitWithReliabilityWarning() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate);
        Camera cam1 = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", "stream1");
        Instant t1 = Instant.parse("2026-11-01T10:00:00Z");
        VehicleDetection d1 = new VehicleDetection(vehicle, cam1, t1);

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of(d1));

        TrajectoryEngine.TrajectoryResult result = engine.reconstruct(plate);

        assertThat(result.visits()).hasSize(1);
        assertThat(result.transitions()).isEmpty();
        assertThat(result.overallConfidence()).isNull();
        assertThat(result.warning()).contains("NO_RELIABLE_TRAJECTORY_FOUND: only one camera detection available.");

        TrajectoryResponseDto dto = result.toDto();
        assertThat(dto.points()).hasSize(1);
        assertThat(dto.overallConfidence()).isNull();
    }

    @Test
    void reconstruct_WhenMultiCameraDetections_ComputesGenuineRouteAndTransitions() {
        String plate = "MH12AB1234";
        Vehicle vehicle = new Vehicle(plate);
        Camera cam1 = new Camera("CAM-01", "Shivajinagar", 18.5308, 73.8474, "SE", "ONLINE", "stream1");
        Camera cam2 = new Camera("CAM-03", "Deccan", 18.5158, 73.8412, "SW", "ONLINE", "stream2");

        Instant t1 = Instant.parse("2026-11-01T10:00:00Z");
        Instant t2 = Instant.parse("2026-11-01T10:15:00Z");

        VehicleDetection d1 = new VehicleDetection(vehicle, cam1, t1);
        VehicleDetection d2 = new VehicleDetection(vehicle, cam2, t2);

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.of(vehicle));
        when(detectionRepository.findByVehicle_PlateOrderByTimestampAsc(plate)).thenReturn(List.of(d1, d2));

        var mockScore = new TrajectoryScoringService.TransitionScore(
                1.7, 15.0, 6.8, 0.90, 1.0, 1.0, 0.85, null, 0.92, false, null);
        when(scoringService.score(any(), any(), any(), any(), any(), any())).thenReturn(mockScore);

        TrajectoryEngine.TrajectoryResult result = engine.reconstruct(plate);

        assertThat(result.visits()).hasSize(2);
        assertThat(result.transitions()).hasSize(1);
        assertThat(result.overallConfidence()).isEqualTo(0.92);
        assertThat(result.totalDistanceKm()).isEqualTo(1.7);
        assertThat(result.totalDurationMinutes()).isEqualTo(15);
        assertThat(result.warning()).isNull();

        TrajectoryResponseDto dto = result.toDto();
        assertThat(dto.points()).hasSize(2);
        assertThat(dto.overallConfidence()).isEqualTo(0.92);
        assertThat(dto.estimatedDistanceKm()).isEqualTo(1.7);
        assertThat(dto.estimatedDurationMinutes()).isEqualTo(15);
    }

    @Test
    void reconstruct_WhenVehicleUnregisteredAndUndetected_ThrowsNoSuchElementException() {
        String plate = "UNKNOWN999";

        when(vehicleRepository.findByPlate(plate)).thenReturn(Optional.empty());
        when(registryService.lookup(plate)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> engine.reconstruct(plate))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("No vehicle found for plate: " + plate);
    }
}

