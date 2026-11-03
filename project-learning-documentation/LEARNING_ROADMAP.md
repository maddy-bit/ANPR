# Complete Learning Syllabus & Independent Reconstruction Roadmap

**Project:** City-Wide Multi-Camera Vehicle Intelligence Platform (SIH26127 — BEL)  
**Document Version:** 1.0.0  
**Target Audience:** Software Engineers, Computer Vision Researchers, Systems Architects

---

## 1. Pedagogical Learning Syllabus (Levels 0 through 7)

This curriculum is derived strictly from the actual codebase of the project. Study these levels sequentially to build the exact theoretical and practical foundation required to rebuild the system from zero.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        CONCEPT DEPENDENCY GRAPH                        │
└────────────────────────────────────────────────────────────────────────┘

 [Level 0: Tooling & CLI]
        │
        ▼
 [Level 1: Language Fundamentals] (Python 3.11, Java 21, TypeScript 5)
        │
        ├───────────────────────────────┬───────────────────────────────┐
        ▼                               ▼                               ▼
 [Level 2A: Computer Vision]    [Level 2B: Spring Boot & JPA]   [Level 2C: Next.js & React 19]
 (PyTorch, YOLO, EasyOCR, DCP)   (Hibernate, Redis, WebSockets)  (MapLibre GL, Tailwind, HUD)
        │                               │                               │
        └───────────────────────┬───────┴───────────────────────────────┘
                                ▼
 [Level 3: Multi-Sensor Fusion & Heuristic Trajectory Scoring]
 (Kinematic Speeds, PostGIS Spatial Queries, Markov Predictions)
                                │
                                ▼
 [Level 4: System Integration, Security & Performance Hardening]
 (Basic Auth, Sliding-Window Redis Rate Limiter, Cache Invalidation)
                                │
                                ▼
 [Level 5: Comprehensive Testing & Benchmarking]
 (JUnit 5, Bash Smoke Tests, Pipeline Evaluation)
                                │
                                ▼
 [Level 6: Multi-Stage Containerization & CI/CD]
 (Docker Compose, Healthchecks, GitHub Actions)
                                │
                                ▼
 [Level 7: Complete Zero-to-Production Reconstruction]
 (Milestones 1 through 14)
