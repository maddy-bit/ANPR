# Project File Inventory: City AI Traffic Intelligence Engine (SIH26127)

**Document Version:** 1.0.0  
**Analysis Date:** 2026-10-27  
**Scope:** Complete workspace inspection of Bharat Electronics Limited (BEL) SIH Problem Statement SIH26127.

---

## 1. Directory Tree & System Structure

```
SIH_Project/
├── .github/workflows/          # CI/CD Workflows (GitHub Actions)
├── ai-service/                 # Python 3.11+ FastAPI Computer Vision Microservice
│   ├── ai/                     # CV Algorithms: YOLOv8, ByteTrack, EasyOCR, Dehazing, Re-ID
│   ├── assets/                 # Reference images and vehicle sprite crops
│   ├── models/                 # Haar cascade XML and model weight references
│   ├── services/               # Orchestration, video pipeline, Redis async worker
│   └── utils/                  # Regex plate normalizers and text sanitizers
├── backend/                    # Java 21 / Spring Boot 3.3.4 Application Server
│   ├── src/main/java/com/cityai/backend/
│   │   ├── analytics/          # City-wide traffic analytics service
│   │   ├── config/             # CORS, Evidence static resource handler, Redis cache
│   │   ├── controller/         # REST API Controllers (Vehicles, Cameras, Ingestion, Proxy)
│   │   ├── dto/                # Data Transfer Objects (Jackson serialized)
│   │   ├── model/              # Hibernate JPA Entities (PostgreSQL / H2)
│   │   ├── repository/         # Spring Data JPA Repository Interfaces
│   │   ├── security/           # HTTP Basic Auth & Redis Sliding-Window Rate Limiter
│   │   ├── service/            # Seeders, Ingestion, Mock Registry, Redis Pub/Sub
│   │   ├── spatial/            # PostGIS Migration Runner & ST_DWithin KNN queries
│   │   ├── trajectory/         # Heuristic 5-Factor Trajectory Scoring & Camera Graph
│   │   ├── util/               # Java Plate Normalization utility
│   │   └── websocket/          # Live Tracking WebSocket Handler & Config
│   ├── src/main/resources/     # application.yml and application-postgres.yml
│   └── src/test/java/          # JUnit 5 & Mockito Unit Tests
├── data/                       # Seed camera topology, mock vehicles, sample datasets
├── frontend/                   # Next.js 16 (App Router) + React 19 + TypeScript + Tailwind
│   ├── public/                 # Static SVG icons and branding assets
│   ├── src/app/                # App Router: layout, globals.css, dashboard page, API routes
│   ├── src/components/         # 20 Modular UI components (MapLibre GIS, 3D Tilt, HUD)
│   └── src/lib/                # API fetch wrappers, formatters, PDF generation, WebSocket client
├── scripts/                    # Ingestion CLI, Scenario synthesis, Dataset evaluation, Smoke tests
├── videos/                     # Demo multi-camera video footage (CAM-01 through CAM-11)
├── docker-compose.yml          # Multi-container orchestration (PostGIS, Redis, Spring Boot, AI, Frontend)
├── full_system_documentation.md# Technical defense and Hackathon judges briefing
├── GETTING_STARTED.md          # Quickstart guide
├── README.md                   # Repository README & architectural roadmap
└── package.json                # Root npm workspace manifest
```

---

## 2. Exhaustive File Inventory Table

The following table catalogs every hand-written source code file, configuration manifest, and data asset in the repository. Each file is assigned a stable identifier (`FILE-xxx`).

