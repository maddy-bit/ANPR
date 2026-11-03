package com.cityai.backend.websocket;

import com.cityai.backend.dto.TrajectoryPointDto;
import com.cityai.backend.dto.TrajectoryResponseDto;
import com.cityai.backend.trajectory.TrajectoryEngine;
import com.cityai.backend.util.PlateNormalizer;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Real-time WebSocket handler for GET /ws/live/{plate}.
 * Connects clients to the live tracking channel for a target vehicle plate.
 * Historical trajectories are never replayed as fake live feeds.
 * Operates in standby mode awaiting genuine live camera detection events.
 */
@Component
public class LiveTrackingWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(LiveTrackingWebSocketHandler.class);

    private final TrajectoryEngine trajectoryEngine;
    private final ObjectMapper objectMapper;
    private final Map<String, Set<WebSocketSession>> activePlateSessions = new ConcurrentHashMap<>();

    public LiveTrackingWebSocketHandler(TrajectoryEngine trajectoryEngine, ObjectMapper objectMapper) {
        this.trajectoryEngine = trajectoryEngine;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(@org.springframework.lang.NonNull WebSocketSession session) {
        String plate = extractPlate(session);
        if (plate == null || plate.isBlank()) {
            sendAndClose(session, errorMessage("No plate specified. Connect to /ws/live/{plate}."));
            return;
        }

        String normalized = PlateNormalizer.normalize(plate);
        TrajectoryResponseDto trajectory;
        try {
            trajectory = trajectoryEngine.reconstructAsDto(normalized);
        } catch (NoSuchElementException e) {
            sendAndClose(session, errorMessage("No vehicle found for plate: " + normalized));
            return;
        }

        List<TrajectoryPointDto> points = trajectory.points();
        activePlateSessions.computeIfAbsent(normalized, k -> ConcurrentHashMap.newKeySet()).add(session);

        // Send honest connected standby status
        send(session, connectedMessage(normalized, points.size()));
        log.info("Live tracking session established for plate: {} (Session ID: {})", normalized, session.getId());
    }

    @Override
    public void afterConnectionClosed(@org.springframework.lang.NonNull WebSocketSession session, @org.springframework.lang.NonNull CloseStatus status) {
        String plate = extractPlate(session);
        if (plate != null) {
            String normalized = PlateNormalizer.normalize(plate);
            Set<WebSocketSession> sessions = activePlateSessions.get(normalized);
            if (sessions != null) {
                sessions.remove(session);
                if (sessions.isEmpty()) {
                    activePlateSessions.remove(normalized);
                }
            }
        }
        log.debug("Live tracking session closed: {}", session.getId());
    }

    /**
     * Broadcasts a genuine real-time camera detection event to all connected sessions for this plate.
     */
    public void broadcastLiveDetection(String plate, TrajectoryPointDto point) {
        String normalized = PlateNormalizer.normalize(plate);
        Set<WebSocketSession> sessions = activePlateSessions.get(normalized);
        if (sessions == null || sessions.isEmpty()) return;

        Map<String, Object> message = Map.of(
                "type", "detection",
                "plate", normalized,
                "point", point
        );

        for (WebSocketSession session : sessions) {
            if (session.isOpen()) {
                send(session, message);
            }
        }
    }

    private String extractPlate(WebSocketSession session) {
        java.net.URI uri = session.getUri();
        String path = uri != null ? uri.getPath() : null;
        if (path == null) return null;
        String[] segments = path.split("/");
        return segments.length > 0 ? segments[segments.length - 1] : null;
    }

    private void send(WebSocketSession session, Map<String, Object> message) {
        try {
            session.sendMessage(new TextMessage(java.util.Objects.requireNonNull(objectMapper.writeValueAsString(message))));
        } catch (IOException e) {
            log.debug("Failed to send live tracking message: {}", e.getMessage());
        }
    }

    private void sendAndClose(WebSocketSession session, Map<String, Object> message) {
        send(session, message);
        try {
            session.close(java.util.Objects.requireNonNull(CloseStatus.NORMAL));
        } catch (IOException ignored) {
            // session already closing
        }
    }

    private Map<String, Object> connectedMessage(String plate, int totalHistoricalPoints) {
        return Map.of(
                "type", "connected",
                "plate", plate,
                "status", "LIVE_STREAM_STANDBY",
                "historicalPoints", totalHistoricalPoints,
                "message", "Live camera tracking stream connected. Awaiting real-time detection events."
        );
    }

    private Map<String, Object> errorMessage(String message) {
        return Map.of("type", "error", "message", message);
    }
}
