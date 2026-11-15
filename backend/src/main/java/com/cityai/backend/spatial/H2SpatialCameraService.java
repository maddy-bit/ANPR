package com.cityai.backend.spatial;

import com.cityai.backend.dto.CameraDto;
import com.cityai.backend.repository.CameraRepository;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.util.Comparator;
import java.util.List;

/**
 * In-memory spatial camera lookup using Haversine formula for testing under the "h2" profile.
 * Does not require PostGIS extensions or database functions.
 */
@Service
@Profile("h2")
public class H2SpatialCameraService extends SpatialCameraService {

    private final CameraRepository cameraRepository;

    public H2SpatialCameraService(
            org.springframework.beans.factory.ObjectProvider<JdbcTemplate> jdbcTemplateProvider,
            CameraRepository cameraRepository) {
        super(jdbcTemplateProvider.getIfAvailable());
        this.cameraRepository = cameraRepository;
    }

    @Override
    public List<CameraDto> findNearby(double latitude, double longitude, double radiusKm) {
        return cameraRepository.findAll().stream()
                .map(cam -> new Object() {
                    final CameraDto dto = CameraDto.from(cam);
                    final double distance = haversineKm(latitude, longitude, cam.getLatitude(), cam.getLongitude());
                })
                .filter(item -> item.distance <= radiusKm)
                .sorted(Comparator.comparingDouble(item -> item.distance))
                .map(item -> item.dto)
                .toList();
    }

    private static double haversineKm(double lat1, double lon1, double lat2, double lon2) {
        final double R = 6371.0088; // Earth mean radius in kilometers
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);
        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return R * c;
    }
}
