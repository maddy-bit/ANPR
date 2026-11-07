package com.cityai.backend.service;

import com.cityai.backend.model.Camera;
import com.cityai.backend.repository.CameraRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.File;
import java.io.IOException;
import java.util.Arrays;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Camera initialization service.
 * Automatic seeding of synthetic demo cameras is disabled by default (app.seed-cameras=false).
 * Demo camera seeding is strictly forbidden in production profiles (prod, production).
 * When enabled for local test fixtures, camera records are registered with CONFIGURED status
 * rather than falsely indicating an ONLINE live stream.
 */
@Component
public class DataSeedService implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(DataSeedService.class);

    private final CameraRepository cameraRepository;
    private final String dataDir;
    private final boolean seedCameras;
    private final Environment environment;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public DataSeedService(
            CameraRepository cameraRepository,
            @Value("${app.data-dir}") String dataDir,
            @Value("${app.seed-cameras:false}") boolean seedCameras,
            Environment environment) {
        this.cameraRepository = cameraRepository;
        this.dataDir = dataDir;
        this.seedCameras = seedCameras;
        this.environment = environment;
    }

    @Override
    public void run(String... args) throws IOException {
        boolean isProduction = Arrays.stream(environment.getActiveProfiles())
                .anyMatch(p -> p.equalsIgnoreCase("prod") || p.equalsIgnoreCase("production"));

        if (isProduction) {
            if (seedCameras) {
                log.warn("Synthetic camera demo seeding is strictly forbidden in production environment. Skipping camera seed.");
            }
            return;
        }

        if (!seedCameras) {
            log.info("Automatic camera seeding is disabled (app.seed-cameras=false). Operating with configured database cameras.");
            return;
        }

        if (cameraRepository.count() > 0) {
            log.info("Cameras already present ({} rows) - skipping seed to preserve genuine records.", cameraRepository.count());
            return;
        }

        File file = new File(dataDir, "cameras.json");
        if (!file.exists()) {
            log.warn("Camera seed file not found at {} - no cameras loaded.", file.getAbsolutePath());
            return;
        }

        List<CameraRecord> records = objectMapper.readValue(
                file, objectMapper.getTypeFactory().constructCollectionType(List.class, CameraRecord.class));

        for (CameraRecord record : records) {
            // A registered camera must not automatically be labelled ONLINE
            String initialStatus = "CONFIGURED";
            cameraRepository.save(new Camera(
                    record.id(), record.name(), record.latitude(), record.longitude(),
                    record.direction(), initialStatus, record.videoSource()));
        }
        log.info("Registered {} configured cameras from {}", records.size(), file.getAbsolutePath());
    }
}
