package com.cityai.backend.security;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ProductionSecurityValidatorTest {

    private static final String VALID_PROD_PASSWORD = "SuperSecureProdPassword123!";

    @Test
    void dev_MissingBoth_ShouldPassWithDefaults() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("dev");
        Map<String, String> osEnv = Map.of();

        var config = ProductionSecurityValidator.validate(env, osEnv::get);

        assertThat(config.isProduction()).isFalse();
        assertThat(config.ingestPassword()).isEqualTo(ProductionSecurityValidator.DEFAULT_DEV_PASSWORD);
        assertThat(config.allowedOrigins()).containsExactly("http://localhost:3000");
    }

    @Test
    void prod_MissingPassword_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of("CORS_ALLOWED_ORIGINS", "https://trusted.domain.com");

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("INGEST_PASSWORD is missing or blank");
    }

    @Test
    void prod_MissingCors_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of("INGEST_PASSWORD", VALID_PROD_PASSWORD);

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("CORS_ALLOWED_ORIGINS is missing or blank");
    }

    @Test
    void prod_DefaultPassword_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", ProductionSecurityValidator.DEFAULT_DEV_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://trusted.domain.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("INGEST_PASSWORD must not use default or insecure values");
    }

    @Test
    void prod_WildcardCors_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "*"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain wildcard");
    }

    @Test
    void prod_WildcardSubdomain_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://*.example.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain wildcard");
    }

    @Test
    void prod_EmptyCorsEntry_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://valid.com, , https://valid2.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contains empty entries");
    }

    @Test
    void prod_CorsTrailingComma_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com,"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contains empty entries");
    }

    @Test
    void prod_CorsLeadingComma_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", ",https://example.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contains empty entries");
    }

    @Test
    void prod_CorsConsecutiveCommas_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com,,https://example.org"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("contains empty entries");
    }

    @Test
    void prod_BareHttpScheme_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "http://"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageMatching("(?s).*SECURITY FAILURE.*");
    }

    @Test
    void prod_BareHttpsScheme_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageMatching("(?s).*SECURITY FAILURE.*");
    }

    @Test
    void prod_MissingHost_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https:///"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageMatching("(?s).*SECURITY FAILURE.*");
    }

    @Test
    void prod_OriginWithPath_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com/api"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain a path component");
    }

    @Test
    void prod_OriginWithQuery_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com?x=1"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain a query string");
    }

    @Test
    void prod_OriginWithFragment_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com#section"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain a fragment");
    }

    @Test
    void prod_OriginWithUserInfo_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://user@example.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must not contain user information");
    }

    @Test
    void prod_OriginWithInvalidScheme_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "ftp://example.com"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("must use an explicit http or https scheme");
    }

    @Test
    void prod_OriginWithInvalidPort_ShouldFail() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com:99999"
        );

        assertThatThrownBy(() -> ProductionSecurityValidator.validate(env, osEnv::get))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageMatching("(?s).*SECURITY FAILURE.*");
    }

    @Test
    void prod_ValidLocalhostWithPort_ShouldPass() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "http://localhost:3000"
        );

        var config = ProductionSecurityValidator.validate(env, osEnv::get);

        assertThat(config.isProduction()).isTrue();
        assertThat(config.allowedOrigins()).containsExactly("http://localhost:3000");
    }

    @Test
    void prod_ValidHttpsWithPort_ShouldPass() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://example.com:8443"
        );

        var config = ProductionSecurityValidator.validate(env, osEnv::get);

        assertThat(config.isProduction()).isTrue();
        assertThat(config.allowedOrigins()).containsExactly("https://example.com:8443");
    }

    @Test
    void prod_MultipleValidOrigins_ShouldNormalizeAndPass() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("prod");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://traffic.cityai.gov.in, https://portal.cityai.gov.in:8443"
        );

        var config = ProductionSecurityValidator.validate(env, osEnv::get);

        assertThat(config.isProduction()).isTrue();
        assertThat(config.allowedOrigins()).containsExactly(
                "https://traffic.cityai.gov.in",
                "https://portal.cityai.gov.in:8443"
        );
    }

    @Test
    void production_ProfileAlias_ShouldPass() {
        MockEnvironment env = new MockEnvironment();
        env.setActiveProfiles("production");
        Map<String, String> osEnv = Map.of(
                "INGEST_PASSWORD", VALID_PROD_PASSWORD,
                "CORS_ALLOWED_ORIGINS", "https://traffic.cityai.gov.in"
        );

        var config = ProductionSecurityValidator.validate(env, osEnv::get);

        assertThat(config.isProduction()).isTrue();
        assertThat(config.allowedOrigins()).containsExactly("https://traffic.cityai.gov.in");
    }
}
