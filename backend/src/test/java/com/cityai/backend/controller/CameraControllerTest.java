package com.cityai.backend.controller;

import com.cityai.backend.dto.CameraDto;
import com.cityai.backend.model.Camera;
import com.cityai.backend.repository.CameraRepository;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;


@SuppressWarnings("null")
class CameraControllerTest {

    private CameraRepository cameraRepository;
    private ObjectProvider<com.cityai.backend.spatial.SpatialCameraService> spatialCameraService;
    private CameraController controller;
    private MockMvc mockMvc;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        cameraRepository = Mockito.mock(CameraRepository.class);
        spatialCameraService = Mockito.mock(ObjectProvider.class);
        controller = new CameraController(cameraRepository, spatialCameraService);
        mockMvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new ApiExceptionHandler())
                .build();
    }

    @Test
    void listCameras_WhenDatabaseEmpty_ReturnsEmptyListWithoutFallback() {
        when(cameraRepository.findAll()).thenReturn(List.of());

        List<CameraDto> cameras = controller.listCameras();

        // Must honestly return empty list, never fabricated Pune demo cameras
        assertThat(cameras).isEmpty();
    }

    @Test
    void listCameras_WithConfiguredCameras_ReturnsConfiguredStatus() {
        Camera cam1 = new Camera("CAM-01", "Gateway North", 18.52, 73.84, "N", "CONFIGURED", null);
        when(cameraRepository.findAll()).thenReturn(List.of(cam1));

        List<CameraDto> cameras = controller.listCameras();

        assertThat(cameras).hasSize(1);
        assertThat(cameras.get(0).id()).isEqualTo("CAM-01");
        assertThat(cameras.get(0).status()).isEqualTo("CONFIGURED");
        // Must not be falsely marked ONLINE
        assertThat(cameras.get(0).status()).isNotEqualTo("ONLINE");
    }

    @Test
    void registerCamera_ValidInput_SavesWithConfiguredStatus() {
        CameraDto input = new CameraDto("CAM-99", "Toll Plaza", 18.60, 73.70, "E", null);
        Camera saved = new Camera("CAM-99", "Toll Plaza", 18.60, 73.70, "E", "CONFIGURED", null);

        when(cameraRepository.save(any(Camera.class))).thenReturn(saved);

        ResponseEntity<CameraDto> response = controller.registerCamera(input);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        CameraDto body = Objects.requireNonNull(response.getBody());
        assertThat(body.id()).isEqualTo("CAM-99");
        assertThat(body.status()).isEqualTo("CONFIGURED");
    }

    @Test
    void getCamera_UnknownCamera_ThrowsNoSuchElementException() {
        when(cameraRepository.findById("UNKNOWN")).thenReturn(Optional.empty());

        assertThatThrownBy(() -> controller.getCamera("UNKNOWN"))
                .isInstanceOf(NoSuchElementException.class)
                .hasMessageContaining("Unknown camera: UNKNOWN");
    }

    @Test
    void getCamera_WhenUnknown_ReturnsHttp404NotFoundAndNot500() throws Exception {
        when(cameraRepository.findById("CAM-NONEXISTENT")).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/cameras/CAM-NONEXISTENT"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("NOT_FOUND"))
                .andExpect(jsonPath("$.message").value("Unknown camera: CAM-NONEXISTENT"));
    }
}
