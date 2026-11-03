"""
Chapter 3: System Architecture, Subsystems Breakdown, and Complete Sequence Diagrams.
"""

def get_content() -> str:
    return """
<div class="page-break"></div>

<div class="content-section" id="ch-architecture">
  <div class="section-header-tag">CHAPTER 04</div>
  <h2 class="section-title">System Architecture &amp; Subsystem Decomposition</h2>

  <p>The platform follows a distributed, multi-tier microservices architecture designed to decouple high-concurrency business transactions and relational state from heavy deep-learning computer vision tensor computation.</p>

  <h3>1. Architectural Principles</h3>
  <ul>
    <li><strong>Language Isolation for Optimal Performance:</strong> Computer vision libraries (PyTorch, Ultralytics, EasyOCR, OpenCV) are Python-native. Conversely, enterprise transaction management, high-concurrency thread pooling, WebSocket connection tracking, and spatial database persistence are best served by the JVM (Java 21 / Spring Boot). Python handles vision; Java owns state and business logic.</li>
    <li><strong>Encapsulated Intelligence Tier:</strong> The Python AI microservice is not exposed directly to the public Internet or the browser. It operates strictly behind the Spring Boot application tier, which acts as a secure API gateway, authenticator, and rate limiter.</li>
    <li><strong>Dual-Profile Spatial Persistence:</strong> To ensure zero-friction local developer onboarding without requiring local PostgreSQL setup, the backend defaults to an in-memory/file-based H2 database. Setting <code>SPRING_PROFILES_ACTIVE=postgres</code> seamlessly activates real PostgreSQL 16 with PostGIS 3.4 spatial indexes and <code>ST_DWithin</code> geographic nearest-neighbor queries.</li>
    <li><strong>Fail-Open Resilient Distributed Caching:</strong> All caching, rate limiting, and Pub/Sub messaging are backed by Redis 7. Crucially, all Redis filters and caches implement fail-open exception handling: if Redis experiences a temporary outage, user requests fall through cleanly to the database rather than crashing.</li>
  </ul>

  <h3>2. High-Level System Architecture Diagram</h3>
  <pre><code class="language-text">┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              HIGH-LEVEL SYSTEM TOPOLOGY                                │
└────────────────────────────────────────────────────────────────────────────────────────┘

  [Web Browser / Law Enforcement Client]
                 │
                 ├──▶ HTTP REST (Port 3000) ────▶ [Next.js 16 Frontend App Router]
                 │                                      │
                 │    WebSocket (Port 8080)             │ Internal API Client (Port 8080)
                 │    ws://.../ws/live/{plate}          ▼
                 └──────────────────────────────▶ [Spring Boot 3.3.4 Application Server]
                                                        │
                         ┌──────────────────────────────┼──────────────────────────────┐
                         │                              │                              │
                         ▼                              ▼                              ▼
                 [PostgreSQL 16]                 [Redis 7 Cache]             [FastAPI AI Engine]
                 - PostGIS 3.4 Spatial           - Sliding-Window Rate Limiter- YOLOv8s / ByteTrack
                 - GiST Spatial Indexing         - Query Cache (10m TTL)      - EasyOCR + Normalizer
                 - ST_DWithin &amp; KNN (&lt;-&gt;)        - Pub/Sub: cityai:detections - ResNet50 Re-ID / DCP
                 (or H2 in dev)                  - Job Status Store           - Spatial Markov Predictor
</code></pre>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-diagrams">
  <div class="section-header-tag">CHAPTER 05</div>
  <h2 class="section-title">Architectural Execution Flow &amp; Sequence Diagrams</h2>

  <h3>1. Video Ingestion &amp; Computer Vision Pipeline Sequence</h3>
  <p>This sequence illustrates how CCTV video files are ingested, enhanced, analyzed, and persisted into the database system of record.</p>

  <pre><code class="language-text">Operator / CLI             VideoPipeline             YOLO &amp; OCR Modules       Spring Boot Backend
     │                           │                            │                        │
     │ 1. Run process_video.py   │                            │                        │
     ├──────────────────────────▶│                            │                        │
     │                           │ 2. Read Frame (stride=5)   │                        │
     │                           ├───────────────────────────▶│                        │
     │                           │ 3. Dark Channel Dehazing   │                        │
     │                           ├───────────────────────────▶│ (ImageDehazer)         │
     │                           │ 4. Detect Vehicles         │                        │
     │                           ├───────────────────────────▶│ (YOLOv8s Classes 2,3,5,7)
     │                           │ 5. Update Object Tracks    │                        │
     │                           ├───────────────────────────▶│ (ByteTrack MOT)        │
     │                           │ 6. Crop Vehicle &amp; Plate    │                        │
     │                           ├───────────────────────────▶│ (PlateDetector)        │
     │                           │ 7. Preprocess &amp; Run OCR    │                        │
     │                           ├───────────────────────────▶│ (EasyOCR + Normalizer) │
     │                           │                            │                        │
     │                           │ 8. Detections Gathered     │                        │
     │                           │◀───────────────────────────┤                        │
     │                           │                            │                        │
     │ 9. Return Detection List  │                            │                        │
     │◀──────────────────────────┤                            │                        │
     │                                                        │                        │
     │ 10. POST /api/detections/ingest (HTTP Basic Auth: ingest / change-me)           │
     ├────────────────────────────────────────────────────────────────────────────────▶│
     │                                                                                 │ 11. Ingest Service
     │                                                                                 │     - Resolve Vehicle
     │                                                                                 │     - Save Detection
     │                                                                                 │     - Evict Redis Cache
     │                                                                                 │     - Publish Pub/Sub
     │ 12. HTTP 201 Created (JSON Response)                                           │
     │◀────────────────────────────────────────────────────────────────────────────────┤
</code></pre>

  <h3>2. Trajectory Reconstruction &amp; Scoring Engine Flow</h3>
  <p>Traces the multi-criteria heuristic scoring flow executed when an investigator searches for a vehicle plate.</p>

  <pre><code class="language-text">Frontend Client            TrajectoryController          TrajectoryEngine        TrajectoryScoringService
     │                                │                         │                           │
     │ 1. GET /api/vehicles/{p}/traj  │                         │                           │
     ├───────────────────────────────▶│                         │                           │
     │                                │ 2. Check Redis Cache    │                           │
     │                                │    ("trajectories::{p}")│                           │
     │                                │    (If Hit: Return DTO) │                           │
     │                                │                         │                           │
     │                                │ 3. Cache Miss: Reconstruct                          │
     │                                ├────────────────────────▶│                           │
     │                                │                         │ 4. Fetch Detections       │
     │                                │                         │    (ORDER BY time ASC)    │
     │                                │                         │                           │
     │                                │                         │ 5. groupIntoVisits()      │
     │                                │                         │    Collapse consecutive   │
     │                                │                         │    rows by camera ID      │
     │                                │                         │                           │
     │                                │                         │ 6. Score Transitions      │
     │                                │                         ├──────────────────────────▶│
     │                                │                         │                           │ 7. Calculate:
     │                                │                         │                           │    - Haversine Dist
     │                                │                         │                           │    - Implied Speed
     │                                │                         │                           │    - 5-Factor Score
     │                                │                         │                           │    - Kinematic Cap
     │                                │                         │ 8. Return TransitionScore │
     │                                │                         │◀──────────────────────────┤
     │                                │                         │                           │
     │                                │                         │ 9. Compute Overall Conf   │
     │                                │ 10. TrajectoryResponseDto                           │
     │                                │◀────────────────────────┤                           │
     │                                │                                                     │
     │                                │ 11. Log Search in AuditLogService                   │
     │ 12. HTTP 200 OK (Full Route DTO)                                                     │
     │◀───────────────────────────────┤                                                     │
</code></pre>

  <h3>3. Real-Time WebSocket Streaming Lifecycle</h3>
  <p>Illustrates the chronological pacing simulation delivering detection events every 3 seconds to active frontend clients.</p>

  <pre><code class="language-text">Frontend liveClient.ts                    LiveTrackingWebSocketHandler           ScheduledExecutorService
          │                                            │                                     │
          │ 1. Open ws://localhost:8080/ws/live/MH12...│                                     │
          ├───────────────────────────────────────────▶│                                     │
          │                                            │ 2. Reconstruct Trajectory DTO       │
          │ 3. {"type": "connected", "totalEvents": 4} │                                     │
          │◀───────────────────────────────────────────┤                                     │
          │                                            │ 4. Schedule Tasks (delay = i * 3s)  │
          │                                            ├────────────────────────────────────▶│
          │                                            │                                     │
          │                                            │ 5. Trigger Task 0 (t = 3s)          │
          │ 6. {"type": "detection", "index": 0, ...}  │◀────────────────────────────────────┤
          │◀───────────────────────────────────────────┤                                     │
          │                                            │ 7. Trigger Task 1 (t = 6s)          │
          │ 8. {"type": "detection", "index": 1, ...}  │◀────────────────────────────────────┤
          │◀───────────────────────────────────────────┤                                     │
          │                                            │ 8. Trigger Task 2 (t = 9s)          │
          │ 9. {"type": "detection", "index": 2, ...}  │◀────────────────────────────────────┤
          │◀───────────────────────────────────────────┤                                     │
          │                                            │ 9. Trigger Final Task 3 (t = 12s)   │
          │ 10. {"type": "detection", "index": 3, ...} │◀────────────────────────────────────┤
          │◀───────────────────────────────────────────┤                                     │
          │ 11. {"type": "complete", "overallConf":...}│                                     │
          │◀───────────────────────────────────────────┤                                     │
          │ 12. Close WebSocket Connection (NORMAL)    │                                     │
          │◀───────────────────────────────────────────┤                                     │
</code></pre>
</div>
"""
