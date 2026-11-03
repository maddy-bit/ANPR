"""
Chapter 7: Detailed Source Code Analysis — Java Spring Boot Backend Modules.
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-backend-core">
  <div class="section-header-tag">CHAPTER 12</div>
  <h2 class="section-title">Detailed Source Code Analysis: Spring Boot Core, Security &amp; Rate Limiter</h2>

  <h3>1. File: <code>backend/.../security/RedisRateLimiterFilter.java</code></h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>backend/src/main/java/com/cityai/backend/security/RedisRateLimiterFilter.java</code><br>
    <strong>Architectural Layer:</strong> Application Tier / Security &amp; Traffic Shaping<br>
    <strong>Lines of Code:</strong> 97 lines &bull; <strong>Annotations:</strong> <code>@Component</code>, <code>@Order(1)</code><br>
    <strong>Dependencies:</strong> <code>org.springframework.data.redis.core.StringRedisTemplate</code>
  </div>

  <h4>Why This Filter Exists</h4>
  <p>To defend backend REST endpoints (specifically <code>/api/vehicles/**</code>, <code>/api/detections/ingest</code>, and <code>/api/ai/**</code>) against credential stuffing, denial-of-service floods, and unauthorized scraping without requiring heavy external gateway infrastructure.</p>

  <h4>Line-by-Line Code Walkthrough</h4>
  <pre><code class="language-java">public class RedisRateLimiterFilter extends OncePerRequestFilter {
    private final StringRedisTemplate stringRedisTemplate;
    private final boolean enabled;
    private final long requestsPerMinute; // Default: 300 req/min

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        if (!enabled || !isRateLimitedPath(request.getRequestURI())) {
            filterChain.doFilter(request, response);
            return;
        }

        String clientIp = resolveClientIp(request);
        long currentMinute = Instant.now().getEpochSecond() / 60;
        String key = "ratelimit:" + clientIp + ":" + currentMinute;

        try {
            Long count = stringRedisTemplate.opsForValue().increment(key);
            if (count != null && count == 1) {
                stringRedisTemplate.expire(key, 65, TimeUnit.SECONDS);
            }

            long currentCount = count != null ? count : 1;
            response.setHeader("X-RateLimit-Limit", String.valueOf(requestsPerMinute));
            response.setHeader("X-RateLimit-Remaining", String.valueOf(Math.max(0, requestsPerMinute - currentCount)));

            if (currentCount > requestsPerMinute) {
                response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value()); // HTTP 429
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                response.setHeader("Retry-After", "60");
                response.getWriter().write(String.format(
                    "{\"error\":\"Too Many Requests\",\"message\":\"Rate limit exceeded (%d req/min).\",\"retryAfterSeconds\":60}",
                    requestsPerMinute
                ));
                return;
            }
        } catch (Exception e) {
            // Fail-open: Redis down must not block legitimate user traffic
            log.debug("Redis rate limiter unavailable, falling through: {}", e.getMessage());
        }

        filterChain.doFilter(request, response);
    }
}
</code></pre>

  <div class="alert-box alert-success">
    <div class="alert-title">Critical Resiliency Design: Fail-Open Strategy</div>
    <p>Notice the <code>catch (Exception e)</code> block (Lines 75–78). If the Redis server crashes or network partitions occur, the rate limiter logs a debug warning and calls <code>filterChain.doFilter(request, response)</code>. In production high-availability systems, it is strictly preferable to temporarily serve traffic without rate limiting than to hard-fail 100% of user traffic because of a cache hiccup.</p>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-backend-trajectory">
  <div class="section-header-tag">CHAPTER 13</div>
  <h2 class="section-title">Detailed Source Code Analysis: Trajectory Engine &amp; Heuristic Scorer</h2>

  <h3>1. File: <code>backend/.../trajectory/TrajectoryScoringService.java</code></h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java</code><br>
    <strong>Architectural Layer:</strong> Application Tier / Trajectory Heuristics<br>
    <strong>Lines of Code:</strong> 138 lines &bull; <strong>Annotations:</strong> <code>@Service</code>
  </div>

  <h4>The 5-Factor Transition Plausibility Scoring Model</h4>
  <p>A naive ANPR tracking system merely connects detections in chronological order. If camera 1 reads <code>MH12AB1234</code> at 18:00, and camera 10 (25 km away) misreads a bus plate as <code>MH12AB1234</code> at 18:01, a naive system displays the vehicle traveling at $1500\text{ km/h}$. <code>TrajectoryScoringService</code> prevents this by computing a multi-criteria plausibility score:</p>

  $$\text{Score} = 0.30 S_{\text{plate}} + 0.25 S_{\text{kinematic}} + 0.15 S_{\text{geographic}} + 0.15 S_{\text{direction}} + 0.15 S_{\text{appearance}}$$

  <h4>Code Implementation &amp; Physical Speed Caps</h4>
  <pre><code class="language-java">public TransitionScore score(
        Camera fromCamera, Instant fromTime, Double fromPlateConfidence,
        Camera toCamera, Instant toTime, Double toPlateConfidence) {

    CameraGraph.Edge edge = cameraGraph.edgeBetween(fromCamera, toCamera);
    double elapsedMinutes = Math.max(0.001, Duration.between(fromTime, toTime).toSeconds() / 60.0);
    double impliedSpeedKmh = edge.distanceKm() / (elapsedMinutes / 60.0);

    double plateScore = averageOrDefault(fromPlateConfidence, toPlateConfidence, 0.5);
    double kinematicScore = kinematicPlausibility(impliedSpeedKmh);
    double geographicScore = hopPlausibility(edge.distanceKm());
    double directionScore = directionAlignment(toCamera, edge.bearingDegrees());
    double appearanceScore = 0.6; // neutral placeholder until Re-ID vectors are persisted

    boolean implausible = impliedSpeedKmh > 150.0; // 150 km/h urban physical cap

    double confidence = 0.30 * plateScore + 0.25 * kinematicScore + 0.15 * geographicScore
                      + 0.15 * directionScore + 0.15 * appearanceScore;

    String note = null;
    if (implausible) {
        confidence = Math.min(confidence, 0.15); // Hard penalty cap
        note = String.format(
            "Implied speed %.0f km/h between %s and %s exceeds physical plausibility - possible OCR misread or cloned plate.",
            impliedSpeedKmh, fromCamera.getId(), toCamera.getId());
    }

    return new TransitionScore(edge.distanceKm(), elapsedMinutes, impliedSpeedKmh,
            plateScore, kinematicScore, geographicScore, directionScore, appearanceScore,
            clamp01(confidence), implausible, note);
}
</code></pre>

  <div class="page-break"></div>

  <h3>2. File: <code>backend/.../trajectory/TrajectoryEngine.java</code> (Visit Aggregator)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>backend/src/main/java/com/cityai/backend/trajectory/TrajectoryEngine.java</code><br>
    <strong>Lines of Code:</strong> 239 lines &bull; <strong>Annotations:</strong> <code>@Service</code>, <code>@Transactional</code>
  </div>

  <h4>Algorithm: groupIntoVisits()</h4>
  <p>When a vehicle passes a 30 FPS camera, the detector logs 15 to 45 individual detection rows over 1 to 2 seconds. Plotting every individual detection would produce 45 redundant map points at the exact same coordinates. <code>groupIntoVisits()</code> collapses consecutive detections from the same camera into a single discrete <code>CameraVisit</code>:</p>

  <pre><code class="language-java">private List<CameraVisit> groupIntoVisits(List<VehicleDetection> detections) {
    List<CameraVisit> visits = new ArrayList<>();
    int i = 0;
    while (i < detections.size()) {
        Camera camera = detections.get(i).getCamera();
        int j = i;
        List<VehicleDetection> group = new ArrayList<>();
        while (j < detections.size() && detections.get(j).getCamera().getId().equals(camera.getId())) {
            group.add(detections.get(j));
            j++;
        }

        Instant firstSeen = group.get(0).getTimestamp();
        Instant lastSeen = group.get(group.size() - 1).getTimestamp();
        
        // Select maximum plate confidence achieved across the visit
        Double bestPlateConfidence = group.stream()
                .map(VehicleDetection::getPlateConfidence)
                .filter(Objects::nonNull)
                .max(Comparator.naturalOrder())
                .orElse(null);

        // Pick snapshot frame corresponding to highest OCR confidence
        String bestImagePath = group.stream()
                .filter(d -> d.getPlateConfidence() != null)
                .max(Comparator.comparingDouble(VehicleDetection::getPlateConfidence))
                .map(VehicleDetection::getImagePath)
                .orElse(group.get(0).getImagePath());

        visits.add(new CameraVisit(camera, firstSeen, lastSeen, bestPlateConfidence,
                bestDetectionConfidence, bestImagePath, group.size()));
        i = j;
    }
    return visits;
}
</code></pre>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-backend-spatial">
  <div class="section-header-tag">CHAPTER 14</div>
  <h2 class="section-title">Detailed Source Code Analysis: PostGIS Spatial Queries &amp; WebSockets</h2>

  <h3>1. File: <code>backend/.../spatial/SpatialCameraService.java</code> (ST_DWithin &amp; KNN)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>backend/src/main/java/com/cityai/backend/spatial/SpatialCameraService.java</code><br>
    <strong>Annotations:</strong> <code>@Service</code>, <code>@Profile("postgres")</code><br>
    <strong>Lines of Code:</strong> 48 lines &bull; <strong>Dependencies:</strong> <code>org.springframework.jdbc.core.JdbcTemplate</code>
  </div>

  <h4>Real PostGIS SQL Execution</h4>
  <p>Under the <code>postgres</code> profile, <code>SpatialCameraService</code> executes a genuine PostGIS spatial query:</p>
  <pre><code class="language-sql">SELECT id, name, latitude, longitude, direction, status
FROM cameras
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
ORDER BY location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography;
</code></pre>

  <h4>Detailed Query Breakdown</h4>
  <ul>
    <li><code>ST_MakePoint(lon, lat)</code>: Creates a 2D geometric point in WGS 84 coordinate space. Note the crucial GIS convention: Longitude ($X$) must precede Latitude ($Y$).</li>
    <li><code>ST_SetSRID(..., 4326)</code>: Assigns Spatial Reference ID 4326 (standard GPS coordinates).</li>
    <li><code>::geography</code>: Casts geometry to the spherical <code>geography</code> type. This enables distance measurements in true SI meters over the curvature of the Earth rather than planar degrees.</li>
    <li><code>ST_DWithin(location, point, radiusMeters)</code>: Performs index-assisted bounding-box filtering using the table's GiST spatial index.</li>
    <li><code>ORDER BY location &lt;-&gt; point</code>: Utilizes PostGIS's K-Nearest Neighbor (KNN) distance operator, traversing the GiST R-Tree to return nearest cameras first with $O(\log N)$ performance.</li>
  </ul>

  <h3>2. File: <code>backend/.../websocket/LiveTrackingWebSocketHandler.java</code></h3>
  <p>Extends Spring's <code>TextWebSocketHandler</code>. When a client connects to <code>/ws/live/{plate}</code>, the handler extracts the plate, reconstructs the vehicle route via <code>TrajectoryEngine</code>, and dispatches detection events every 3 seconds using a <code>ScheduledExecutorService</code> thread pool. When the final waypoint is streamed, it emits a <code>complete</code> payload and terminates the session cleanly.</p>
</div>
"""
