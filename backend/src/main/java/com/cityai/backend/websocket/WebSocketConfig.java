package com.cityai.backend.websocket;

import com.cityai.backend.security.ProductionSecurityValidator;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/**
 * WebSocket configuration for live tracking channel.
 * Uses ProductionSecurityValidator to enforce strict non-wildcard origins in production.
 */
@Configuration
@EnableWebSocket
public class WebSocketConfig implements WebSocketConfigurer {

    private final LiveTrackingWebSocketHandler liveTrackingWebSocketHandler;
    private final String[] allowedOrigins;

    public WebSocketConfig(
            LiveTrackingWebSocketHandler liveTrackingWebSocketHandler,
            org.springframework.core.env.Environment env) {
        this.liveTrackingWebSocketHandler = liveTrackingWebSocketHandler;

        // Reuses common production validator to enforce strict OS environment origins
        var config = ProductionSecurityValidator.validate(env, System::getenv);
        this.allowedOrigins = config.allowedOrigins().toArray(String[]::new);
    }

    @Override
    public void registerWebSocketHandlers(@org.springframework.lang.NonNull WebSocketHandlerRegistry registry) {
        if (liveTrackingWebSocketHandler != null) {
            registry.addHandler(liveTrackingWebSocketHandler, "/ws/live/{plate}")
                    .setAllowedOrigins(java.util.Objects.requireNonNull(allowedOrigins));
        }
    }
}