```

---

### Level 0 — Absolute Prerequisites

#### 0.1 Terminal, Shell & Package Ecosystems
- **Concepts:** POSIX shell scripting, Bash environment variables, standard streams (`stdin`, `stdout`, `stderr`), exit status codes (`$?`), subshells, pip, npm, Maven.
- **Where Used in Project:** `scripts/smoke_test.sh`, `backend/pom.xml`, `frontend/package.json`, `ai-service/requirements.txt`.
- **Why Required:** The project orchestrates three distinct software runtimes (Python, JVM, Node.js) communicating over local networks.
- **Hands-on Exercise:** Write a bash script that executes `curl` against a local health check endpoint, extracts the HTTP status code using `-w "%{http_code}"`, and asserts that it matches `200`.

#### 0.2 Version Control & Reproducible Environments
- **Concepts:** Git branching, `.gitignore` rules for model checkpoints and binary videos, `.gitattributes` for LF/CRLF normalization, Python virtual environments (`venv`), npm package locks.
- **Where Used:** `.gitignore`, `.gitattributes`, `frontend/package-lock.json`.

---

### Level 1 — Core Language Fundamentals

#### 1.1 Python 3.11+ Modern Idioms
- **Concepts:** Type annotations (`typing.Optional`, `List`, `Dict`, `Tuple`), Dataclasses (`@dataclass`), context managers (`with open(...)`), generators, list comprehensions, asynchronous event loops (`async`/`await`), ThreadPoolExecutor.
- **Project Files:** `ai-service/config.py`, `ai-service/main.py`, `ai-service/services/multi_camera_orchestrator.py`.
- **Practical Example:**
  ```python
  from dataclasses import dataclass, field
  from pathlib import Path

  @dataclass
  class PipelineConfig:
      frame_stride: int = 5
      confidence_threshold: float = 0.35
      model_path: Path = field(default_factory=lambda: Path("models/yolov8s.pt"))
  ```

#### 1.2 Java 21 Modern Language Features
- **Concepts:** Records (`public record CameraVisit(...)`), Pattern Matching for `switch` and `instanceof`, Text Blocks (`"""..."""`), Sealed Interfaces, `java.time.Instant` and `Duration`, Stream API pipelines (`map`, `filter`, `reduce`), `Optional<T>` handling.
- **Project Files:** `backend/.../trajectory/TrajectoryEngine.java`, `backend/.../service/CameraRecord.java`.
- **Practical Example:**
  ```java
  public record CameraVisit(
      Camera camera,
      Instant firstSeen,
      Instant lastSeen,
      Double bestPlateConfidence,
      int detectionCount
  ) {}
  ```

#### 1.3 TypeScript 5 & Modern ES2023+
- **Concepts:** Discriminated unions, type narrowing, generics, `as const` assertions, asynchronous promises (`async`/`await`), nullish coalescing (`??`), optional chaining (`?.`), typed event listeners.
- **Project Files:** `frontend/src/lib/api.ts`, `frontend/src/lib/liveClient.ts`.
- **Practical Example:**
  ```typescript
  export type LiveTrackingEvent =
    | { type: "connected"; plate: string; totalEvents: number }
    | { type: "detection"; index: number; total: number; point: TrajectoryPointDto }
    | { type: "complete"; overallConfidence: number; estimatedDistanceKm: number }
    | { type: "error"; message: string };
  ```

---

### Level 2 — Framework and Library Fundamentals

#### 2.1 Python FastAPI & Pydantic V2
- **Concepts:** REST route decorators (`@app.get`, `@app.post`), Pydantic model serialization, validation, status codes, query parameters, dependency injection, lifespan startup handlers (`@app.on_event("startup")`).
- **Project Files:** `ai-service/main.py`, `ai-service/schemas.py`.

#### 2.2 Spring Boot 3.3.4 & Spring Data JPA
- **Concepts:** Inversion of Control (IoC), Dependency Injection (`@Service`, `@Component`, `@RestController`), JPA Entity lifecycle (`@Entity`, `@Table`, `@Id`), Repository interfaces (`JpaRepository`), Hibernate `@Transactional` boundary management, Spring Profiles (`@Profile("postgres")`).
- **Project Files:** `backend/.../BackendApplication.java`, `backend/.../model/Vehicle.java`, `backend/.../repository/VehicleRepository.java`.

#### 2.3 Next.js 16 (App Router) & React 19
- **Concepts:** Server Components vs Client Components (`"use client"`), React Hooks (`useState`, `useEffect`, `useCallback`, `useRef`), Tailwind CSS utility styling, dynamic SVG rendering, WebGL canvas integration.
- **Project Files:** `frontend/src/app/page.tsx`, `frontend/src/components/InvestigationMap.tsx`.

---

### Level 3 — Computer Vision & Machine Learning Pipeline

#### 3.1 Object Detection with YOLOv8 (Ultralytics)
- **Concepts:** Single-stage object detection, Convolutional Neural Networks (CNN), Feature Pyramid Networks (FPN), anchor-free detection heads, Non-Maximum Suppression (NMS), Intersection over Union (IoU), confidence thresholds, bounding box format (`xyxy` vs `xywh`).
- **Project Files:** `ai-service/ai/vehicle_detector.py`, `ai-service/ai/plate_detector.py`.

#### 3.2 Multi-Object Tracking with ByteTrack
- **Concepts:** Multi-Object Tracking (MOT) paradigm, Kalman filtering for motion state estimation (position, velocity, bounding box aspect ratio), Hungarian algorithm for bipartite matching, low-confidence detection association.
- **Project Files:** `ai-service/ai/tracker.py`.

#### 3.3 Optical Character Recognition (OCR) with EasyOCR
- **Concepts:** CRAFT (Character Region Awareness for Text Detection), CRNN (Convolutional Recurrent Neural Network) with CTC (Connectionist Temporal Classification) loss, character confusion matrices (e.g. `O` vs `0`, `I` vs `1`, `B` vs `8`).
- **Project Files:** `ai-service/ai/ocr.py`, `ai-service/ai/multi_frame_fusion.py`.

#### 3.4 Adverse Weather Image Restoration (Dark Channel Prior Dehazer)
- **Concepts:** Atmospheric scattering model $I(x) = J(x)t(x) + A(1 - t(x))$, Dark Channel Prior calculation, atmospheric light $A$ estimation from top 0.1% brightest pixels, transmission map $t(x)$ recovery, CLAHE (Contrast Limited Adaptive Histogram Equalization).
- **Project Files:** `ai-service/ai/dehazer.py`, `ai-service/ai/plate_preprocessor.py`.

#### 3.5 Deep Visual Re-Identification (Re-ID)
- **Concepts:** Deep feature representation, transfer learning using ResNet50 pretrained on ImageNet, global average pooling, cosine distance metric, combining deep visual embeddings with color histograms.
- **Project Files:** `ai-service/ai/reid.py`, `ai-service/ai/color_classifier.py`.

---

### Level 4 — Advanced Engineering & Spatial Systems

#### 4.1 Heuristic Multi-Factor Identity Scoring
- **Concepts:** Fusing heterogeneous signals:
  $$\text{Score} = w_{\text{plate}}S_{\text{plate}} + w_{\text{reid}}S_{\text{reid}} + w_{\text{color}}S_{\text{color}} + w_{\text{type}}S_{\text{type}} + w_{\text{temp}}S_{\text{temp}} + w_{\text{topo}}S_{\text{topo}}$$
  Dynamic weight redistribution when plate OCR is unreadable; Levenshtein distance string similarity.
- **Project Files:** `ai-service/ai/identity_scorer.py`.

#### 4.2 Kinematic & Geographic Trajectory Scoring
- **Concepts:** Great-circle distance using Haversine formula:
  $$d = 2r \arcsin\left(\sqrt{\sin^2\left(\frac{\Delta\phi}{2}\right) + \cos\phi_1\cos\phi_2\sin^2\left(\frac{\Delta\lambda}{2}\right)}\right)$$
  Forward azimuth/bearing calculation, kinematic speed verification ($v = d / \Delta t$), capping confidence on physically impossible transitions ($v > 150\text{ km/h}$).
- **Project Files:** `backend/.../trajectory/GeoUtils.java`, `backend/.../trajectory/TrajectoryScoringService.java`.

#### 4.3 PostGIS Spatial Queries & GiST Indexing
- **Concepts:** OGC spatial standards, `geography(Point, 4326)`, Spatial Reference System Identifier (SRID 4326 = WGS 84), Generalized Search Tree (GiST) indexing, `ST_DWithin` radius filtering, `<->` spatial distance operator for K-Nearest Neighbor (KNN) index-assisted sorting.
- **Project Files:** `backend/.../spatial/PostGisMigrationRunner.java`, `backend/.../spatial/SpatialCameraService.java`.

#### 4.4 Distributed Caching, Rate Limiting & Pub/Sub (Redis)
- **Concepts:** Sliding-window rate limiting using minute-bucketed Redis keys (`ratelimit:{ip}:{minute}`), automatic expiration (`EXPIRE`), graceful fail-open resilience when cache is offline, Spring Cache abstraction (`@Cacheable`), cache invalidation upon ingestion, Redis Pub/Sub channels.
- **Project Files:** `backend/.../security/RedisRateLimiterFilter.java`, `backend/.../config/RedisConfig.java`, `backend/.../service/RedisPubSubService.java`.

---

### Level 5 — Frontend Geospatial HUD & Real-Time Visualization

#### 5.1 Interactive WebGL GIS Mapping (MapLibre GL JS)
- **Concepts:** Vector & raster tile renderers, GeoJSON `FeatureCollection`, `LineString` trajectory layers, `Circle` camera status markers, coordinate camera flyTo animations, pacing animation by real elapsed travel time.
- **Project Files:** `frontend/src/components/InvestigationMap.tsx`.

#### 5.2 Real-Time WebSocket Streaming Client
- **Concepts:** HTML5 WebSocket API, connection state lifecycle, binary vs text frames, scheduled event playback, synchronized multi-component selection state.
- **Project Files:** `frontend/src/lib/liveClient.ts`, `frontend/src/components/InvestigationDashboard.tsx`.

---

### Level 6 — Testing, Quality Assurance & Security

#### 6.1 Unit & Integration Testing
- **Concepts:** JUnit 5 test lifecycles (`@Test`, `@BeforeEach`), assertions, edge case validation (teleportation speeds, zero distance, null confidence, plate formatting).
- **Project Files:** `backend/src/test/.../GeoUtilsTest.java`, `TrajectoryScoringServiceTest.java`.

#### 6.2 End-to-End API Smoke Testing
- **Concepts:** Black-box API verification, curl automation, checking HTTP status codes, verifying JSON payload fields, testing HTTP Basic auth gating, validating profile-dependent endpoints (PostGIS 200 vs H2 501).
- **Project Files:** `scripts/smoke_test.sh`.

---

## 2. Zero-to-Production Reconstruction Roadmap (14 Milestones)

Follow these 14 milestones in strict sequential order to rebuild the entire platform from an empty directory.

---

### Milestone 1: Workspace Skeleton, Monorepo Configuration & Shared Data
- **Objective:** Create the directory structure, package manifests, Docker Compose services, and seed datasets.
- **Prerequisites:** Level 0.
- **Commands:**
  ```bash
  mkdir city-ai-platform && cd city-ai-platform
  mkdir -p ai-service/ai ai-service/services ai-service/utils ai-service/models
  mkdir -p backend/src/main/java/com/cityai/backend backend/src/main/resources backend/src/test/java
  mkdir -p frontend/src/app frontend/src/components frontend/src/lib frontend/public
  mkdir -p data/evidence scripts videos
  ```
- **Files to Create:**
  - `data/cameras.json`: Define 12 Pune junction camera nodes with ID, name, lat, lon, direction, and status.
  - `data/vehicles.json`: Define mock vehicle profiles (plates, colors, types, makes, models).
  - `docker-compose.yml`: Configure PostGIS 16, Redis 7, Spring Boot, FastAPI, Next.js.
  - `package.json`: Monorepo root npm workspace pointing to `frontend`.
- **Verification:** Run `docker compose config` to confirm Docker syntax validity. Validate `cameras.json` with `python -m json.tool data/cameras.json`.

---

### Milestone 2: AI Microservice Foundations (FastAPI, Pydantic & Config)
- **Objective:** Build the Python AI service skeleton, configuration dataclasses, and Pydantic data models.
- **Prerequisites:** Level 1.1, Level 2.1.
- **Commands:**
  ```bash
  cd ai-service
  python3 -m venv .venv
  source .venv/bin/activate  # On Windows: .venv\Scripts\activate
  pip install fastapi uvicorn pydantic requests
  ```
- **Files to Create:**
  - `ai-service/config.py`: Dataclasses for model paths, detection thresholds, OCR parameters, scoring weights.
  - `ai-service/schemas.py`: Pydantic models: `PlateObservation`, `VehicleObservation`, `VehicleJourney`, `TrajectoryPredictionResponse`, `ProcessVideoRequest`, `ProcessVideoResponse`.
  - `ai-service/main.py`: FastAPI application with `/health` endpoint returning system status.
- **Verification:** Run `uvicorn main:app --port 8000 --reload` and verify `curl http://localhost:8000/health`.

