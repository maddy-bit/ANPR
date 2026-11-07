package com.cityai.backend.service;

import java.util.Optional;
import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Service;

/**
 * Production vehicle registry service.
 * In production runtime without external VAHAN API integration configured in the backend,
 * this service honestly returns empty rather than fabricating mock vehicle registration records.
 */
@Service
@Primary
public class DefaultVehicleRegistryService implements VehicleRegistryService {

    @Override
    public Optional<VehicleRegistryRecord> lookup(String normalizedPlate) {
        // Honest runtime state: no external government registry is configured in backend
        return Optional.empty();
    }
}

