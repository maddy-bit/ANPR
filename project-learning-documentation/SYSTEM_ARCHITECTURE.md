# System Architecture & Technical Flow Blueprint

**Project:** City-Wide Multi-Camera Vehicle Intelligence Platform (SIH26127 — BEL)  
**Document Version:** 1.0.0  
**Architectural Style:** Distributed Hybrid Event-Driven Multi-Tier Microservices

---

## 1. System Decomposition & Tier Responsibilities

The platform is partitioned into five specialized architectural layers to ensure separation of concerns, high throughput, and independent scalability.

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                SYSTEM ARCHITECTURE OVERVIEW                             │
└─────────────────────────────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ 1. PRESENTATION TIER (Next.js 16 + React 19 + TypeScript + MapLibre GL JS)          │
  │    - Tactical Investigation HUD         - Interactive WebGL MapLibre GIS Map        │
  │    - Chronological Detection Timeline   - Forensic Evidence Snapshot Viewer         │
  │    - Real-Time Live WebSocket Client    - City-Wide Traffic Analytics Dashboard     │
  └──────────────────────────────────────────┬──────────────────────────────────────────┘
                                             │ HTTP REST / WebSocket (Port 3000 -> 8080)
                                             ▼
  ┌─────────────────────────────────────────────────────────────────────────────────────┐
  │ 2. APPLICATION TIER (Java 21 / Spring Boot 3.3.4 Application Server)                │
  │    - System of Record & Auth Controller - 5-Factor Heuristic Trajectory Engine      │
  │    - Ingestion Pipeline Coordinator     - Live Replay WebSocket Scheduled Handler   │
  │    - Redis Sliding-Window Rate Limiter  - Audit Logging Service                     │
  └───────────────────────┬───────────────────────────────┬─────────────────────────────┘
                          │                               │
            SQL / JDBC    │                               │ Internal REST Proxy
            (Port 5432)   │                               │ (Port 8080 -> 8000)
                          ▼                               ▼
  ┌───────────────────────────────┐     ┌───────────────────────────────────────────────┐
  │ 3. PERSISTENCE TIER           │     │ 4. INTELLIGENCE TIER (Python 3.11+ / FastAPI) │
  │    - PostgreSQL 16 + PostGIS  │     │    - Dark Channel Prior (DCP) Dehazer         │
  │    - ST_DWithin Radius Search │     │    - YOLOv8s Vehicle Detector (COCO 2,3,5,7)  │
  │    - KNN (<->) Spatial Sort   │     │    - ByteTrack Multi-Object Tracker (MOT)     │
  │    - GiST Spatial Indexing    │     │    - YOLOv8n / Haar Cascade Plate Detector    │
  │    - H2 In-Memory Dev Profile │     │    - EasyOCR Engine + Character Confusion Map │
  └───────────────────────────────┘     │    - ResNet50 2144-dim Appearance Re-ID       │
                                        │    - Multi-Frame Character Positional Voting  │
                                        │    - Spatial Markov Trajectory Predictor      │
                                        └───────────────────────┬───────────────────────┘
                                                                │
                                        Redis Pub/Sub & Caching │
                                        (Port 6379)             │
                                                                ▼
                                        ┌───────────────────────────────────────────────┐
                                        │ 5. CACHING & EVENT TIER (Redis 7)             │
                                        │    - Sliding-Window Rate Limiting Keys        │
                                        │    - Trajectory & Vehicle Query Caching       │
                                        │    - Pub/Sub Channel (cityai:detections)      │
                                        │    - Asynchronous Video Job Status Storage    │
                                        └───────────────────────────────────────────────┘
```

---

## 2. End-to-End Architectural Workflows & Sequence Diagrams

### A. Video Ingestion & AI Processing Sequence Diagram
This workflow traces how a video file recorded by a junction CCTV camera is transformed into stored, scored, and cached vehicle detection records.

```
Camera CCTV Video (CAM-01.mp4)
      │
      ▼
scripts/process_video.py
      │
      ▼
VideoPipeline.process()
      │
      ├──▶ 1. Frame Extraction (cv2.VideoCapture, frame_stride=5)
      ├──▶ 2. Adverse Weather Dehazing (ImageDehazer.dehaze() via DCP)
      ├──▶ 3. Vehicle Detection (YOLOv8s.predict(), COCO classes: car, bus, truck, moto)
      ├──▶ 4. Multi-Object Tracking (ByteTrack MOT assigns persistent track_id)
      ├──▶ 5. Plate Localization (PlateDetector.detect() on vehicle crop)
      ├──▶ 6. Text Extraction (EasyOCR.readtext() on enhanced CLAHE crop)
      ├──▶ 7. Plate Normalization (regex canonicalization: "MH 12 AB 1234" -> "MH12AB1234")
      └──▶ 8. Evidence Preservation (saves snapshot frame to data/evidence/CAM-01/...)
      │
      ▼
HTTP POST /api/detections/ingest (HTTP Basic Auth: ingest / change-me-in-production)
      │
      ▼
DetectionController (Spring Boot 8080)
      │
      ▼
DetectionIngestionService
      ├──▶ Resolve or create Vehicle entity lazily via MockVehicleRegistryService
      ├──▶ Save VehicleDetection row into PostgreSQL / H2 database
      ├──▶ Invalidate cached entries ("vehicles", "trajectories") in RedisCacheManager
      └──▶ Publish real-time detection DTO to Redis channel "cityai:detections"
```

---

### B. Trajectory Reconstruction & Scoring Engine Sequence Diagram
When an investigator searches for a vehicle registration number in the dashboard, the backend performs multi-criteria heuristic trajectory reconstruction.

```
Investigator Dashboard (Next.js)
      │
      ▼
