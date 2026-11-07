package com.cityai.backend.spatial;

import com.cityai.backend.dto.CameraDto;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@SuppressWarnings("null")
class SpatialCameraQueryTest {

    private JdbcTemplate jdbcTemplate;
    private SpatialCameraService service;

    @BeforeEach
    void setUp() {
        jdbcTemplate = Mockito.mock(JdbcTemplate.class);
        service = new SpatialCameraService(jdbcTemplate);
    }

    @Test
    @SuppressWarnings("unchecked")
    void findNearby_ExecutesCorrectPostGisSpatialSqlAndParams() {
        double lat = 18.5204;
        double lon = 73.8567;
        double radiusKm = 5.0;
        double expectedRadiusMeters = 5000.0;

        CameraDto mockCam = new CameraDto("CAM-01", "Shivaji Nagar", lat, lon, "N", "CONFIGURED");
        when(jdbcTemplate.query(any(String.class), any(RowMapper.class), any(Object[].class)))
                .thenReturn(List.of(mockCam));

        List<CameraDto> result = service.findNearby(lat, lon, radiusKm);

        assertThat(result).hasSize(1);
        assertThat(result.get(0).id()).isEqualTo("CAM-01");

        ArgumentCaptor<String> sqlCaptor = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Object[]> paramsCaptor = ArgumentCaptor.forClass(Object[].class);

        verify(jdbcTemplate).query(sqlCaptor.capture(), any(RowMapper.class), paramsCaptor.capture());

        String sql = sqlCaptor.getValue();
        // Verifies ST_DWithin on location geography
        assertThat(sql).containsIgnoringCase("ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)");
        // Verifies KNN distance ordering using PostGIS <-> operator
        assertThat(sql).containsIgnoringCase("ORDER BY location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography");

        Object[] params = paramsCaptor.getAllValues().get(0);
        // Params order: longitude, latitude, radiusMeters, longitude, latitude
        assertThat(params).containsExactly(lon, lat, expectedRadiusMeters, lon, lat);
    }

    @Test
    @SuppressWarnings("unchecked")
    void findNearby_MapsResultSetFieldsCorrectly() throws SQLException {
        ResultSet rs = Mockito.mock(ResultSet.class);
        when(rs.getString("id")).thenReturn("CAM-07");
        when(rs.getString("name")).thenReturn("FC Road Junction");
        when(rs.getDouble("latitude")).thenReturn(18.5190);
        when(rs.getDouble("longitude")).thenReturn(73.8420);
        when(rs.getString("direction")).thenReturn("SW");
        when(rs.getString("status")).thenReturn("CONFIGURED");

        ArgumentCaptor<RowMapper<CameraDto>> mapperCaptor = ArgumentCaptor.forClass(RowMapper.class);
        when(jdbcTemplate.query(any(String.class), mapperCaptor.capture(), any(Object[].class)))
                .thenReturn(List.of());

        service.findNearby(18.5190, 73.8420, 2.0);

        RowMapper<CameraDto> rowMapper = mapperCaptor.getValue();
        CameraDto mapped = Objects.requireNonNull(rowMapper.mapRow(rs, 1));

        assertThat(mapped.id()).isEqualTo("CAM-07");
        assertThat(mapped.name()).isEqualTo("FC Road Junction");
        assertThat(mapped.latitude()).isEqualTo(18.5190);
        assertThat(mapped.longitude()).isEqualTo(73.8420);
        assertThat(mapped.direction()).isEqualTo("SW");
        assertThat(mapped.status()).isEqualTo("CONFIGURED");
    }
}
