package com.cityai.backend.service;

import java.io.File;
import java.io.FileWriter;
import java.io.IOException;
import java.nio.file.Path;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import static org.assertj.core.api.Assertions.assertThat;

class VehicleRegistryServiceTest {

    @Test
    void lookup_UnknownPlate_ReturnsEmptyWithoutSyntheticFallback(@TempDir Path tempDir) throws IOException {
        File jsonFile = tempDir.resolve("vehicles.json").toFile();
        try (FileWriter writer = new FileWriter(jsonFile)) {
            writer.write("[]");
        }

        MockVehicleRegistryService service = new MockVehicleRegistryService(tempDir.toString());
        service.load();

        // Must return empty for unseeded plates rather than generating synthetic vehicles
        Optional<VehicleRegistryRecord> r1 = service.lookup("MH12AB1234");
        Optional<VehicleRegistryRecord> r2 = service.lookup("KA01CD5678");
        Optional<VehicleRegistryRecord> r3 = service.lookup("XYZ9999");

        assertThat(r1).isEmpty();
        assertThat(r2).isEmpty();
        assertThat(r3).isEmpty();
    }

    @Test
    void lookup_NullOrBlankPlate_ReturnsEmpty(@TempDir Path tempDir) {
        MockVehicleRegistryService service = new MockVehicleRegistryService(tempDir.toString());

        assertThat(service.lookup(null)).isEmpty();
        assertThat(service.lookup("")).isEmpty();
        assertThat(service.lookup("   ")).isEmpty();
    }

    @Test
    void lookup_SeededPlate_ReturnsRecordAndIsCaseInsensitive(@TempDir Path tempDir) throws IOException {
        File jsonFile = tempDir.resolve("vehicles.json").toFile();
        try (FileWriter writer = new FileWriter(jsonFile)) {
            writer.write("""
                [
                  { "plate": "DL01AB1111", "vehicleType": "Sedan", "make": "Tata", "model": "Tigor", "color": "White" }
                ]
                """);
        }

        MockVehicleRegistryService service = new MockVehicleRegistryService(tempDir.toString());
        service.load();

        Optional<VehicleRegistryRecord> upper = service.lookup("DL01AB1111");
        Optional<VehicleRegistryRecord> lower = service.lookup("dl01ab1111");

        assertThat(upper).isPresent();
        assertThat(upper.get().plate()).isEqualTo("DL01AB1111");
        assertThat(upper.get().make()).isEqualTo("Tata");
        assertThat(upper.get().model()).isEqualTo("Tigor");
        assertThat(upper.get().color()).isEqualTo("White");
        assertThat(upper.get().vehicleType()).isEqualTo("Sedan");

        assertThat(lower).isPresent();
        assertThat(lower.get().plate()).isEqualTo("DL01AB1111");
    }

    @Test
    void load_MissingFile_HandlesGracefullyAndLeavesRegistryEmpty(@TempDir Path tempDir) {
        MockVehicleRegistryService service = new MockVehicleRegistryService(tempDir.resolve("non_existent").toString());
        service.load();

        assertThat(service.lookup("MH12AB1234")).isEmpty();
    }
}

