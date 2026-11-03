"""
Chapter 10: Step-by-Step Project Reconstruction Roadmap (Milestones 1 through 14).
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-reconstruction">
  <div class="section-header-tag">CHAPTER 20</div>
  <h2 class="section-title">Rebuild the Entire Project From Zero (Milestones 1 to 14)</h2>

  <p>This implementation roadmap enables you to reconstruct the entire platform from an empty directory in the exact dependency order required by the architecture. Do not skip milestones.</p>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 01</span>
      <span class="milestone-title">Monorepo Scaffolding &amp; Shared Datasets</span>
      <span class="milestone-diff">Difficulty: Easy &bull; Time: 30m</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Terminal CLI navigation, Git, JSON syntax.</p>
    <p><strong>Commands to Execute:</strong></p>
    <pre><code class="language-bash">mkdir cityai-project &amp;&amp; cd cityai-project
git init
mkdir -p data/evidence scripts videos
mkdir -p ai-service/ai ai-service/services ai-service/utils ai-service/models
mkdir -p backend/src/main/java/com/cityai/backend backend/src/main/resources backend/src/test/java
mkdir -p frontend/src/app frontend/src/components frontend/src/lib frontend/public
</code></pre>
    <p><strong>Files to Create:</strong> <code>data/cameras.json</code> (12 Pune junction cameras), <code>data/vehicles.json</code> (mock registry), <code>docker-compose.yml</code>.</p>
    <p><strong>Verification:</strong> Run <code>python -m json.tool data/cameras.json</code> to verify valid JSON formatting.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 02</span>
      <span class="milestone-title">FastAPI Python Microservice Skeleton</span>
      <span class="milestone-diff">Difficulty: Easy &bull; Time: 45m</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Python 3.11, virtual environments, FastAPI basics, Pydantic V2.</p>
    <p><strong>Commands to Execute:</strong></p>
    <pre><code class="language-bash">cd ai-service
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install fastapi uvicorn pydantic redis
</code></pre>
    <p><strong>Files to Create:</strong> <code>ai-service/config.py</code>, <code>ai-service/schemas.py</code>, <code>ai-service/main.py</code> (implement <code>/health</code>).</p>
    <p><strong>Verification:</strong> Start FastAPI with <code>uvicorn main:app --port 8000</code> and execute <code>curl http://localhost:8000/health</code>.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 03</span>
      <span class="milestone-title">Computer Vision Pipeline (Dehaze, Detect, Track, OCR)</span>
      <span class="milestone-diff">Difficulty: Hard &bull; Time: 3h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> PyTorch, OpenCV, Dark Channel Prior theory, YOLOv8 object detection, ByteTrack MOT.</p>
    <p><strong>Commands to Execute:</strong></p>
    <pre><code class="language-bash">pip install ultralytics opencv-python-headless easyocr lap torch torchvision numpy
</code></pre>
    <p><strong>Files to Create:</strong>
      <code>ai/dehazer.py</code>, <code>ai/vehicle_detector.py</code>, <code>ai/tracker.py</code>, <code>ai/plate_detector.py</code>, <code>ai/ocr.py</code>, <code>utils/plate_normalizer.py</code>, <code>services/video_pipeline.py</code>.
    </p>
    <p><strong>Verification:</strong> Run <code>python -c "from services.video_pipeline import VideoPipeline; p = VideoPipeline(); print('Loaded successfully')"</code>.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 04</span>
      <span class="milestone-title">Visual Re-ID &amp; Multi-Factor Identity Scorer</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Deep convolutional embeddings, ResNet50, Cosine similarity, Levenshtein edit distance.</p>
    <p><strong>Files to Create:</strong> <code>ai/color_classifier.py</code>, <code>ai/reid.py</code>, <code>ai/multi_frame_fusion.py</code>, <code>ai/identity_scorer.py</code>, <code>ai/camera_topology.py</code>.</p>
    <p><strong>Verification:</strong> Compare two observations of the same car using <code>IdentityScorer.score_pair()</code> and verify <code>is_match == True</code>.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 05</span>
      <span class="milestone-title">Journey Reconstruction &amp; Spatial Markov Predictor</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Markov chains, Haversine formula, velocity calculation, anomaly thresholding.</p>
    <p><strong>Files to Create:</strong> <code>ai/journey_reconstructor.py</code>, <code>ai/trajectory_predictor.py</code>, <code>ai/watchlist_manager.py</code>, <code>services/multi_camera_orchestrator.py</code>.</p>
    <p><strong>Verification:</strong> Pass two sightings at CAM-01 and CAM-03 into <code>reconstruct_journey()</code> and verify transit distance and speed are computed.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 06</span>
      <span class="milestone-title">Java Spring Boot 3 Backend Foundations &amp; JPA Model</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Java 21, Maven, Spring Boot 3, Hibernate JPA entities, H2 database.</p>
    <p><strong>Files to Create:</strong> <code>pom.xml</code>, <code>application.yml</code>, <code>BackendApplication.java</code>, <code>model/Vehicle.java</code>, <code>model/Camera.java</code>, <code>model/VehicleDetection.java</code>, <code>model/AuditLogEntry.java</code>, <code>repository/*Repository.java</code>.</p>
    <p><strong>Verification:</strong> Run <code>mvn clean test-compile</code> and ensure zero build errors.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 07</span>
      <span class="milestone-title">Seeding, Registry Abstraction &amp; Protected Ingestion</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Spring <code>CommandLineRunner</code>, Spring Security 6 HTTP Basic auth.</p>
    <p><strong>Files to Create:</strong> <code>service/DataSeedService.java</code>, <code>service/VehicleRegistryService.java</code>, <code>service/MockVehicleRegistryService.java</code>, <code>service/DetectionIngestionService.java</code>, <code>security/SecurityConfig.java</code>, <code>controller/DetectionController.java</code>.</p>
    <p><strong>Verification:</strong> Start Spring Boot (<code>mvn spring-boot:run</code>). Send unauthenticated POST to <code>/api/detections/ingest</code> &rarr; assert HTTP 401. Send authenticated POST &rarr; assert HTTP 201.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 08</span>
      <span class="milestone-title">Trajectory Reconstruction Engine &amp; Kinematic Scorer</span>
      <span class="milestone-diff">Difficulty: Hard &bull; Time: 3h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Great-Circle geometry, forward bearing, heuristic multi-criteria scoring.</p>
    <p><strong>Files to Create:</strong> <code>trajectory/GeoUtils.java</code>, <code>trajectory/CameraGraph.java</code>, <code>trajectory/TrajectoryScoringService.java</code>, <code>trajectory/TrajectoryEngine.java</code>, <code>controller/TrajectoryController.java</code>, <code>src/test/java/...</code>.</p>
    <p><strong>Verification:</strong> Run <code>mvn test</code> to execute <code>GeoUtilsTest</code>, <code>TrajectoryScoringServiceTest</code>, and <code>PlateNormalizerTest</code>. Confirm all tests pass.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 09</span>
      <span class="milestone-title">PostGIS Spatial Database Integration</span>
      <span class="milestone-diff">Difficulty: Hard &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> PostgreSQL 16, PostGIS 3.4, GiST spatial indexing, SRID 4326, Spring profiles.</p>
    <p><strong>Files to Create:</strong> <code>application-postgres.yml</code>, <code>spatial/PostGisMigrationRunner.java</code>, <code>spatial/SpatialCameraService.java</code>, <code>controller/CameraController.java</code> (nearby endpoint).</p>
    <p><strong>Verification:</strong> Start backend with <code>SPRING_PROFILES_ACTIVE=postgres</code>. Query <code>/api/cameras/nearby?lat=18.5308&amp;lon=73.8474&amp;radiusKm=3</code> &rarr; assert HTTP 200 with sorted cameras.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 10</span>
      <span class="milestone-title">Redis Caching, Rate Limiter &amp; Pub/Sub Bus</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Redis 7, Lettuce connection pool, Spring Cache <code>@Cacheable</code>, sliding-window rate limiting.</p>
    <p><strong>Files to Create:</strong> <code>config/RedisConfig.java</code>, <code>security/RedisRateLimiterFilter.java</code>, <code>service/RedisPubSubService.java</code>.</p>
    <p><strong>Verification:</strong> Send 301 rapid requests to <code>/api/vehicles/MH12AB1234</code> &rarr; assert 301st returns HTTP 429 Too Many Requests with header <code>Retry-After: 60</code>.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 11</span>
      <span class="milestone-title">Live Tracking WebSocket Streaming &amp; Audit Logging</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> WebSockets, <code>ScheduledExecutorService</code> thread pools, audit trails.</p>
    <p><strong>Files to Create:</strong> <code>websocket/WebSocketConfig.java</code>, <code>websocket/LiveTrackingWebSocketHandler.java</code>, <code>service/AuditLogService.java</code>, <code>controller/AuditController.java</code>.</p>
    <p><strong>Verification:</strong> Connect to <code>ws://localhost:8080/ws/live/MH12AB1234</code> using a WebSocket client; verify paced reception of detection events every 3 seconds.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 12</span>
      <span class="milestone-title">Next.js 16 Setup, MapLibre GL JS &amp; API Client</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Next.js 16 App Router, React 19, Tailwind CSS v4, MapLibre GL JS, GeoJSON layers.</p>
    <p><strong>Files to Create:</strong> <code>frontend/package.json</code>, <code>src/app/globals.css</code>, <code>src/app/layout.tsx</code>, <code>src/lib/api.ts</code>, <code>src/components/InvestigationMap.tsx</code>.</p>
    <p><strong>Verification:</strong> Run <code>npm run dev</code>, open <code>http://localhost:3000</code>, and confirm map renders camera network nodes.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 13</span>
      <span class="milestone-title">Tactical Investigation HUD, Modals &amp; Live Client</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 3h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> Synchronized component state, Canvas API, WebSocket client.</p>
    <p><strong>Files to Create:</strong> <code>src/components/VehicleSearchPanel.tsx</code>, <code>VehicleIntelligencePanel.tsx</code>, <code>DetectionTimeline.tsx</code>, <code>EvidenceViewer.tsx</code>, <code>VehicleHologram3D.tsx</code>, <code>InvestigationDashboard.tsx</code>, <code>lib/liveClient.ts</code>.</p>
    <p><strong>Verification:</strong> Search for <code>MH12AB1234</code> in Historical mode &rarr; verify map line, timeline, evidence image, and intelligence card populate.</p>
  </div>

  <div class="milestone-card">
    <div class="milestone-header">
      <span class="milestone-badge">MILESTONE 14</span>
      <span class="milestone-title">Analytics Dashboard, Video Ingestion CLI &amp; Smoke Test</span>
      <span class="milestone-diff">Difficulty: Medium &bull; Time: 2h</span>
    </div>
    <p><strong>Learning Prerequisites:</strong> SVG charts, Python CLI scripting, Bash integration testing, Dockerfiles.</p>
    <p><strong>Files to Create:</strong> <code>src/components/AnalyticsDashboard.tsx</code>, <code>scripts/process_video.py</code>, <code>scripts/smoke_test.sh</code>, multi-stage Dockerfiles.</p>
    <p><strong>Verification:</strong> Run <code>./scripts/smoke_test.sh http://localhost:8080</code> &rarr; assert 17/17 checks pass with 0 failures.</p>
  </div>
</div>
"""
