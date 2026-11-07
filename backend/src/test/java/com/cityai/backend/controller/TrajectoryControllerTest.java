package com.cityai.backend.controller;

import com.cityai.backend.dto.TrajectoryPointDto;
import com.cityai.backend.dto.TrajectoryResponseDto;
import com.cityai.backend.dto.VehicleDto;
import com.cityai.backend.service.AuditLogService;
import com.cityai.backend.trajectory.TrajectoryEngine;
import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class TrajectoryControllerTest {

    private TrajectoryEngine trajectoryEngine;
    private AuditLogService auditLogService;
    private TrajectoryController controller;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        trajectoryEngine = Mockito.mock(TrajectoryEngine.class);
        auditLogService = Mockito.mock(AuditLogService.class);
        controller = new TrajectoryController(trajectoryEngine, auditLogService);

        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void getTrajectory_WhenPlateUnknown_ReturnsHttp404NotFoundAndNot500() throws Exception {
        String plate = "UNKNOWN99";
        when(trajectoryEngine.reconstructAsDto(plate))
                .thenThrow(new NoSuchElementException("No vehicle found for plate: " + plate));

        mockMvc.perform(get("/api/vehicles/" + plate + "/trajectory"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("No vehicle found for plate: " + plate))
                .andExpect(jsonPath("$.timestamp").isNotEmpty());

        verify(auditLogService).record(eq("TRAJECTORY_VIEW"), eq(plate), any());
    }

    @Test
    void getTrajectory_WhenPlateKnown_ReturnsHttp200WithDto() throws Exception {
        String plate = "MH12AB1234";
        VehicleDto vehicle = new VehicleDto(plate, "Sedan", "Silver", "Toyota", "Prius");
        TrajectoryPointDto p1 = new TrajectoryPointDto(
                "CAM-01", "Gateway North", 18.52, 73.84, "N",
                Instant.parse("2026-11-01T10:00:00Z"),
                0.95, 0.98, "/evidence/p1.jpg", 3, null, null
        );
        TrajectoryPointDto p2 = new TrajectoryPointDto(
                "CAM-02", "City Center", 18.51, 73.85, "S",
                Instant.parse("2026-11-01T10:15:00Z"),
                0.92, 0.94, "/evidence/p2.jpg", 2, 0.88, null
        );

        TrajectoryResponseDto responseDto = new TrajectoryResponseDto(
                vehicle, List.of(p1, p2), 0.88, 3.5, 15, null
        );

        when(trajectoryEngine.reconstructAsDto(plate)).thenReturn(responseDto);

        mockMvc.perform(get("/api/vehicles/" + plate + "/trajectory"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.vehicle.plate").value(plate))
                .andExpect(jsonPath("$.points.length()").value(2))
                .andExpect(jsonPath("$.overallConfidence").value(0.88))
                .andExpect(jsonPath("$.estimatedDistanceKm").value(3.5))
                .andExpect(jsonPath("$.estimatedDurationMinutes").value(15));
    }

    @Test
    void getTrajectory_WhenSingleCameraVisit_ReturnsHttp200WithWarningNotice() throws Exception {
        String plate = "MH12SOLO";
        VehicleDto vehicle = new VehicleDto(plate, "Sedan", "White", "Honda", "City");
        TrajectoryPointDto p1 = new TrajectoryPointDto(
                "CAM-01", "Gateway North", 18.52, 73.84, "N",
                Instant.parse("2026-11-01T10:00:00Z"),
                0.95, 0.98, "/evidence/solo.jpg", 1, null, null
        );

        TrajectoryResponseDto responseDto = new TrajectoryResponseDto(
                vehicle, List.of(p1), null, 0.0, 0,
                "NO_RELIABLE_TRAJECTORY_FOUND: only one camera detection available."
        );

        when(trajectoryEngine.reconstructAsDto(plate)).thenReturn(responseDto);

        mockMvc.perform(get("/api/vehicles/" + plate + "/trajectory"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.vehicle.plate").value(plate))
                .andExpect(jsonPath("$.points.length()").value(1))
                .andExpect(jsonPath("$.warning").value("NO_RELIABLE_TRAJECTORY_FOUND: only one camera detection available."));
    }
}