---

### Milestone 3: Image Enhancement & Computer Vision Pipeline
- **Objective:** Implement the Dark Channel Prior dehazer, YOLOv8 vehicle detection, ByteTrack tracking, plate localization, and EasyOCR text extraction.
- **Prerequisites:** Level 3.1, 3.2, 3.3, 3.4.
- **Commands:**
  ```bash
  pip install ultralytics opencv-python-headless easyocr torch torchvision numpy lap
  ```
- **Files to Create:**
  - `ai-service/ai/dehazer.py`: Dark Channel Prior calculation, atmospheric light estimation, transmission recovery.
  - `ai-service/ai/vehicle_detector.py`: YOLOv8s vehicle detection filtering classes 2, 3, 5, 7.
  - `ai-service/ai/tracker.py`: ByteTrack MOT integration keeping track IDs consistent.
  - `ai-service/ai/plate_detector.py`: OpenCV Haar cascade / fine-tuned YOLO plate detector.
  - `ai-service/ai/plate_preprocessor.py`: Grayscale conversion, CLAHE contrast enhancement, adaptive binarization.
  - `ai-service/ai/ocr.py`: EasyOCR extraction, Indian license plate regex matching, character confusion substitution.
  - `ai-service/utils/plate_normalizer.py`: Canonical plate string normalizer.
  - `ai-service/services/video_pipeline.py`: Unified pipeline orchestrating video frames through dehazer, detector, tracker, and OCR.