| Identifier | File Path | File Type | Architectural Layer | Purpose & Responsibility | Key Dependencies | Analysis Status |
|---|---|---|---|---|---|---|
| **FILE-001** | `docker-compose.yml` | YAML Config | Infrastructure / Deployment | Multi-container composition for PostGIS 16, Redis 7, Backend, AI service, and Frontend | Docker Compose v2, Healthchecks | Fully Analyzed |
| **FILE-002** | `package.json` | JSON Manifest | Build / Tooling | Root npm workspace definition for frontend scripts and optional platform bindings | npm workspaces | Fully Analyzed |
| **FILE-003** | `package-lock.json` | JSON Lockfile | Build / Tooling | Root dependency tree lockfile ensuring deterministic dependency resolution | npm | Fully Analyzed |
| **FILE-004** | `vercel.json` | JSON Config | Cloud Deployment | Root deployment configuration for Vercel edge hosting | Vercel CLI | Fully Analyzed |
| **FILE-005** | `README.md` | Markdown Doc | Documentation | System specification, 15-phase completion status, verified features, caveats | None | Fully Analyzed |
| **FILE-006** | `GETTING_STARTED.md` | Markdown Doc | Documentation | Rapid local startup instructions and environment prerequisites | None | Fully Analyzed |
| **FILE-007** | `full_system_documentation.md` | Markdown Doc | Documentation | BEL Hackathon technical defense, architectural deep dive, future roadmap | None | Fully Analyzed |
| **FILE-008** | `.github/workflows/ci.yml` | YAML Workflow | CI/CD | GitHub Actions pipeline running Maven tests, ESLint, Next.js build, and smoke tests | GitHub Actions Ubuntu | Fully Analyzed |
| **FILE-009** | `ai-service/main.py` | Python Script | AI Microservice / API | FastAPI web server exposing video processing, trajectory forecast, analytics, and plate detection | FastAPI, Pydantic, OpenCV | Fully Analyzed |
| **FILE-010** | `ai-service/schemas.py` | Python Source | AI Microservice / Schema | Pydantic V2 data contracts for observations, journeys, predictions, alerts, and requests | Pydantic BaseModel | Fully Analyzed |
| **FILE-011** | `ai-service/config.py` | Python Source | AI Microservice / Config | Central configuration dataclasses for detection thresholds, weights, and file paths | Dataclasses, Pathlib | Fully Analyzed |
| **FILE-012** | `ai-service/requirements.txt` | Pip Manifest | AI Microservice / Deps | Declares Python runtime dependencies: FastAPI, PyTorch, Ultralytics, EasyOCR, Redis | pip | Fully Analyzed |
| **FILE-013** | `ai-service/Dockerfile` | Dockerfile | AI Microservice / Build | Container image definition based on python:3.11-slim with OpenCV system libraries | Debian runtime, libgl1 | Fully Analyzed |
| **FILE-014** | `ai-service/ai/__init__.py` | Python Module | AI Microservice / Init | Package initializer for AI algorithms namespace | None | Fully Analyzed |
| **FILE-015** | `ai-service/ai/camera_topology.py` | Python Source | AI / Spatial Graph | Models camera node network, Haversine distance, travel time estimation, spatial feasibility | Math, Haversine | Fully Analyzed |
| **FILE-016** | `ai-service/ai/color_classifier.py` | Python Source | AI / Appearance Re-ID | Extracts vehicle color profile via HSV color space histogram binning and thresholding | OpenCV, NumPy | Fully Analyzed |
| **FILE-017** | `ai-service/ai/dehazer.py` | Python Source | AI / Image Enhancement | Restores visibility in foggy/hazy camera feeds using Dark Channel Prior (DCP) & CLAHE | OpenCV, NumPy, CLAHE | Fully Analyzed |
| **FILE-018** | `ai-service/ai/global_vehicle_registry.py` | Python Source | AI / Identity State | In-memory thread-safe global registry tracking multi-camera vehicle observations | Threading, Pydantic | Fully Analyzed |
| **FILE-019** | `ai-service/ai/identity_scorer.py` | Python Source | AI / Association Engine | 6-factor vehicle identity matcher: Plate (40%), Re-ID (30%), Color (12%), Type (10%), Temporal, Topology | Levenshtein, NumPy | Fully Analyzed |
| **FILE-020** | `ai-service/ai/journey_reconstructor.py` | Python Source | AI / Journey Engine | Reconstructs chronological waypoints and detects anomalies (impala speed, concurrent sightings) | Pydantic, CameraTopology | Fully Analyzed |
| **FILE-021** | `ai-service/ai/multi_frame_fusion.py` | Python Source | AI / OCR Fusion | Fuses multi-frame OCR reads via character position voting and confidence weighting | Collections Counter, NumPy | Fully Analyzed |
| **FILE-022** | `ai-service/ai/ocr.py` | Python Source | AI / Text Extraction | EasyOCR text extraction, Indian license plate regex validation, character confusion mapping | EasyOCR, OpenCV, Regex | Fully Analyzed |
| **FILE-023** | `ai-service/ai/plate_detector.py` | Python Source | AI / Plate Localization | Localizes license plate bounding boxes using fine-tuned YOLOv8n or Haar cascade | Ultralytics YOLO, OpenCV | Fully Analyzed |
| **FILE-024** | `ai-service/ai/plate_preprocessor.py` | Python Source | AI / Image Enhancement | Preprocesses plate crops via grayscale, CLAHE, Gaussian blur, and adaptive Otsu binarization | OpenCV, NumPy | Fully Analyzed |
| **FILE-025** | `ai-service/ai/reid.py` | Python Source | AI / Deep Appearance | Extracts 2144-dimensional visual embedding (ResNet50 2048-dim + HSV histogram 96-dim) | Torchvision ResNet50, PyTorch | Fully Analyzed |
| **FILE-026** | `ai-service/ai/tracker.py` | Python Source | AI / Multi-Object Tracking | Tracks vehicles across consecutive frames using Ultralytics ByteTrack algorithm | Ultralytics YOLOv8, ByteTrack | Fully Analyzed |
| **FILE-027** | `ai-service/ai/traffic_analytics.py` | Python Source | AI / Traffic Analytics | Computes junction vehicle throughput, average speed, congestion levels (GREEN/YELLOW/RED) | Collections, NumPy | Fully Analyzed |
| **FILE-028** | `ai-service/ai/trajectory_predictor.py` | Python Source | AI / Predictive Markov | Forecasts top-3 next camera junctions and ETAs using a Spatial Markov transition matrix | Math, Collections, Graph | Fully Analyzed |
| **FILE-029** | `ai-service/ai/vehicle_detector.py` | Python Source | AI / Object Detection | Detects vehicles (car, motorcycle, bus, truck) in video frames using YOLOv8s | Ultralytics YOLO | Fully Analyzed |
| **FILE-030** | `ai-service/ai/watchlist_manager.py` | Python Source | AI / Security Hotlist | Manages security target watchlist and generates security alerts (stolen/cloned vehicles) | Pydantic, Logging | Fully Analyzed |
| **FILE-031** | `ai-service/services/__init__.py` | Python Module | AI Microservice / Init | Services namespace initializer | None | Fully Analyzed |
| **FILE-032** | `ai-service/services/multi_camera_orchestrator.py` | Python Source | AI / Orchestration | Coordinates multi-camera ingestion, cross-camera Re-ID fusion, and city analytics | ThreadPoolExecutor, Services | Fully Analyzed |
| **FILE-033** | `ai-service/services/redis_service.py` | Python Source | AI / Distributed State | Manages async job status and distributed caching via Redis client | redis.asyncio | Fully Analyzed |
| **FILE-034** | `ai-service/services/video_pipeline.py` | Python Source | AI / Pipeline Runner | Executes end-to-end single-camera pipeline (dehaze -> detect -> track -> crop -> OCR -> save) | OpenCV, AI Modules | Fully Analyzed |
| **FILE-035** | `ai-service/utils/__init__.py` | Python Module | AI Microservice / Init | Utilities namespace initializer | None | Fully Analyzed |
| **FILE-036** | `ai-service/utils/plate_normalizer.py` | Python Source | AI / Text Normalization | Regex canonicalization of Indian license plate numbers (spaces/hyphens removed, uppercase) | Python re | Fully Analyzed |
| **FILE-037** | `backend/pom.xml` | XML Manifest | Backend / Build | Maven build descriptor for Spring Boot 3.3.4, Java 21, JPA, Security, Redis, PostGIS | Maven 3.9 | Fully Analyzed |
| **FILE-038** | `backend/Dockerfile` | Dockerfile | Backend / Build | Multi-stage build compiling with Maven 3.9 Temurin 21 and packaging into minimal JRE | Eclipse Temurin 21 JRE | Fully Analyzed |
| **FILE-039** | `backend/src/main/resources/application.yml` | YAML Config | Backend / Config | Default Spring Boot configuration (H2 in-memory DB, Redis cache, credentials, server port) | Spring Boot Environment | Fully Analyzed |
| **FILE-040** | `backend/src/main/resources/application-postgres.yml` | YAML Config | Backend / Config | Production profile activating PostgreSQL 16 datasource and Hibernate Postgres dialect | Spring Profiles | Fully Analyzed |
| **FILE-041** | `backend/src/main/java/com/cityai/backend/BackendApplication.java` | Java Source | Backend / Entrypoint | Spring Boot application entry point and caching activation (`@EnableCaching`) | SpringApplication | Fully Analyzed |
| **FILE-042** | `backend/src/main/java/com/cityai/backend/analytics/AnalyticsService.java` | Java Source | Backend / Analytics | Calculates city traffic metrics: vehicle distribution, hourly histograms, top routes | JPA Repositories | Fully Analyzed |
| **FILE-043** | `backend/src/main/java/com/cityai/backend/config/CorsConfig.java` | Java Source | Backend / Config | Configures cross-origin resource sharing policies for Next.js frontend clients | Spring WebMvcConfigurer | Fully Analyzed |
| **FILE-044** | `backend/src/main/java/com/cityai/backend/config/EvidenceResourceConfig.java` | Java Source | Backend / Config | Static resource mapping serving evidence snapshot frames from `data/evidence/` via HTTP | Spring ResourceHandler | Fully Analyzed |
| **FILE-045** | `backend/src/main/java/com/cityai/backend/config/RedisConfig.java` | Java Source | Backend / Config | Configures Lettuce connection pool, RedisCacheManager (10m TTL), and RedisTemplate | Spring Data Redis | Fully Analyzed |
| **FILE-046** | `backend/src/main/java/com/cityai/backend/controller/AiProxyController.java` | Java Source | Backend / Controller | Proxies AI microservice REST endpoints (`/watchlist`, `/security-alerts`, `/predict-trajectory`) | Spring RestTemplate | Fully Analyzed |
| **FILE-047** | `backend/src/main/java/com/cityai/backend/controller/AnalyticsController.java` | Java Source | Backend / Controller | REST endpoint `GET /api/analytics/overview` returning traffic metrics DTO | Spring RestController | Fully Analyzed |
| **FILE-048** | `backend/src/main/java/com/cityai/backend/controller/ApiExceptionHandler.java` | Java Source | Backend / Controller | Global `@ControllerAdvice` handling 404, 400, and 500 exceptions into clean JSON error responses | Spring Web MVC | Fully Analyzed |
| **FILE-049** | `backend/src/main/java/com/cityai/backend/controller/AuditController.java` | Java Source | Backend / Controller | Protected endpoint `GET /api/audit/recent` returning investigation audit records | Spring Security | Fully Analyzed |
| **FILE-050** | `backend/src/main/java/com/cityai/backend/controller/CameraController.java` | Java Source | Backend / Controller | Endpoints for listing cameras, camera by ID, and PostGIS spatial nearby camera queries | Spring Data JPA | Fully Analyzed |
| **FILE-051** | `backend/src/main/java/com/cityai/backend/controller/DetectionController.java` | Java Source | Backend / Controller | Protected endpoints `POST /api/detections/ingest` and `/batch` for storing AI detections | Spring Security Basic Auth | Fully Analyzed |
| **FILE-052** | `backend/src/main/java/com/cityai/backend/controller/HealthController.java` | Java Source | Backend / Controller | Liveness endpoint `GET /api/health` checking service status and Redis ping latency | Lettuce RedisClient | Fully Analyzed |
| **FILE-053** | `backend/src/main/java/com/cityai/backend/controller/TrajectoryController.java` | Java Source | Backend / Controller | Endpoint `GET /api/vehicles/{plate}/trajectory` reconstructing confident journeys | TrajectoryEngine | Fully Analyzed |
| **FILE-054** | `backend/src/main/java/com/cityai/backend/controller/VehicleController.java` | Java Source | Backend / Controller | Endpoints `GET /api/vehicles/{plate}` summary and `/detections` chronological logs | VehicleRepository | Fully Analyzed |
| **FILE-055** | `backend/src/main/java/com/cityai/backend/dto/AnalyticsOverviewDto.java` | Java Source | Backend / DTO | Java record representing city traffic summary, camera status, top routes, speed | Jackson | Fully Analyzed |
| **FILE-056** | `backend/src/main/java/com/cityai/backend/dto/AuditLogEntryDto.java` | Java Source | Backend / DTO | Java record representing an audit log entry (timestamp, user, action, target) | Jackson | Fully Analyzed |
| **FILE-057** | `backend/src/main/java/com/cityai/backend/dto/CameraDto.java` | Java Source | Backend / DTO | Java record for camera node attributes (ID, name, lat, lon, direction, status) | Jackson | Fully Analyzed |
| **FILE-058** | `backend/src/main/java/com/cityai/backend/dto/DetectionIngestRequest.java` | Java Source | Backend / DTO | Java record representing AI video pipeline detection ingestion payload | Jakarta Validation | Fully Analyzed |
| **FILE-059** | `backend/src/main/java/com/cityai/backend/dto/TrajectoryPointDto.java` | Java Source | Backend / DTO | Java record representing a camera waypoint in a reconstructed trajectory | Jackson | Fully Analyzed |
| **FILE-060** | `backend/src/main/java/com/cityai/backend/dto/TrajectoryResponseDto.java` | Java Source | Backend / DTO | Java record representing full reconstructed route with overall confidence and distance | Jackson | Fully Analyzed |
| **FILE-061** | `backend/src/main/java/com/cityai/backend/dto/VehicleDetectionDto.java` | Java Source | Backend / DTO | Java record for individual vehicle detection events sent across REST & WebSocket | Jackson | Fully Analyzed |
| **FILE-062** | `backend/src/main/java/com/cityai/backend/dto/VehicleDto.java` | Java Source | Backend / DTO | Java record for vehicle metadata (plate, make, model, color, type) | Jackson | Fully Analyzed |
| **FILE-063** | `backend/src/main/java/com/cityai/backend/dto/VehicleSummaryDto.java` | Java Source | Backend / DTO | Java record for vehicle intelligence summary (first seen, last seen, camera count) | Jackson | Fully Analyzed |
| **FILE-064** | `backend/src/main/java/com/cityai/backend/model/AuditLogEntry.java` | Java Source | Backend / Model | JPA entity mapping `audit_logs` table recording all user search queries and views | Jakarta Persistence | Fully Analyzed |
| **FILE-065** | `backend/src/main/java/com/cityai/backend/model/Camera.java` | Java Source | Backend / Model | JPA entity mapping `cameras` table storing camera coordinates and operational status | Jakarta Persistence | Fully Analyzed |
| **FILE-066** | `backend/src/main/java/com/cityai/backend/model/Vehicle.java` | Java Source | Backend / Model | JPA entity mapping `vehicles` table storing canonical vehicle identities | Jakarta Persistence | Fully Analyzed |
| **FILE-067** | `backend/src/main/java/com/cityai/backend/model/VehicleDetection.java` | Java Source | Backend / Model | JPA entity mapping `vehicle_detections` storing raw frame observations and coordinates | Jakarta Persistence | Fully Analyzed |
| **FILE-068** | `backend/src/main/java/com/cityai/backend/repository/AuditLogRepository.java` | Java Source | Backend / Repository | Spring Data JPA repository for audit log queries ordered by timestamp descending | Spring Data JPA | Fully Analyzed |
| **FILE-069** | `backend/src/main/java/com/cityai/backend/repository/CameraRepository.java` | Java Source | Backend / Repository | Spring Data JPA repository for camera entity CRUD operations | Spring Data JPA | Fully Analyzed |
| **FILE-070** | `backend/src/main/java/com/cityai/backend/repository/VehicleDetectionRepository.java` | Java Source | Backend / Repository | Spring Data JPA repository for detection log retrieval by vehicle and camera | Spring Data JPA | Fully Analyzed |
| **FILE-071** | `backend/src/main/java/com/cityai/backend/repository/VehicleRepository.java` | Java Source | Backend / Repository | Spring Data JPA repository finding vehicles by canonical normalized license plate | Spring Data JPA | Fully Analyzed |
| **FILE-072** | `backend/src/main/java/com/cityai/backend/security/RedisRateLimiterFilter.java` | Java Source | Backend / Security | Servlet filter enforcing 300 req/min sliding-window rate limit per IP using Redis | Spring OncePerRequestFilter | Fully Analyzed |
| **FILE-073** | `backend/src/main/java/com/cityai/backend/security/SecurityConfig.java` | Java Source | Backend / Security | Spring Security configuration gating POST ingestion and audit logs with HTTP Basic auth | Spring Security 6 | Fully Analyzed |
| **FILE-074** | `backend/src/main/java/com/cityai/backend/service/AuditLogService.java` | Java Source | Backend / Service | Records search actions into database and checks client remote IP headers | AuditLogRepository | Fully Analyzed |
| **FILE-075** | `backend/src/main/java/com/cityai/backend/service/CameraRecord.java` | Java Source | Backend / Service | Java record mapping `cameras.json` seed file JSON fields | Jackson | Fully Analyzed |
| **FILE-076** | `backend/src/main/java/com/cityai/backend/service/DataSeedService.java` | Java Source | Backend / Service | CommandLineRunner seeding camera network into database on application startup | CameraRepository | Fully Analyzed |
| **FILE-077** | `backend/src/main/java/com/cityai/backend/service/DetectionIngestionService.java` | Java Source | Backend / Service | Converts AI ingest requests into database rows, invalidates Redis caches, publishes Pub/Sub | JPA, CacheManager | Fully Analyzed |
| **FILE-078** | `backend/src/main/java/com/cityai/backend/service/MockVehicleRegistryService.java` | Java Source | Backend / Service | In-memory vehicle registry loading vehicle profiles from `data/vehicles.json` | Jackson | Fully Analyzed |
| **FILE-079** | `backend/src/main/java/com/cityai/backend/service/RedisPubSubService.java` | Java Source | Backend / Service | Publishes real-time vehicle detection events to Redis Pub/Sub channel `cityai:detections` | StringRedisTemplate | Fully Analyzed |
| **FILE-080** | `backend/src/main/java/com/cityai/backend/service/VehicleRegistryRecord.java` | Java Source | Backend / Service | Java record for vehicle registration details (plate, type, color, make, model) | Jackson | Fully Analyzed |
| **FILE-081** | `backend/src/main/java/com/cityai/backend/service/VehicleRegistryService.java` | Java Source | Backend / Service | Interface abstraction for vehicle registry lookups (enables swapping mock for real RTO) | Java 21 Interface | Fully Analyzed |
| **FILE-082** | `backend/src/main/java/com/cityai/backend/spatial/PostGisMigrationRunner.java` | Java Source | Backend / Spatial | Generates PostGIS geography columns and GiST spatial indexes under `postgres` profile | JdbcTemplate | Fully Analyzed |
| **FILE-083** | `backend/src/main/java/com/cityai/backend/spatial/SpatialCameraService.java` | Java Source | Backend / Spatial | Performs `ST_DWithin` radius search and `<->` K-Nearest Neighbor (KNN) spatial queries | JdbcTemplate, PostGIS | Fully Analyzed |
| **FILE-084** | `backend/src/main/java/com/cityai/backend/trajectory/CameraGraph.java` | Java Source | Backend / Trajectory | Models geometric edge between two camera nodes (Haversine distance & compass bearing) | GeoUtils | Fully Analyzed |
| **FILE-085** | `backend/src/main/java/com/cityai/backend/trajectory/GeoUtils.java` | Java Source | Backend / Trajectory | Math utilities: Haversine distance, initial compass bearing, compass angle difference | Java Math | Fully Analyzed |
| **FILE-086** | `backend/src/main/java/com/cityai/backend/trajectory/TrajectoryEngine.java` | Java Source | Backend / Trajectory | Collapses per-frame detections into camera visits, scores transitions, produces route DTO | TrajectoryScoringService | Fully Analyzed |
| **FILE-087** | `backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java` | Java Source | Backend / Trajectory | 5-factor transition plausibility scorer: Plate (30%), Kinematic (25%), Geo, Direction, Re-ID | CameraGraph, GeoUtils | Fully Analyzed |
| **FILE-088** | `backend/src/main/java/com/cityai/backend/util/PlateNormalizer.java` | Java Source | Backend / Util | Strips non-alphanumeric characters and converts plate strings to uppercase | Java Regex | Fully Analyzed |
| **FILE-089** | `backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java` | Java Source | Backend / WebSocket | Paced real-time streaming WebSocket handler simulating live detection events every 3s | ScheduledExecutorService | Fully Analyzed |
| **FILE-090** | `backend/src/main/java/com/cityai/backend/websocket/WebSocketConfig.java` | Java Source | Backend / WebSocket | Registers `/ws/live/{plate}` WebSocket endpoint with permissive CORS for frontend | WebSocketConfigurer | Fully Analyzed |
| **FILE-091** | `backend/src/test/java/com/cityai/backend/trajectory/GeoUtilsTest.java` | Java Source | Backend / Test | Unit tests for Haversine distance calculation and compass bearing conversion | JUnit 5 | Fully Analyzed |
| **FILE-092** | `backend/src/test/java/com/cityai/backend/trajectory/TrajectoryScoringServiceTest.java` | Java Source | Backend / Test | Unit tests verifying kinematic scoring, speed thresholds, and implausible transition caps | JUnit 5 | Fully Analyzed |
| **FILE-093** | `backend/src/test/java/com/cityai/backend/util/PlateNormalizerTest.java` | Java Source | Backend / Test | Unit tests verifying license plate canonicalization and spacing/casing tolerance | JUnit 5 | Fully Analyzed |
| **FILE-094** | `frontend/package.json` | JSON Manifest | Frontend / Build | Frontend dependencies: Next.js 16, React 19, MapLibre GL, Lucide React, Tailwind CSS | npm | Fully Analyzed |
| **FILE-095** | `frontend/package-lock.json` | JSON Lockfile | Frontend / Build | Frontend dependency resolution lockfile | npm | Fully Analyzed |
| **FILE-096** | `frontend/tsconfig.json` | JSON Config | Frontend / Build | TypeScript compiler configuration (ES2017 target, bundler module resolution, path aliases) | TypeScript 5 | Fully Analyzed |
| **FILE-097** | `frontend/next.config.ts` | TS Config | Frontend / Build | Next.js configuration enabling standalone Docker output and SVG Turbopack loaders | Next.js Config | Fully Analyzed |
| **FILE-098** | `frontend/postcss.config.mjs` | JS Config | Frontend / Build | PostCSS plugin configuration for Tailwind CSS v4 | PostCSS | Fully Analyzed |
| **FILE-099** | `frontend/eslint.config.mjs` | JS Config | Frontend / Tooling | ESLint configuration extending `next/core-web-vitals` rules | ESLint 9 | Fully Analyzed |
| **FILE-100** | `frontend/Dockerfile` | Dockerfile | Frontend / Build | Multi-stage Docker build packaging Next.js standalone server into lean node:22-slim image | Node 22 runtime | Fully Analyzed |
| **FILE-101** | `frontend/src/app/globals.css` | CSS Styles | Frontend / Styling | Global Tailwind CSS styling, custom dark mode scrollbars, map container rules | Tailwind CSS 4 | Fully Analyzed |
| **FILE-102** | `frontend/src/app/layout.tsx` | TSX Component | Frontend / App Shell | Root HTML document shell, font configuration, and metadata title/description | React 19, Next.js | Fully Analyzed |
| **FILE-103** | `frontend/src/app/page.tsx` | TSX Component | Frontend / Page | Master dashboard page managing view switching (Investigation vs Analytics) and HUD bar | React useState | Fully Analyzed |
| **FILE-104** | `frontend/src/app/api/yolo/detect/route.ts` | TS Route | Frontend / API Route | Next.js API route proxying real-time video frame detection to Python AI service | NextRequest, NextResponse | Fully Analyzed |
| **FILE-105** | `frontend/src/components/AnalyticsDashboard.tsx` | TSX Component | Frontend / UI Component | City traffic analytics view: vehicle distribution, busiest junctions, top routes, speed | Lucide React | Fully Analyzed |
| **FILE-106** | `frontend/src/components/ConfidenceBadge.tsx` | TSX Component | Frontend / UI Component | Color-coded confidence indicator badge (High green, Medium amber, Low red) | React | Fully Analyzed |
| **FILE-107** | `frontend/src/components/DetectionTimeline.tsx` | TSX Component | Frontend / UI Component | Chronological camera visit feed with time deltas, confidence scores, and selection sync | React | Fully Analyzed |
| **FILE-108** | `frontend/src/components/EvidenceViewer.tsx` | TSX Component | Frontend / UI Component | Displays saved CCTV snapshot frames, crop overlays, OCR confidence, and zoom controls | React | Fully Analyzed |
| **FILE-109** | `frontend/src/components/InteractiveTrajectoryPlayer.tsx` | TSX Component | Frontend / UI Component | Replay control bar providing play/pause, scrub slider, and speed controls for trajectory | React | Fully Analyzed |
| **FILE-110** | `frontend/src/components/InvestigationDashboard.tsx` | TSX Component | Frontend / UI Component | Central investigation workspace coordinating search panel, map, timeline, and modals | React | Fully Analyzed |
| **FILE-111** | `frontend/src/components/InvestigationMap.tsx` | TSX Component | Frontend / UI Component | MapLibre GL JS interactive city map with GeoJSON route lines, camera status, animated marker | MapLibre GL JS | Fully Analyzed |
| **FILE-112** | `frontend/src/components/LiveCameraGridModal.tsx` | TSX Component | Frontend / UI Component | Grid modal displaying active CCTV camera video streams and simulated telemetry | HTML5 Video, React | Fully Analyzed |
| **FILE-113** | `frontend/src/components/PdfReportExporter.tsx` | TSX Component | Frontend / UI Component | Generates and downloads official police investigation PDF dossier using jsPDF | jsPDF, html2canvas | Fully Analyzed |
| **FILE-114** | `frontend/src/components/SecurityWatchlistModal.tsx` | TSX Component | Frontend / UI Component | Modal for viewing security hotlist target vehicles and adding new stolen/suspect plates | React, API Client | Fully Analyzed |
| **FILE-115** | `frontend/src/components/SystemBootLoader.tsx` | TSX Component | Frontend / UI Component | High-tech bootup animation HUD displaying hardware initialization and neural model loading | React, CSS Animations | Fully Analyzed |
| **FILE-116** | `frontend/src/components/SystemStatusBar.tsx` | TSX Component | Frontend / UI Component | Top HUD indicator reporting backend API liveness, Redis latency, and database profile | React useEffect | Fully Analyzed |
| **FILE-117** | `frontend/src/components/TiltCard3D.tsx` | TSX Component | Frontend / UI Component | Interactive 3D perspective tilt container with dynamic mouse hover glare effects | React, CSS 3D Transforms | Fully Analyzed |
| **FILE-118** | `frontend/src/components/TrajectoryPredictionCard.tsx` | TSX Component | Frontend / UI Component | Displays forecasted next camera junctions, transition probabilities, and estimated arrival times | React, Lucide Icons | Fully Analyzed |
| **FILE-119** | `frontend/src/components/VehicleHologram3D.tsx` | TSX Component | Frontend / UI Component | Interactive 3D wireframe vehicle hologram visualization with 360-degree rotation | Canvas API / React | Fully Analyzed |
| **FILE-120** | `frontend/src/components/VehicleIntelligencePanel.tsx` | TSX Component | Frontend / UI Component | Tactical HUD card displaying vehicle make, model, color, first/last seen, cameras visited | React | Fully Analyzed |
| **FILE-121** | `frontend/src/components/VehicleRegistryModal.tsx` | TSX Component | Frontend / UI Component | Modal querying vehicle registration details (owner, RTO, engine number, insurance) | React, Vahan Mock | Fully Analyzed |
| **FILE-122** | `frontend/src/components/VehicleRegistrySection.tsx` | TSX Component | Frontend / UI Component | Inline dashboard section displaying Vahan registry verification metrics | React | Fully Analyzed |
| **FILE-123** | `frontend/src/components/VehicleSearchPanel.tsx` | TSX Component | Frontend / UI Component | License plate input form with mode toggle (Historical, Live, Historical+Live) | React | Fully Analyzed |
| **FILE-124** | `frontend/src/components/VideoIngestionModal.tsx` | TSX Component | Frontend / UI Component | Ingestion modal allowing operators to trigger video analysis on specific camera feeds | React, API Client | Fully Analyzed |
| **FILE-125** | `frontend/src/lib/api.ts` | TypeScript Library | Frontend / Client | Robust fetch wrapper for Spring Boot & FastAPI endpoints with comprehensive fallback datasets | Fetch API, DTOs | Fully Analyzed |
| **FILE-126** | `frontend/src/lib/format.ts` | TypeScript Library | Frontend / Formatting | Formatters for timestamps, relative elapsed time, distance in kilometers, speeds | Date API | Fully Analyzed |
| **FILE-127** | `frontend/src/lib/generateRcPdf.ts` | TypeScript Library | Frontend / Utility | Generates official Ministry of Road Transport & Highways (MoRTH) RC certificate PDF | jsPDF | Fully Analyzed |
| **FILE-128** | `frontend/src/lib/liveClient.ts` | TypeScript Library | Frontend / WebSocket | Native WebSocket client managing connection lifecycle, event parsing, and automatic reconnect | WebSocket API | Fully Analyzed |
| **FILE-129** | `frontend/src/lib/registry.ts` | TypeScript Library | Frontend / Registry | Mock Vahan vehicle registration database for Indian vehicles | TypeScript | Fully Analyzed |
| **FILE-130** | `frontend/src/lib/routing.ts` | TypeScript Library | Frontend / GIS Routing | Interpolates smooth curved route coordinates between camera junction nodes | Turf.js / Math | Fully Analyzed |
| **FILE-131** | `data/cameras.json` | JSON Data | System Data / Seed | Seed camera network defining 12 junction cameras in Pune, India (lat, lon, direction) | Seed Loader | Fully Analyzed |
| **FILE-132** | `data/vehicles.json` | JSON Data | System Data / Seed | Mock vehicle registry containing target vehicles (`MH12AB1234`, `ET3633P`, decoys) | Seed Loader | Fully Analyzed |
| **FILE-133** | `scripts/process_video.py` | Python Script | Tooling / Ingestion | CLI executing full AI pipeline on video and posting detections to backend ingest API | requests, VideoPipeline | Fully Analyzed |
| **FILE-134** | `scripts/generate_demo_footage.py` | Python Script | Tooling / Synthesis | Synthesizes multi-camera video footage by compositing vehicle sprites and plates onto roads | OpenCV, NumPy | Fully Analyzed |
| **FILE-135** | `scripts/extract_vehicle_sprites.py` | Python Script | Tooling / Dataset | Extracts clean vehicle sprite crops from source traffic clips using YOLOv8 | OpenCV, Ultralytics | Fully Analyzed |
| **FILE-136** | `scripts/evaluate_pipeline.py` | Python Script | Tooling / Benchmarking | Benchmarks detection, tracking, and OCR accuracy on test video footage | OpenCV, Metrics | Fully Analyzed |
| **FILE-137** | `scripts/prepare_plate_dataset.py` | Python Script | Tooling / ML Prep | Prepares hazy and ground-truth license plate image dataset splits for YOLO training | Pathlib, Shutil | Fully Analyzed |
| **FILE-138** | `scripts/train_plate_detector.py` | Python Script | Tooling / ML Training | Fine-tunes YOLOv8n specifically on license plate bounding box dataset | Ultralytics YOLO | Fully Analyzed |
| **FILE-139** | `scripts/run_sih_demo.py` | Python Script | Tooling / Automation | Automates sequential processing of all 11 camera feeds to populate the demo scenario | Subprocess, Requests | Fully Analyzed |
| **FILE-140** | `scripts/smoke_test.sh` | Bash Script | Tooling / Testing | 17-point integration test suite verifying backend REST, auth, and PostGIS endpoints | curl, bash | Fully Analyzed |
| **FILE-141** | `scripts/test_sih26127_features.py` | Python Script | Tooling / Testing | Verifies MultiCameraOrchestrator, camera registration, and watchlist manager in-process | AI Modules | Fully Analyzed |
| **FILE-142** | `scripts/generate_pdf_doc.py` | Python Script | Tooling / Documentation | Compiles Markdown to HTML and invokes Microsoft Edge headless to generate system PDF | Subprocess, msedge | Fully Analyzed |
| **FILE-143** | `scripts/generate_ml_pdf.py` | Python Script | Tooling / Documentation | Generates ML deep dive technical defense presentation PDF via headless Edge | Subprocess, msedge | Fully Analyzed |

---

## 3. Excluded Binary & External Assets Rationale

The following directories and binary assets exist in the workspace but are excluded from line-by-line source code walkthroughs:

1. **`node_modules/` (Root & Frontend):** Third-party compiled JavaScript packages managed by npm.
2. **`.venv/` & `venv/` (AI Service):** Local Python virtual environments containing compiled C-extensions and PyTorch wheels.
3. **`yolov8n.pt` & `ai-service/models/*.pt`:** Binary neural network weight checkpoints containing binary floating-point tensor matrices. Their architecture and invocation are fully documented under `vehicle_detector.py` and `plate_detector.py`.
4. **`videos/CAM-01.mp4` through `CAM-11.mp4` & `source_traffic_*.mp4`:** H.264 encoded MP4 video files used as input test footage for computer vision models.
5. **`data/evidence/` & `data/dataset_samples/`:** Binary JPEG and PNG image frames, crops, and training samples.
6. **`ai-service/models/haarcascade_russian_plate_number.xml`:** Pretrained XML cascade classifier containing trained Haar feature weights for license plate region detection.