GET /api/vehicles/{plate}/trajectory
      │
      ▼
TrajectoryEngine.reconstructAsDto(normalizedPlate)
      │
      ├──▶ 1. Check Redis Cache ("trajectories::{plate}") -> Cache Hit returns instantly
      │
      └──▶ 2. Cache Miss -> Execute TrajectoryEngine.reconstruct()
            │
            ├──▶ Fetch all detections for plate from VehicleDetectionRepository
            │    ORDER BY timestamp ASC
            │
            ├──▶ groupIntoVisits(): Collapse consecutive per-frame detections into 
            │    discrete camera visits (firstSeen, lastSeen, max OCR confidence)
            │
            ├──▶ TrajectoryScoringService.score() for each consecutive transition:
            │    - Great-Circle Haversine distance between cameras
            │    - Implied transit speed: v = distance / elapsed_time
            │    - Heuristic Score calculation:
            │        Score = 0.30·Plate + 0.25·Kinematic + 0.15·Geographic 
            │              + 0.15·Direction + 0.15·Appearance
            │    - Kinematic Plausibility check:
            │        If speed > 150 km/h: Cap confidence at 0.15 and attach warning note
            │
            └──▶ Compute overallConfidence = average(transition_confidences)
      │
      ▼
AuditLogService.logSearch() -> Persists search query, user, timestamp, client IP
      │
      ▼
JSON TrajectoryResponseDto returned to Next.js Frontend
      │
      ├──▶ InvestigationMap: Renders GeoJSON LineString and status markers
      ├──▶ DetectionTimeline: Renders step-by-step camera visit cards with time gaps
      └──▶ EvidenceViewer: Fetches and displays actual camera snapshot frames
```

---

### C. Live Tracking WebSocket Simulation Sequence Diagram
Simulates real-time cross-camera tracking over WebSocket without requiring real RTSP feeds.

```
Operator selects "Live" or "Historical + Live" Mode
      │
      ▼
liveClient.ts opens WebSocket connection: ws://localhost:8080/ws/live/MH12AB1234
      │
      ▼
LiveTrackingWebSocketHandler.afterConnectionEstablished()
      │
      ├──▶ TrajectoryEngine reconstructs vehicle route into N waypoints
      ├──▶ Send immediate handshake: {"type": "connected", "totalEvents": 4}
      │
      └──▶ ScheduledExecutorService schedules N future tasks:
            │
            ├──▶ At t = 3s:  Send detection event 0 (CAM-01 arrival)
            ├──▶ At t = 6s:  Send detection event 1 (CAM-03 arrival)
            ├──▶ At t = 9s:  Send detection event 2 (CAM-07 arrival)
            ├──▶ At t = 12s: Send detection event 3 (CAM-11 arrival)
            └──▶ At t = 12s: Send complete event {"type": "complete", "confidence": 0.89}
      │
      ▼
Frontend liveClient receives frames progressively:
      ├──▶ Updates pulsing "LIVE" badge on HUD
      ├──▶ Draws trajectory segments on MapLibre map step-by-step
      └──▶ Auto-advances active selection index in timeline and evidence viewer
```

---

### D. PostGIS Spatial Nearest-Neighbor Query Sequence Diagram
Under the `postgres` profile, the backend leverages PostGIS to perform spatial proximity queries.

```
Operator searches nearby cameras: GET /api/cameras/nearby?lat=18.5308&lon=73.8474&radiusKm=3
      │
      ▼
CameraController -> SpatialCameraService.findNearby()
      │
      ▼
Executes Parameterized PostGIS SQL:
SELECT id, name, latitude, longitude, direction, status
FROM cameras
WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(73.8474, 18.5308), 4326)::geography, 3000)
ORDER BY location <-> ST_SetSRID(ST_MakePoint(73.8474, 18.5308), 4326)::geography;
      │
      ├──▶ ST_DWithin: Filters cameras inside 3000-meter radius using GiST index
      └──▶ <-> Operator: Performs K-Nearest Neighbor (KNN) sorting by true spherical distance
      │
      ▼
Returns sorted List<CameraDto> to client (nearest junction first)
(Note: On default H2 profile, endpoint returns HTTP 501 Not Implemented explaining Postgres requirement)
```

---

### E. Redis Sliding-Window Rate Limiting Sequence Diagram
Enforces a 300 requests/minute per IP rate limit to prevent denial-of-service on sensitive search and ingestion endpoints.

```
Client sends request: GET /api/vehicles/MH12AB1234
      │
      ▼
RedisRateLimiterFilter.doFilterInternal()
      │
      ├──▶ 1. Resolve Client IP (inspects X-Forwarded-For header, fallback to remoteAddr)
      ├──▶ 2. Compute current minute bucket: minute = epochSeconds / 60
      ├──▶ 3. Generate key: "ratelimit:" + clientIp + ":" + minute
      │
      ├──▶ 4. Atomic Increment via Redis: count = stringRedisTemplate.opsForValue().increment(key)
      ├──▶ 5. If count == 1: Set TTL to 65 seconds (stringRedisTemplate.expire(key, 65s))
      │
      ├──▶ 6. Attach rate limit response headers:
      │       X-RateLimit-Limit: 300
      │       X-RateLimit-Remaining: max(0, 300 - count)
      │
      ├──▶ 7. Check Threshold:
      │       ├── If count <= 300: filterChain.doFilter() (Pass request to Controller)
      │       └── If count > 300: Return HTTP 429 Too Many Requests
      │                           Retry-After: 60
      │                           {"error": "Too Many Requests", "message": "Rate limit exceeded"}
      │
      └──▶ 8. Exception Resilience:
              If Redis server is unreachable, catch exception, log debug message, 
              and gracefully FAIL-OPEN so user traffic is never blocked.
```
