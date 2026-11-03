package com.cityai.backend.security;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Security configuration for the City AI backend.
 * Protects detection ingestion and audit log access with HTTP Basic auth.
 * Uses ProductionSecurityValidator to enforce strict OS environment credentials in production.
 */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    private final ProductionSecurityValidator.ValidatedSecurityConfig validatedConfig;

    public SecurityConfig(org.springframework.core.env.Environment env) {
        this.validatedConfig = ProductionSecurityValidator.validate(env, System::getenv);
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        return PasswordEncoderFactories.createDelegatingPasswordEncoder();
    }

    @Bean
    public UserDetailsService userDetailsService(
            PasswordEncoder passwordEncoder,
            @Value("${ingest.username:ingest}") String username) {

        var user = User.withUsername(username)
                .password(passwordEncoder.encode(validatedConfig.ingestPassword()))
                .roles("INGEST")
                .build();
        return new InMemoryUserDetailsManager(user);
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        http
                .csrf(csrf -> csrf.disable()) // stateless JSON API, no cookies/sessions involved
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(org.springframework.http.HttpMethod.POST, "/api/detections/**").authenticated()
                        .requestMatchers("/api/audit/**").authenticated()
                        .anyRequest().permitAll())
                .httpBasic(basic -> {});
        return http.build();
    }
}
