"""
Chapter 11: Testing Strategy, Production Troubleshooting Handbook, and Security Audit.
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-testing">
  <div class="section-header-tag">CHAPTER 21</div>
  <h2 class="section-title">Testing Strategy &amp; Automated Smoke Test Suite</h2>

  <p>The testing architecture verifies both individual algorithmic building blocks (unit tests) and end-to-end multi-service communications (integration smoke tests).</p>

  <h3>1. Unit Tests Suite (<code>backend/src/test/java/...</code>)</h3>
  <ul>
    <li><code>GeoUtilsTest.java</code>: Verifies the Haversine spherical distance function against known GPS benchmarks (e.g., Pune to Mumbai coordinate distance) and asserts that compass bearings to true South equal $180.0^\circ$.</li>
    <li><code>TrajectoryScoringServiceTest.java</code>: Tests kinematic speed calculations. Asserts that an urban transition at $45\text{ km/h}$ receives a $1.0$ kinematic score, while an implied speed of $220\text{ km/h}$ triggers the <code>physicallyImplausible</code> boolean flag, caps transition confidence at $\le 0.15$, and attaches an explanatory warning note.</li>
    <li><code>PlateNormalizerTest.java</code>: Verifies that spaces, hyphens, and mixed casing (<code>"mh 12-ab 1234"</code>) canonicalize to <code>"MH12AB1234"</code>.</li>
  </ul>

  <h3>2. Automated Smoke Test Script (<code>scripts/smoke_test.sh</code>)</h3>
  <p>A 17-point integration test suite validating a live running backend:</p>
  <div class="table-container">
    <table>
      <thead>
        <tr><th>Check #</th><th>Endpoint &amp; Method</th><th>Expected Status</th><th>Verification Objective</th></tr>
      </thead>
      <tbody>
        <tr><td>1</td><td><code>GET /api/health</code></td><td>200 OK</td><td>Backend liveness and Redis connectivity</td></tr>
        <tr><td>2</td><td><code>GET /api/cameras</code></td><td>200 OK</td><td>Retrieval of seeded camera network (12 cameras)</td></tr>
        <tr><td>3</td><td><code>GET /api/cameras/CAM-01</code></td><td>200 OK</td><td>Individual camera detail resolution</td></tr>
        <tr><td>4</td><td><code>GET /api/cameras/CAM-99</code></td><td>404 Not Found</td><td>Proper 404 error response on invalid camera ID</td></tr>
        <tr><td>5</td><td><code>GET /api/vehicles/MH12AB1234</code></td><td>200 OK</td><td>Vehicle summary retrieval for known plate</td></tr>
        <tr><td>6</td><td><code>GET /api/vehicles/MH12AB1234/detections</code></td><td>200 OK</td><td>Chronological observation event feed</td></tr>
        <tr><td>7</td><td><code>GET /api/vehicles/MH12AB1234/trajectory</code></td><td>200 OK</td><td>Reconstructed multi-camera route and confidence</td></tr>
        <tr><td>8</td><td><code>GET /api/vehicles/mh%2012%20ab%201234</code></td><td>200 OK</td><td>Case &amp; space normalization tolerance</td></tr>
        <tr><td>9</td><td><code>GET /api/vehicles/ZZ99ZZ9999</code></td><td>404 Not Found</td><td>Clean 404 response on unknown vehicle lookup</td></tr>
        <tr><td>10</td><td><code>GET /api/analytics/overview</code></td><td>200 OK</td><td>City-wide traffic aggregations and top routes</td></tr>
        <tr><td>11</td><td><code>POST /api/detections/ingest</code></td><td>401 Unauthorized</td><td>HTTP Basic auth gating on write endpoints</td></tr>
        <tr><td>12</td><td><code>GET /api/audit/recent</code></td><td>401 Unauthorized</td><td>HTTP Basic auth gating on sensitive audit logs</td></tr>
        <tr><td>13</td><td><code>GET /api/audit/recent?limit=1</code></td><td>200 OK</td><td>Authenticated audit log query (ingest:change-me)</td></tr>
        <tr><td>14</td><td><code>GET /api/cameras/nearby</code></td><td>200 OK / 501</td><td>Profile check (200 on postgres, 501 on default H2)</td></tr>
      </tbody>
    </table>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-troubleshooting">
  <div class="section-header-tag">CHAPTER 22</div>
  <h2 class="section-title">Production Troubleshooting Handbook &amp; Failure Diagnostics</h2>

  <div class="trouble-item">
    <div class="trouble-title">Symptom 1: Frontend Status Bar Displays "SYSTEM OFFLINE"</div>
    <p><strong>Root Cause:</strong> Spring Boot backend is not running on port 8080, or CORS origin mismatch.</p>
    <p><strong>Diagnostic Step:</strong> Run <code>curl -i http://localhost:8080/api/health</code>. Inspect terminal where backend was launched.</p>
    <p><strong>Verified Fix:</strong> Ensure backend is running via <code>mvn spring-boot:run</code>. Confirm <code>CORS_ALLOWED_ORIGINS</code> in <code>application.yml</code> includes <code>http://localhost:3000</code>.</p>
  </div>

  <div class="trouble-item">
    <div class="trouble-title">Symptom 2: Nearby Cameras Endpoint Returns HTTP 501 Not Implemented</div>
    <p><strong>Root Cause:</strong> Backend is running on the default H2 profile. H2 lacks spatial <code>ST_DWithin</code> and <code>&lt;-&gt;</code> operators.</p>
    <p><strong>Diagnostic Step:</strong> Inspect Spring Boot startup banner for <code>The following profiles are active: default</code>.</p>
    <p><strong>Verified Fix:</strong> Start backend with PostgreSQL active: <code>SPRING_PROFILES_ACTIVE=postgres mvn spring-boot:run</code>.</p>
  </div>

  <div class="trouble-item">
    <div class="trouble-title">Symptom 3: Redis Rate Limiter Returns HTTP 429 Too Many Requests</div>
    <p><strong>Root Cause:</strong> Client IP sent more than 300 requests in a 60-second window.</p>
    <p><strong>Diagnostic Step:</strong> Inspect response headers: <code>X-RateLimit-Limit</code>, <code>X-RateLimit-Remaining: 0</code>, <code>Retry-After: 60</code>.</p>
    <p><strong>Verified Fix:</strong> Wait 60 seconds for the minute bucket to expire, or raise <code>RATE_LIMIT_RPM=1000</code> in <code>application.yml</code>.</p>
  </div>

  <div class="trouble-item">
    <div class="trouble-title">Symptom 4: Video Processing Fails with EasyOCR / PyTorch CUDA OOM</div>
    <p><strong>Root Cause:</strong> Attempting to run large deep learning batches on GPU with insufficient VRAM (&lt;4 GB).</p>
    <p><strong>Diagnostic Step:</strong> Run <code>nvidia-smi</code> to check VRAM utilization.</p>
    <p><strong>Verified Fix:</strong> Set <code>use_gpu: bool = False</code> in <code>ai-service/config.py</code>. The codebase runs smoothly on standard CPU.</p>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-security">
  <div class="section-header-tag">CHAPTER 23</div>
  <h2 class="section-title">Security, Performance &amp; Code Quality Audit</h2>

  <h3>1. Security Posture Assessment</h3>
  <ul>
    <li><strong>Write Endpoint Authentication (Verified):</strong> <code>POST /api/detections/ingest</code> and <code>GET /api/audit/**</code> are protected by Spring Security HTTP Basic auth using <code>DelegatingPasswordEncoder</code>. Detections cannot be injected anonymously.</li>
    <li><strong>Open Read Endpoint Scope (Honestly Labeled Prototype Gap):</strong> <code>GET /api/vehicles/**</code> and <code>GET /api/cameras/**</code> are deliberately open so the Next.js investigation UI functions without an intrusive login barrier. In enterprise production, a JWT/OAuth2 session layer must gate read queries.</li>
    <li><strong>SQL Injection Immunity:</strong> All database queries use Hibernate JPA parameterized bindings (<code>findByPlate</code>) or Spring's <code>JdbcTemplate</code> with positional <code>?</code> placeholders (in <code>SpatialCameraService.java</code>). No raw SQL string concatenation exists in the codebase.</li>
  </ul>

  <h3>2. Performance &amp; Resource Safeguards</h3>
  <ul>
    <li><strong>Frame Striding:</strong> Processing every frame of a 30 FPS video would overwhelm CPU inference. Setting <code>frame_stride: 5</code> processes 6 FPS, reducing compute load by 80% while comfortably tracking vehicles moving at city speeds.</li>
    <li><strong>PyTorch Inference Mode:</strong> All neural forward passes execute under <code>with torch.no_grad():</code>, preventing autograd graph retention and eliminating memory leaks.</li>
    <li><strong>Redis Cache Invalidation:</strong> Trajectory results are cached for 10 minutes (<code>@Cacheable("trajectories")</code>). When <code>DetectionIngestionService</code> stores new evidence for a plate, it calls <code>cacheManager.getCache("trajectories").evict(plate)</code>, guaranteeing operators never view stale routes.</li>
  </ul>
</div>
"""