- **Verification:** Run a test frame through `VideoPipeline` and verify that vehicles are tracked and plates are detected and normalized.

---

### Milestone 4: Appearance Re-ID & Multi-Factor Identity Association
- **Objective:** Implement visual Re-ID feature extraction, color classification, multi-frame OCR fusion, and the 6-factor identity scorer.
- **Prerequisites:** Level 3.5, Level 4.1.
- **Files to Create:**
  - `ai-service/ai/color_classifier.py`: HSV histogram color binning.
  - `ai-service/ai/reid.py`: ResNet50 visual feature extractor (2144-dim embedding).
  - `ai-service/ai/multi_frame_fusion.py`: Multi-frame character positional voting.
  - `ai-service/ai/identity_scorer.py`: 6-factor identity scoring engine with dynamic plate weight redistribution.
  - `ai-service/ai/camera_topology.py`: Spatial graph, Haversine distance, speed feasibility checks.
- **Verification:** Run `python -m pytest` or a standalone script comparing two vehicle sightings and confirming identity match scores exceed 0.75 for identical vehicles.

---

### Milestone 5: Journey Reconstruction & Predictive Trajectory
- **Objective:** Build multi-camera journey reconstruction, anomaly detection, Spatial Markov trajectory forecasting, and security watchlist management.
- **Prerequisites:** Level 4.1, Level 4.2.
- **Files to Create:**
  - `ai-service/ai/journey_reconstructor.py`: Chronological waypoint builder and anomaly detector (`IMPALA_SPEED_VIOLATION`, `CONCURRENT_PRESENCE`).
  - `ai-service/ai/trajectory_predictor.py`: Spatial Markov chain computing top-3 next junction candidates and arrival ETAs.
  - `ai-service/ai/watchlist_manager.py`: Hotlist target matching and security alerts.
  - `ai-service/services/multi_camera_orchestrator.py`: Multi-camera processing coordinator.
