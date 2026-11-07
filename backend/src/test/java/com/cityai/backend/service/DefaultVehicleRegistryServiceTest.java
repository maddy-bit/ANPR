package com.cityai.backend.service;

import java.util.Optional;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DefaultVehicleRegistryServiceTest {

    private final DefaultVehicleRegistryService service = new DefaultVehicleRegistryService();

    @Test
    void lookup_AlwaysReturnsEmptyWithoutFabrication() {
        Optional<VehicleRegistryRecord> r1 = service.lookup("MH12AB1234");
        Optional<VehicleRegistryRecord> r2 = service.lookup("ET3633P");
        Optional<VehicleRegistryRecord> r3 = service.lookup(null);
        Optional<VehicleRegistryRecord> r4 = service.lookup("");

        assertThat(r1).isEmpty();
        assertThat(r2).isEmpty();
        assertThat(r3).isEmpty();
        assertThat(r4).isEmpty();
    }
}

