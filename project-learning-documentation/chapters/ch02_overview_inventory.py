"""
Chapter 2: Project Overview, Feature Inventory, Directory Tree, and Complete File Catalog.
"""

def get_content() -> str:
    return """
<div class="page-break"></div>

<div class="content-section" id="ch-overview">
  <div class="section-header-tag">CHAPTER 02</div>
  <h2 class="section-title">Project Overview &amp; Feature Inventory</h2>

  <p>The <strong>City AI Multi-Camera ANPR Trajectory Tracking &amp; Urban Traffic Intelligence Platform</strong> was engineered to solve <strong>Bharat Electronics Limited (BEL)</strong> Problem Statement <strong>SIH26127</strong> for the Smart India Hackathon.</p>

  <h3>1. The Operational Problem</h3>
  <p>Modern smart cities deploy hundreds of high-definition CCTV cameras across arterial intersections, expressways, and municipal junctions. However, law enforcement and municipal traffic management authorities face severe operational bottlenecks:</p>
  <ul>
    <li><strong>Siloed Video Feeds:</strong> Footage from individual cameras is rarely correlated in real time. Investigators must manually review terabytes of asynchronous video across dozens of junctions to trace a suspect vehicle's path.</li>
    <li><strong>Atmospheric &amp; Environmental Degradation:</strong> Heavy haze, fog, rain, headlight glare, and dust severely reduce visibility, rendering traditional Optical Character Recognition (OCR) engines completely ineffective.</li>
    <li><strong>Plate Misreads, Cloning &amp; Obscuration:</strong> License plates may be covered in dirt, physically damaged, or cloned onto a decoy vehicle. Relying solely on exact license plate strings leads to broken trajectories or false arrests.</li>
    <li><strong>Physical Impossibility &amp; Ghost Sightings:</strong> Naive systems that connect detection timestamps without kinematic validation trust erroneous plate reads, displaying vehicles "teleporting" 15 kilometers across a city in 30 seconds.</li>
  </ul>

  <h3>2. The Platform's Core Capabilities &amp; Verified Features</h3>
  <p>The platform addresses these challenges through a unified multi-tier microservice architecture:</p>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th style="width: 25%;">Platform Feature</th>
          <th style="width: 35%;">Implementation Approach</th>
          <th style="width: 40%;">Primary Codebase Modules</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>Adverse Weather Dehazing</strong></td>
          <td>Dark Channel Prior (DCP) atmospheric scattering model + adaptive CLAHE contrast sharpening.</td>
          <td><code>ai-service/ai/dehazer.py</code><br><code>ai-service/ai/plate_preprocessor.py</code></td>
        </tr>
        <tr>
          <td><strong>Vehicle Detection &amp; MOT</strong></td>
          <td>YOLOv8s object detection (classes: car, motorcycle, bus, truck) + ByteTrack multi-object tracking.</td>
          <td><code>ai-service/ai/vehicle_detector.py</code><br><code>ai-service/ai/tracker.py</code></td>
        </tr>
        <tr>
          <td><strong>Plate Localization &amp; OCR</strong></td>
          <td>OpenCV Haar Cascade / YOLOv8n-LP bounding box detection + EasyOCR text extraction with character confusion mapping.</td>
          <td><code>ai-service/ai/plate_detector.py</code><br><code>ai-service/ai/ocr.py</code></td>
        </tr>
        <tr>
          <td><strong>Plate Normalization</strong></td>
          <td>Strict regex canonicalization stripping spaces, hyphens, and converting to uppercase standard format.</td>
          <td><code>ai-service/utils/plate_normalizer.py</code><br><code>backend/.../util/PlateNormalizer.java</code></td>
        </tr>
        <tr>
          <td><strong>Deep Visual Re-ID</strong></td>
          <td>ResNet50 deep convolutional feature embeddings (2048-dim) combined with HSV color histograms (96-dim).</td>
          <td><code>ai-service/ai/reid.py</code><br><code>ai-service/ai/color_classifier.py</code></td>
        </tr>
        <tr>
          <td><strong>Multi-Factor Identity Fusion</strong></td>
          <td>6-factor scoring engine (Plate 40%, Re-ID 30%, Color 12%, Type 10%, Temporal 5%, Topology 3%) with dynamic weight re-allocation.</td>
          <td><code>ai-service/ai/identity_scorer.py</code></td>
        </tr>
        <tr>
          <td><strong>Kinematic Trajectory Engine</strong></td>
          <td>Groups raw frame observations into camera visits; calculates Haversine distance, bearings, and transit speeds; caps physically impossible jumps (&gt;150 km/h).</td>
          <td><code>backend/.../trajectory/TrajectoryEngine.java</code><br><code>backend/.../trajectory/TrajectoryScoringService.java</code></td>
        </tr>
        <tr>
          <td><strong>Production GIS Spatial DB</strong></td>
          <td>PostgreSQL 16 + PostGIS 3.4 with <code>geography(Point, 4326)</code>, GiST indexing, <code>ST_DWithin</code> radius search, and <code>&lt;-&gt;</code> KNN sorting.</td>
          <td><code>backend/.../spatial/PostGisMigrationRunner.java</code><br><code>backend/.../spatial/SpatialCameraService.java</code></td>
        </tr>
        <tr>
          <td><strong>Distributed Caching &amp; Rate Limiter</strong></td>
          <td>Redis 7 sliding-window rate limiter (300 req/min per IP, fail-open) + Spring Cache (10m TTL) + Redis Pub/Sub event bus.</td>
          <td><code>backend/.../security/RedisRateLimiterFilter.java</code><br><code>backend/.../config/RedisConfig.java</code></td>
        </tr>
        <tr>
          <td><strong>Live Simulation Streaming</strong></td>
          <td>Spring WebSocket endpoint (<code>/ws/live/{plate}</code>) replaying reconstructed journeys chronologically every 3 seconds.</td>
          <td><code>backend/.../websocket/LiveTrackingWebSocketHandler.java</code><br><code>frontend/src/lib/liveClient.ts</code></td>
        </tr>
        <tr>
          <td><strong>Interactive WebGL GIS Map</strong></td>
          <td>MapLibre GL JS rendering CARTO dark basemap tiles, camera node circles, GeoJSON trajectory lines, and animated replay markers.</td>
          <td><code>frontend/src/components/InvestigationMap.tsx</code></td>
        </tr>
        <tr>
          <td><strong>Tactical Investigation HUD</strong></td>
          <td>Vehicle search panel, chronological timeline feed, CCTV evidence snapshot viewer with zoom controls, and 3D hologram cards.</td>
          <td><code>frontend/src/components/InvestigationDashboard.tsx</code><br><code>frontend/src/components/EvidenceViewer.tsx</code></td>
        </tr>
        <tr>
          <td><strong>City Traffic Analytics</strong></td>
          <td>Aggregates junction vehicle counts, hourly traffic histograms, vehicle type modal split, busiest junctions, and top routes.</td>
          <td><code>backend/.../analytics/AnalyticsService.java</code><br><code>frontend/src/components/AnalyticsDashboard.tsx</code></td>
        </tr>
        <tr>
          <td><strong>Security Hotlists &amp; Alarms</strong></td>
          <td>Monitors suspect vehicle watchlists; flags stolen vehicles, cloned duplicate plates, and excessive speed violations in real time.</td>
          <td><code>ai-service/ai/watchlist_manager.py</code><br><code>frontend/src/components/SecurityWatchlistModal.tsx</code></td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-inventory">
  <div class="section-header-tag">CHAPTER 03</div>
  <h2 class="section-title">Complete Project Directory Tree &amp; File Catalog</h2>

  <p>The workspace consists of <strong>143 non-ignored hand-written files and configuration manifests</strong>. Every file is cataloged with its architectural layer, purpose, and dependencies.</p>

  <h3>Directory Tree Structure</h3>
  <pre><code class="language-text">SIH_Project/
├── .github/workflows/ci.yml         # GitHub Actions automated test & compile pipeline
├── docker-compose.yml               # Multi-container orchestration (5 services)
├── package.json / package-lock.json # Root npm workspaces manifest
├── README.md / GETTING_STARTED.md   # System overview & setup guides
├── full_system_documentation.md     # Hackathon technical defense briefing
├── ai-service/                      # Python FastAPI Computer Vision Microservice (Port 8000)
│   ├── main.py                      # REST endpoints & startup lifecycle
│   ├── schemas.py                   # Pydantic data contracts
│   ├── config.py                    # Central threshold dataclasses
│   ├── Dockerfile / requirements.txt# Python 3.11-slim container build
│   ├── ai/                          # Core Computer Vision algorithms
│   │   ├── dehazer.py               # Dark Channel Prior & CLAHE
│   │   ├── vehicle_detector.py      # YOLOv8s vehicle detector
│   │   ├── tracker.py               # ByteTrack MOT algorithm
│   │   ├── plate_detector.py        # License plate bounding box detector
│   │   ├── plate_preprocessor.py    # Plate crop enhancement & binarization
│   │   ├── ocr.py                   # EasyOCR text extraction & regex
│   │   ├── color_classifier.py      # HSV histogram color binning
│   │   ├── reid.py                  # ResNet50 2144-dim feature embeddings
│   │   ├── identity_scorer.py       # 6-factor vehicle identity matcher
│   │   ├── multi_frame_fusion.py    # Multi-frame character positional voting
│   │   ├── camera_topology.py       # Haversine spatial topology graph
│   │   ├── journey_reconstructor.py # Chronological waypoint & anomaly engine
│   │   ├── trajectory_predictor.py  # Spatial Markov next-junction predictor
│   │   ├── watchlist_manager.py     # Security hotlist & alarms
│   │   └── global_vehicle_registry.py# In-memory cross-camera identity registry
│   ├── services/                    # Orchestration & Redis client
│   │   ├── video_pipeline.py        # Single-camera end-to-end runner
│   │   ├── multi_camera_orchestrator.py # Multi-camera concurrent processor
│   │   └── redis_service.py         # Async Redis job tracker
│   └── utils/plate_normalizer.py    # Regex plate string canonicalization
├── backend/                         # Java 21 / Spring Boot 3.3.4 Backend (Port 8080)
│   ├── pom.xml / Dockerfile         # Maven build & Temurin 21 JRE multi-stage image
│   ├── src/main/resources/          # application.yml & application-postgres.yml
│   └── src/main/java/com/cityai/backend/
│       ├── BackendApplication.java  # Main application class (@EnableCaching)
│       ├── analytics/               # Traffic metrics service
│       ├── config/                  # CORS, static evidence handler, Redis cache
│       ├── controller/              # REST controllers (Vehicle, Camera, Ingest, AI Proxy)
│       ├── dto/                     # Strongly-typed Java record DTOs
│       ├── model/                   # JPA Entities (Vehicle, Camera, Detection, Audit)
│       ├── repository/              # Spring Data JPA repositories
│       ├── security/                # Basic Auth & Redis sliding-window rate limiter
│       ├── service/                 # Seeding, Ingestion, Mock Registry, Redis Pub/Sub
│       ├── spatial/                 # PostGIS migration runner & ST_DWithin KNN queries
│       ├── trajectory/              # TrajectoryEngine, Heuristic Scorer & GeoUtils
│       ├── util/PlateNormalizer.java# Java plate normalization utility
│       └── websocket/               # LiveTrackingWebSocketHandler & WS config
├── frontend/                        # Next.js 16 (App Router) + React 19 (Port 3000)
│   ├── package.json / Dockerfile    # npm dependencies & standalone Next.js build
│   ├── src/app/                     # globals.css, layout.tsx, page.tsx, API routes
│   ├── src/components/              # 20 Modular UI Components (Map, HUD, Modals, 3D)
│   └── src/lib/                     # API fetchers, formatters, live WS client, Vahan
├── data/                            # cameras.json (12 cameras) & vehicles.json (mock registry)
└── scripts/                         # process_video.py, generate_demo_footage.py, smoke_test.sh
</code></pre>

  <h3>Key Hand-Written File Inventory Sample (See PROJECT_INVENTORY.md for all 143 files)</h3>
  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>ID</th>
          <th>File Path</th>
          <th>Layer</th>
          <th>Key Responsibility</th>
          <th>Analysis Status</th>
        </tr>
      </thead>
      <tbody>
        <tr><td><strong>FILE-009</strong></td><td><code>ai-service/main.py</code></td><td>AI Microservice</td><td>FastAPI web server exposing video processing, trajectory forecast, analytics</td><td>Verified (342 lines)</td></tr>
        <tr><td><strong>FILE-017</strong></td><td><code>ai-service/ai/dehazer.py</code></td><td>Computer Vision</td><td>Dark Channel Prior (DCP) &amp; CLAHE adverse weather image dehazing</td><td>Verified (95 lines)</td></tr>
        <tr><td><strong>FILE-019</strong></td><td><code>ai-service/ai/identity_scorer.py</code></td><td>AI Scorer</td><td>6-factor multi-modal vehicle identity association engine</td><td>Verified (180 lines)</td></tr>
        <tr><td><strong>FILE-025</strong></td><td><code>ai-service/ai/reid.py</code></td><td>Deep Learning</td><td>ResNet50 2144-dimensional visual appearance feature extractor</td><td>Verified (150 lines)</td></tr>
        <tr><td><strong>FILE-037</strong></td><td><code>backend/pom.xml</code></td><td>Backend Build</td><td>Maven descriptor for Spring Boot 3.3.4, Java 21, JPA, PostGIS, Redis</td><td>Verified (99 lines)</td></tr>
        <tr><td><strong>FILE-072</strong></td><td><code>backend/.../RedisRateLimiterFilter.java</code></td><td>Security</td><td>Sliding-window 300 req/min rate limiter per IP with fail-open resilience</td><td>Verified (97 lines)</td></tr>
        <tr><td><strong>FILE-083</strong></td><td><code>backend/.../SpatialCameraService.java</code></td><td>Spatial GIS</td><td>PostGIS <code>ST_DWithin</code> radius query &amp; <code>&lt;-&gt;</code> KNN distance sorting</td><td>Verified (48 lines)</td></tr>
        <tr><td><strong>FILE-086</strong></td><td><code>backend/.../TrajectoryEngine.java</code></td><td>Trajectory Engine</td><td>Collapses detections into visits and scores camera-to-camera transitions</td><td>Verified (239 lines)</td></tr>
        <tr><td><strong>FILE-089</strong></td><td><code>backend/.../LiveTrackingWebSocketHandler.java</code></td><td>WebSocket</td><td>Streams live detection events chronologically every 3 seconds</td><td>Verified (154 lines)</td></tr>
        <tr><td><strong>FILE-111</strong></td><td><code>frontend/src/components/InvestigationMap.tsx</code></td><td>Frontend GIS</td><td>MapLibre GL JS WebGL map with GeoJSON routes, markers, replay animations</td><td>Verified (450 lines)</td></tr>
        <tr><td><strong>FILE-125</strong></td><td><code>frontend/src/lib/api.ts</code></td><td>API Client</td><td>Fetch wrapper with seed cameras, fallback demo data, error handling</td><td>Verified (705 lines)</td></tr>
        <tr><td><strong>FILE-140</strong></td><td><code>scripts/smoke_test.sh</code></td><td>Testing Tool</td><td>17-point automated bash test suite verifying REST, auth, and PostGIS</td><td>Verified (94 lines)</td></tr>
      </tbody>
    </table>
  </div>
</div>
"""
