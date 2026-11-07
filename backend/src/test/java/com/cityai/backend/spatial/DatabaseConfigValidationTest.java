package com.cityai.backend.spatial;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.io.InputStream;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.yaml.snakeyaml.Yaml;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Verifies application.yml defaults and ensures connection failures against
 * unreachable PostgreSQL instances produce fast, explicit failures rather
 * than silent fallbacks.
 */
class DatabaseConfigValidationTest {

    @Test
    @SuppressWarnings("unchecked")
    void applicationYaml_HasPostgresAsDefaultAndDdlAutoValidate() {
        Yaml yaml = new Yaml();
        InputStream in = getClass().getResourceAsStream("/application.yml");
        assertThat(in).as("application.yml must exist").isNotNull();

        Map<String, Object> data = yaml.load(in);
        Map<String, Object> spring = (Map<String, Object>) data.get("spring");
        assertThat(spring).isNotNull();

        // 1. Datasource points to PostgreSQL by default
        Map<String, Object> datasource = (Map<String, Object>) spring.get("datasource");
        assertThat(datasource).isNotNull();
        String url = (String) datasource.get("url");
        String driver = (String) datasource.get("driver-class-name");
        assertThat(url).contains("jdbc:postgresql://");
        assertThat(driver).contains("org.postgresql.Driver");

        // 2. Hibernate ddl-auto is 'validate'
        Map<String, Object> jpa = (Map<String, Object>) spring.get("jpa");
        assertThat(jpa).isNotNull();
        Map<String, Object> hibernate = (Map<String, Object>) jpa.get("hibernate");
        assertThat(hibernate.get("ddl-auto")).isEqualTo("validate");

        // 3. Flyway is enabled
        Map<String, Object> flyway = (Map<String, Object>) spring.get("flyway");
        assertThat(flyway).isNotNull();
        assertThat(flyway.get("enabled")).isEqualTo(true);

        // 4. H2 console is disabled
        Map<String, Object> h2 = (Map<String, Object>) spring.get("h2");
        assertThat(h2).isNotNull();
        Map<String, Object> console = (Map<String, Object>) h2.get("console");
        assertThat(console.get("enabled")).isEqualTo(false);
    }

    @Test
    void unreachableDatabase_ProducesExplicitStartupFailureWithoutSilentFallback() {
        // Configure HikariCP with an unreachable host and tight timeout
        HikariConfig config = new HikariConfig();
        config.setJdbcUrl("jdbc:postgresql://127.0.0.1:59999/nonexistent_db");
        config.setUsername("invalid_user");
        config.setPassword("invalid_pass");
        config.setConnectionTimeout(1000); // 1 second
        config.setInitializationFailTimeout(1000);

        assertThatThrownBy(() -> {
            try (HikariDataSource ds = new HikariDataSource(config)) {
                ds.getConnection();
            }
        })
        .isInstanceOf(Exception.class)
        .hasMessageFindingMatch("(?i)(Connection refused|timeout|failed|unable to acquire|refused)");
    }
}