- **Verification:** Ingest two observations of the same vehicle at CAM-01 and CAM-03; verify that `reconstruct_journey()` outputs transit distance, elapsed time, and transit speed.

---

### Milestone 6: Spring Boot Backend Architecture & Domain Model
- **Objective:** Initialize the Java Spring Boot backend, configure dependencies in `pom.xml`, and create JPA domain entities and repositories.
- **Prerequisites:** Level 1.2, Level 2.2.
- **Commands:**
  ```bash
  cd backend
  mvn clean compile
  ```
- **Files to Create:**
  - `backend/pom.xml`: Spring Boot 3.3.4, Spring Data JPA, H2, PostgreSQL, Redis, Security, WebSocket.
  - `backend/src/main/resources/application.yml`: Server port 8080, in-memory H2 DB, Redis pool, credentials.
  - `backend/src/main/resources/application-postgres.yml`: PostgreSQL datasource configuration.
  - `backend/.../BackendApplication.java`: Main class with `@SpringBootApplication` and `@EnableCaching`.
  - `backend/.../model/Vehicle.java`: Vehicle entity (plate, type, color, make, model).
  - `backend/.../model/Camera.java`: Camera entity (id, name, lat, lon, direction, status).
  - `backend/.../model/VehicleDetection.java`: Detection entity (coordinates, timestamps, confidences, image path).
  - `backend/.../model/AuditLogEntry.java`: Audit record entity (user, action, target, timestamp, client IP).
  - `backend/.../repository/*Repository.java`: Spring Data JPA repositories.
- **Verification:** Run `mvn test-compile` to verify all JPA models and repositories compile cleanly.

---

