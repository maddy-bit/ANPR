package com.cityai.backend.security;

import jakarta.annotation.PostConstruct;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.Function;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * Dedicated startup validator enforcing strict production security requirements.
 * When the active profile is 'prod' or 'production', mandatory security credentials
 * and network origins MUST be supplied directly via OS environment variables.
 * Values supplied solely via property files or defaults do NOT satisfy production requirements.
 */
@Component
public class ProductionSecurityValidator {

    public static final String DEFAULT_DEV_PASSWORD = "local-dev-ingest-only-not-for-prod";
    public static final String LEGACY_INSECURE_PASSWORD = "change-me-in-production";

    private final Environment environment;

    public ProductionSecurityValidator(Environment environment) {
        this.environment = environment;
    }

    @PostConstruct
    public void validateOnStartup() {
        validate(this.environment, System::getenv);
    }

    /**
     * Validates configuration against active profiles.
     * Takes an environment variable lookup function (System::getenv in production, mock in tests).
     */
    public static ValidatedSecurityConfig validate(Environment env, Function<String, String> envLookup) {
        boolean isProduction = Arrays.stream(env.getActiveProfiles())
                .anyMatch(p -> p.equalsIgnoreCase("prod") || p.equalsIgnoreCase("production"));

        if (!isProduction) {
            // Local development: use defaults if OS environment variables are not supplied
            String devPassword = envLookup.apply("INGEST_PASSWORD");
            if (devPassword == null || devPassword.isBlank()) {
                devPassword = DEFAULT_DEV_PASSWORD;
            }
            String devOrigins = envLookup.apply("CORS_ALLOWED_ORIGINS");
            List<String> originsList;
            if (devOrigins == null || devOrigins.isBlank()) {
                originsList = List.of("http://localhost:3000");
            } else {
                List<String> list = new ArrayList<>();
                for (String origin : devOrigins.split("\\s*,\\s*", -1)) {
                    String trimmed = origin.trim();
                    if (!trimmed.isEmpty()) {
                        list.add(normalizeDevOrigin(trimmed));
                    }
                }
                originsList = List.copyOf(list);
            }
            return new ValidatedSecurityConfig(false, devPassword, originsList);
        }

        // --- Production Validation ---

        // 1. INGEST_PASSWORD must be explicitly provided in OS environment
        String rawPassword = envLookup.apply("INGEST_PASSWORD");
        if (rawPassword == null || rawPassword.trim().isEmpty()) {
            throw new IllegalStateException(
                    "SECURITY FAILURE: Mandatory OS environment variable INGEST_PASSWORD is missing or blank in production profile!");
        }
        String password = rawPassword.trim();
        if (password.equals(DEFAULT_DEV_PASSWORD) || password.equals(LEGACY_INSECURE_PASSWORD)) {
            throw new IllegalStateException(
                    "SECURITY FAILURE: INGEST_PASSWORD must not use default or insecure values in production profile!");
        }

        // 2. CORS_ALLOWED_ORIGINS must be explicitly provided in OS environment
        String rawOrigins = envLookup.apply("CORS_ALLOWED_ORIGINS");
        if (rawOrigins == null || rawOrigins.trim().isEmpty()) {
            throw new IllegalStateException(
                    "SECURITY FAILURE: Mandatory OS environment variable CORS_ALLOWED_ORIGINS is missing or blank in production profile!");
        }

        String[] originTokens = rawOrigins.split("\\s*,\\s*", -1);
        if (originTokens.length == 0) {
            throw new IllegalStateException(
                    "SECURITY FAILURE: CORS_ALLOWED_ORIGINS contains no valid origins in production profile!");
        }

        List<String> validatedOrigins = new ArrayList<>();
        for (String origin : originTokens) {
            String trimmed = origin.trim();
            if (trimmed.isEmpty()) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS contains empty entries in production profile!");
            }
            if (trimmed.contains("*")) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must not contain wildcard characters in production profile!");
            }

            URI uri;
            try {
                uri = new URI(trimmed);
            } catch (URISyntaxException ex) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' is a malformed URI: " + ex.getMessage(), ex);
            }

            String scheme = uri.getScheme();
            if (scheme == null || (!scheme.equalsIgnoreCase("http") && !scheme.equalsIgnoreCase("https"))) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must use an explicit http or https scheme in production profile!");
            }

            String host = uri.getHost();
            if (host == null || host.trim().isEmpty()) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must have a valid non-empty hostname in production profile!");
            }

            if (uri.getUserInfo() != null) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must not contain user information in production profile!");
            }

            String path = uri.getPath();
            if (path != null && !path.isEmpty() && !path.equals("/")) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must not contain a path component in production profile!");
            }

            if (uri.getQuery() != null) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must not contain a query string in production profile!");
            }

            if (uri.getFragment() != null) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' must not contain a fragment in production profile!");
            }

            int port = uri.getPort();
            if (port != -1 && (port < 1 || port > 65535)) {
                throw new IllegalStateException(
                        "SECURITY FAILURE: CORS_ALLOWED_ORIGINS origin '" + trimmed + "' has an invalid port number in production profile!");
            }

            // Normalized origin format: scheme://host or scheme://host:port
            String normalizedOrigin = (port == -1)
                    ? (scheme.toLowerCase() + "://" + host.toLowerCase())
                    : (scheme.toLowerCase() + "://" + host.toLowerCase() + ":" + port);

            validatedOrigins.add(normalizedOrigin);
        }

        return new ValidatedSecurityConfig(true, password, List.copyOf(validatedOrigins));
    }

    private static String normalizeDevOrigin(String origin) {
        try {
            URI uri = new URI(origin);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            int port = uri.getPort();
            if (scheme != null && host != null) {
                return (port == -1)
                        ? (scheme.toLowerCase() + "://" + host.toLowerCase())
                        : (scheme.toLowerCase() + "://" + host.toLowerCase() + ":" + port);
            }
        } catch (URISyntaxException ignored) {
        }
        return origin;
    }

    public record ValidatedSecurityConfig(
            boolean isProduction,
            String ingestPassword,
            List<String> allowedOrigins
    ) {
    }
}
