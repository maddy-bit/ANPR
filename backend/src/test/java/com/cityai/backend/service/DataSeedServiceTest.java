package com.cityai.backend.service;

import com.cityai.backend.model.Camera;
import com.cityai.backend.repository.CameraRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.core.env.Environment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("null")
class DataSeedServiceTest {

    private CameraRepository cameraRepository;
    private Environment environment;

    @BeforeEach
    void setUp() {
        cameraRepository = Mockito.mock(CameraRepository.class);
        environment = Mockito.mock(Environment.class);
    }

    @Test
    void run_WhenSeedCamerasDisabledByDefault_DoesNotSeed(@TempDir Path tempDir) throws IOException {
        when(environment.getActiveProfiles()).thenReturn(new String[] { "default" });
        DataSeedService service = new DataSeedService(cameraRepository, tempDir.toString(), false, environment);

        service.run();

        verify(cameraRepository, never()).save(any());
        verify(cameraRepository, never()).count();
    }

    @Test
    void run_WhenProductionProfileActive_StrictlyForbidsSyntheticCameraSeed(@TempDir Path tempDir) throws IOException {
        when(environment.getActiveProfiles()).thenReturn(new String[] { "prod" });
        // Even if seedCameras=true is passed via property/env
        DataSeedService service = new DataSeedService(cameraRepository, tempDir.toString(), true, environment);

        service.run();

        verify(cameraRepository, never()).save(any());
        verify(cameraRepository, never()).count();
    }

    @Test
    void run_WhenProductionAliasActive_StrictlyForbidsSyntheticCameraSeed(@TempDir Path tempDir) throws IOException {
        when(environment.getActiveProfiles()).thenReturn(new String[] { "production" });
        DataSeedService service = new DataSeedService(cameraRepository, tempDir.toString(), true, environment);

        service.run();

        verify(cameraRepository, never()).save(any());
        verify(cameraRepository, never()).count();
    }

    @Test
    void run_WhenCamerasAlreadyExist_PreservesExistingWithoutReseeding(@TempDir Path tempDir) throws IOException {
        when(environment.getActiveProfiles()).thenReturn(new String[] { "dev" });
        when(cameraRepository.count()).thenReturn(5L);

        DataSeedService service = new DataSeedService(cameraRepository, tempDir.toString(), true, environment);

        service.run();

        verify(cameraRepository, never()).save(any());
    }

    @Test
    void run_WhenOptedInInDev_RegistersCamerasWithConfiguredStatus(@TempDir Path tempDir) throws IOException {
        when(environment.getActiveProfiles()).thenReturn(new String[] { "dev" });
        when(cameraRepository.count()).thenReturn(0L);

        String json = """
                [
                  {
                    "id": "CAM-01",
                    "name": "North Gate",
                    "latitude": 18.52,
                    "longitude": 73.84,
                    "direction": "N",
                    "status": "ONLINE",
                    "videoSource": "CAM-01.mp4"
                  }
                ]
                """;
        Files.writeString(tempDir.resolve("cameras.json"), json);

        DataSeedService service = new DataSeedService(cameraRepository, tempDir.toString(), true, environment);

        service.run();

        ArgumentCaptor<Camera> captor = ArgumentCaptor.forClass(Camera.class);
        verify(cameraRepository).save(captor.capture());

        Camera saved = captor.getValue();
        assertThat(saved.getId()).isEqualTo("CAM-01");
        // Status must be CONFIGURED, never falsely reported as ONLINE live stream
        assertThat(saved.getStatus()).isEqualTo("CONFIGURED");
        assertThat(saved.getStatus()).isNotEqualTo("ONLINE");
    }
}