### Milestone 7: Data Seeding, Registry Abstraction & Detection Ingestion
- **Objective:** Implement camera network seeding from JSON, mock vehicle registry, and HTTP Basic protected detection ingestion.
- **Prerequisites:** Level 2.2.
- **Files to Create:**
  - `backend/.../service/CameraRecord.java`: JSON DTO.
  - `backend/.../service/DataSeedService.java`: `CommandLineRunner` populating cameras from `cameras.json`.
  - `backend/.../service/VehicleRegistryService.java`: Registry lookup interface.
  - `backend/.../service/MockVehicleRegistryService.java`: In-memory implementation loading `vehicles.json`.
  - `backend/.../service/DetectionIngestionService.java`: Ingests detections, creates vehicles lazily, invalidates cache.
  - `backend/.../controller/DetectionController.java`: `POST /api/detections/ingest`.
- **Verification:** Start backend, inspect logs to confirm 12 cameras are seeded. Execute authenticated POST to `/api/detections/ingest` and assert HTTP 201 Created.

---

### Milestone 8: Trajectory Reconstruction Engine & Scoring Service
- **Objective:** Implement the backend trajectory reconstruction engine, collapsing per-frame detections and scoring consecutive camera transitions.
- **Prerequisites:** Level 4.2.
- **Files to Create:**
  - `backend/.../trajectory/GeoUtils.java`: Haversine distance, initial bearing, angular difference.
  - `backend/.../trajectory/CameraGraph.java`: Edge distance and bearing calculator.
  - `backend/.../trajectory/TrajectoryScoringService.java`: 5-factor transition plausibility scorer.
  - `backend/.../trajectory/TrajectoryEngine.java`: Groups raw detections by camera visit and generates `TrajectoryResult`.
  - `backend/.../controller/TrajectoryController.java`: `GET /api/vehicles/{plate}/trajectory`.
  - `backend/src/test/.../GeoUtilsTest.java`, `TrajectoryScoringServiceTest.java`.
- **Verification:** Run `mvn test` to ensure all geometric and trajectory scoring unit tests pass with zero errors.

---

### Milestone 9: PostGIS Spatial Queries & Production Datasource
- **Objective:** Configure the PostgreSQL + PostGIS profile, schema migration runner, and spatial nearest-neighbor query service.
- **Prerequisites:** Level 4.3.
- **Files to Create:**
  - `backend/.../spatial/PostGisMigrationRunner.java`: Adds `geography(Point, 4326)` columns and GiST indexes.
  - `backend/.../spatial/SpatialCameraService.java`: Executes `ST_DWithin` and `<->` KNN queries.
  - `backend/.../controller/CameraController.java`: Adds `GET /api/cameras/nearby?lat=&lon=&radiusKm=`.
- **Verification:** Run with `SPRING_PROFILES_ACTIVE=postgres` against local Postgres and execute nearby camera search. Verify HTTP 501 fallback when running on default H2 profile.

---

### Milestone 10: Redis Caching, Sliding-Window Rate Limiter & Pub/Sub
- **Objective:** Implement distributed caching, fail-open sliding-window rate limiting, and real-time detection event streaming over Redis.
- **Prerequisites:** Level 4.4.
- **Files to Create:**
  - `backend/.../config/RedisConfig.java`: RedisCacheManager (10m TTL), Lettuce pool configuration.
  - `backend/.../security/RedisRateLimiterFilter.java`: OncePerRequestFilter enforcing 300 req/min limit per client IP.
  - `backend/.../service/RedisPubSubService.java`: Publishes detection events to `cityai:detections`.
- **Verification:** Send 301 rapid requests to `/api/vehicles/MH12AB1234` and verify that the 301st returns HTTP 429 Too Many Requests with headers `X-RateLimit-Limit` and `Retry-After: 60`.

---

### Milestone 11: Real-Time WebSocket Streaming & Audit Logging
- **Objective:** Build the live-tracking simulation WebSocket endpoint and audit logging service.
- **Prerequisites:** Level 2.2, Level 5.2.
- **Files to Create:**
  - `backend/.../websocket/WebSocketConfig.java`: Registers `/ws/live/{plate}`.
  - `backend/.../websocket/LiveTrackingWebSocketHandler.java`: Streams detection events every 3s using `ScheduledExecutorService`.
  - `backend/.../service/AuditLogService.java`: Records user searches and trajectories into `audit_logs`.
  - `backend/.../controller/AuditController.java`: Protected `GET /api/audit/recent`.
