package com.cityai.backend.config;

import com.cityai.backend.security.ProductionSecurityValidator;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * CORS configuration for REST endpoints.
 * Uses ProductionSecurityValidator to enforce strict non-wildcard origins in production.
 */
@Configuration
public class CorsConfig implements WebMvcConfigurer {

    private final String[] allowedOrigins;

    public CorsConfig(org.springframework.core.env.Environment env) {
        var config = ProductionSecurityValidator.validate(env, System::getenv);
        this.allowedOrigins = config.allowedOrigins().toArray(String[]::new);
    }

    @Override
    public void addCorsMappings(@org.springframework.lang.NonNull CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOrigins(java.util.Objects.requireNonNull(allowedOrigins))
                .allowedMethods("GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true);
    }
}