- **Verification:** Connect to `ws://localhost:8080/ws/live/MH12AB1234` using `wscat` or Python and verify sequential reception of `connected`, `detection` (index 0..3), and `complete` events.

---

### Milestone 12: Next.js Frontend Setup, MapLibre GIS & State Architecture
- **Objective:** Initialize the Next.js 16 frontend, configure Tailwind CSS, install MapLibre GL JS, and build the interactive map centerpiece.
- **Prerequisites:** Level 1.3, Level 2.3, Level 5.1.
- **Commands:**
  ```bash
  cd frontend
  npm install maplibre-gl framer-motion jspdf lucide-react
  npm install -D tailwindcss @tailwindcss/postcss postcss
  ```
- **Files to Create:**
  - `frontend/src/app/globals.css`: Dark mode styles and map container styling.
  - `frontend/src/app/layout.tsx`: Root layout with dark theme.
  - `frontend/src/lib/api.ts`: API fetch client with seed camera and demo trajectory fallback datasets.
  - `frontend/src/components/InvestigationMap.tsx`: MapLibre GL map rendering CARTO dark tiles, camera dots, route lines, animated replay marker.
- **Verification:** Run `npm run dev` and open `http://localhost:3000`. Confirm map loads with camera markers.

---

### Milestone 13: Tactical Investigation HUD, Modals & Video Ingestion UI
- **Objective:** Build the search panel, intelligence card, timeline feed, evidence snapshot viewer, 3D hologram cards, and operational modals.
- **Prerequisites:** Level 2.3.
- **Files to Create:**
  - `frontend/src/components/VehicleSearchPanel.tsx`: Search bar and mode toggles (Historical, Live, Historical+Live).
  - `frontend/src/components/VehicleIntelligencePanel.tsx`: Summary metrics card.
  - `frontend/src/components/DetectionTimeline.tsx`: Chronological camera pass list.
  - `frontend/src/components/EvidenceViewer.tsx`: CCTV frame snapshot viewer.
  - `frontend/src/components/InteractiveTrajectoryPlayer.tsx`: Playback control scrub bar.
  - `frontend/src/components/VehicleHologram3D.tsx`: 3D canvas vehicle wireframe.
  - `frontend/src/components/TiltCard3D.tsx`: Glare tilt container.
  - `frontend/src/components/SecurityWatchlistModal.tsx`: Watchlist manager modal.
  - `frontend/src/components/LiveCameraGridModal.tsx`: Multi-camera CCTV grid.
  - `frontend/src/components/PdfReportExporter.tsx`: Police dossier PDF exporter.
  - `frontend/src/components/InvestigationDashboard.tsx`: Central coordinator connecting search, map, and timeline.
- **Verification:** Search for `MH12AB1234` in Historical mode. Confirm intelligence card, timeline, evidence image, and map trajectory populate simultaneously.

---

### Milestone 14: Analytics Dashboard, Automated Ingestion CLI & System Verification
- **Objective:** Implement the city traffic analytics view, video ingestion CLI script, end-to-end smoke tests, and Docker packaging.
- **Prerequisites:** Level 5.1, Level 6.1, Level 6.2.
- **Files to Create:**
  - `frontend/src/components/AnalyticsDashboard.tsx`: City-wide metrics view.
  - `scripts/process_video.py`: CLI processing video files and ingesting detections into backend via REST.
  - `scripts/run_sih_demo.py`: Automation script processing all 11 cameras.
  - `scripts/smoke_test.sh`: 17-point automated API test script.
  - `backend/Dockerfile`, `frontend/Dockerfile`, `ai-service/Dockerfile`: Multi-stage production container images.
- **Verification:** Run `./scripts/smoke_test.sh http://localhost:8080`. Verify all 17 tests pass with 0 failures. Execute `docker compose up --build` to confirm end-to-end multi-container orchestration.
