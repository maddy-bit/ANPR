# 01. Complete Project Inventory

## Executive Overview
- **Project Name**: City AI ANPR Trajectory & Urban Traffic Intelligence Platform (SIH26127 — Bharat Electronics Limited / Smart India Hackathon).
- **Core Stated Purpose**: Multi-camera automated number plate recognition (ANPR), cross-camera vehicle trajectory reconstruction, spatial-temporal anomaly detection (speeding / cloning / hotlist alerts), traffic analytics, and official VAHAN RC registry lookup.
- **Physical Location on Disk**: `C:\Users\Asus\OneDrive\Desktop\ai traffic`
- **Audit Date**: 2026-11-02
- **Audit Methodology**: Static source code inspection across all directories, tracing execution paths from client to backend, AI services, database, Redis, and external APIs. Verification of actual runtime code versus claims in documentation.

---

## 1. Directory Tree & Inventory

```
C:\Users\Asus\OneDrive\Desktop\ai traffic
├── .github/
│   └── workflows/
│       └── ci.yml                             # GitHub Actions CI workflow (Maven + Python + Next.js build)
├── .vscode/
│   └── settings.json                          # Workspace IDE settings
├── ai-service/                                # Python FastAPI AI & Computer Vision microservice
│   ├── .dockerignore
│   ├── .gitignore
│   ├── Dockerfile                             # Python 3.11-slim container definition
│   ├── requirements.txt                       # Python dependencies (FastAPI, Ultralytics, EasyOCR, Torch)
│   ├── config.py                              # Central pipeline tunables, model paths, thresholds
│   ├── main.py                                # FastAPI application entry point & REST endpoints
│   ├── schemas.py                             # Pydantic v2 schemas for detections, observations, journeys
│   ├── ai/                                    # Computer vision & analytical intelligence algorithms
│   │   ├── __init__.py
│   │   ├── camera_topology.py                 # Haversine distance & spatial graph calculations
│   │   ├── color_classifier.py                # HSV K-means clustering (k=3) vehicle color extractor
│   │   ├── dehazer.py                         # Dark Channel Prior (DCP) + CLAHE image dehazer
│   │   ├── global_vehicle_registry.py         # Cross-camera identity consolidation (in-memory)
│   │   ├── identity_scorer.py                 # Multi-signal scoring engine (Plate, ReID, Color, Type, Time, Topology)
│   │   ├── journey_reconstructor.py           # Chronological waypoint assembler & anomaly detector
│   │   ├── multi_frame_fusion.py              # Track observation aggregator & majority-vote fusion
│   │   ├── ocr.py                             # EasyOCR wrapper & Indian plate char confusables corrector
│   │   ├── plate_detector.py                  # YOLOv8n license plate detector loader & inferencer
│   │   ├── plate_preprocessor.py              # CLAHE contrast enhancement & unsharp masking
│   │   ├── reid.py                            # ResNet50 (2048-dim) appearance embedding extractor & HSV fallback
│   │   ├── tracker.py                         # Ultralytics ByteTrack per-camera multi-object tracker
│   │   ├── traffic_analytics.py               # Junction congestion & flow velocity statistical aggregator
│   │   ├── trajectory_predictor.py            # Spatial Markov chain transition predictor & ETA estimator
│   │   ├── vehicle_detector.py                # YOLOv8s vehicle detector (COCO classes 2, 3, 5, 7)
│   │   └── watchlist_manager.py               # Security hotlist registry & anti-spoofing alert engine
│   ├── assets/                                # Static sample frames and vehicle sprites
│   │   ├── cam11_frame0.jpg
│   │   └── vehicle_sprites/
│   │       ├── bus_0.jpg, bus_1.jpg, bus_2.jpg
│   │       └── car_0.jpg, car_1.jpg, car_2.jpg
│   ├── models/                                # Model weight placeholders
│   │   ├── .gitignore
│   │   ├── haarcascade_russian_plate_number.xml # Deprecated Haar cascade file (orphan asset)
│   │   └── README.md                          # Documentation of weights download strategy
│   ├── services/                              # Pipeline orchestration & data persistence
│   │   ├── __init__.py
│   │   ├── multi_camera_orchestrator.py       # Multi-feed coordinator across camera agents
│   │   ├── redis_service.py                   # Async Redis client with in-memory dict fallback
│   │   └── video_pipeline.py                  # Single-camera feed ingestion pipeline & CameraAgent
│   └── utils/
│       ├── __init__.py
│       └── plate_normalizer.py                # Regex-based Indian plate cleaner & validator
├── backend/                                   # Java 21 Spring Boot 3.3.4 Backend
│   ├── .dockerignore
│   ├── .gitignore
│   ├── Dockerfile                             # Multi-stage Maven 3.9 + Temurin 21 JRE container
│   ├── pom.xml                                # Maven build descriptor and dependencies
│   └── src/
│       ├── main/
│       │   ├── java/com/cityai/backend/
│       │   │   ├── BackendApplication.java    # Spring Boot entry point
│       │   │   ├── analytics/
│       │   │   │   └── AnalyticsService.java  # City-wide traffic metrics & trajectory routing stats
│       │   │   ├── config/
│       │   │   │   ├── CorsConfig.java        # Cross-Origin Resource Sharing configuration
│       │   │   │   ├── EvidenceResourceConfig.java # WebMvc handler serving /evidence/** static files
│       │   │   │   └── RedisConfig.java       # RedisTemplate, cache manager & Pub/Sub topic setup
│       │   │   ├── controller/
│       │   │   │   ├── AiProxyController.java # Reverse-proxy to Python AI service with fallback mocks
│       │   │   │   ├── AnalyticsController.java # GET /api/analytics/overview
│       │   │   │   ├── ApiExceptionHandler.java # Global REST exception handler
│       │   │   │   ├── AuditController.java   # GET /api/audit/recent (HTTP Basic auth protected)
│       │   │   │   ├── CameraController.java  # GET /api/cameras, GET /api/cameras/{id}, GET /api/cameras/nearby
│       │   │   │   ├── DetectionController.java # POST /api/detections/ingest & batch ingest (HTTP Basic auth)
│       │   │   │   ├── HealthController.java  # GET /api/health (system and Redis liveness check)
│       │   │   │   ├── TrajectoryController.java # GET /api/vehicles/{plate}/trajectory
│       │   │   │   └── VehicleController.java # GET /api/vehicles/{plate} & detections
│       │   │   ├── dto/                   # Data Transfer Objects (Records)
│       │   │   │   ├── AnalyticsOverviewDto.java
│       │   │   │   ├── AuditLogEntryDto.java
│       │   │   │   ├── CameraDto.java
│       │   │   │   ├── DetectionIngestRequest.java
│       │   │   │   ├── TrajectoryPointDto.java
│       │   │   │   ├── TrajectoryResponseDto.java
│       │   │   │   ├── VehicleDetectionDto.java
│       │   │   │   ├── VehicleDto.java
│       │   │   │   └── VehicleSummaryDto.java
│       │   │   ├── model/                 # JPA Entities
│       │   │   │   ├── AuditLogEntry.java     # audit_log_entries table
│       │   │   │   ├── Camera.java            # cameras table
│       │   │   │   ├── Vehicle.java           # vehicles table
│       │   │   │   └── VehicleDetection.java  # vehicle_detections table
│       │   │   ├── repository/            # Spring Data JPA Repositories
│       │   │   │   ├── AuditLogRepository.java
│       │   │   │   ├── CameraRepository.java
│       │   │   │   ├── VehicleDetectionRepository.java
│       │   │   │   └── VehicleRepository.java
│       │   │   ├── security/              # Security and Rate Limiting
│       │   │   │   ├── RedisRateLimiterFilter.java # IP-based Redis token bucket rate limiter (300 req/min)
│       │   │   │   └── SecurityConfig.java    # Spring Security HTTP Basic filter chain
│       │   │   ├── service/               # Business Service Layer
│       │   │   │   ├── AuditLogService.java   # Ingestion of audit records
│       │   │   │   ├── CameraRecord.java      # Jackson deserialization record
│       │   │   │   ├── DataSeedService.java   # CommandLineRunner seeding cameras from cameras.json
│       │   │   │   ├── DetectionIngestionService.java # Storing detections, cache eviction & Redis publish
│       │   │   │   ├── MockVehicleRegistryService.java # Mock RTO registry with deterministic hash generator
│       │   │   │   ├── RedisPubSubService.java # Pub/Sub detection listener and latency prober
│       │   │   │   ├── VehicleRegistryRecord.java # Record metadata DTO
│       │   │   │   └── VehicleRegistryService.java # Lookup interface
│       │   │   ├── spatial/               # PostGIS Integration
│       │   │   │   ├── PostGisMigrationRunner.java # Idempotent DDL creating PostGIS geography columns
│       │   │   │   └── SpatialCameraService.java # ST_DWithin + KNN queries (@Profile("postgres"))
│       │   │   ├── trajectory/            # Route Scoring and Reconstruction Engine
│       │   │   │   ├── CameraGraph.java       # In-memory camera node distance/bearing graph
│       │   │   │   ├── GeoUtils.java          # Great-circle distance & bearing math
│       │   │   │   ├── TrajectoryEngine.java  # Detection grouper & trajectory reconstructor (has mock fallback)
│       │   │   │   └── TrajectoryScoringService.java # 5-signal heuristic scoring (Appearance score hardcoded)
│       │   │   ├── util/
│       │   │   │   └── PlateNormalizer.java   # Static regex plate standardizer
│       │   │   └── websocket/             # Real-time WebSocket handlers
│       │   │       ├── LiveTrackingWebSocketHandler.java # Paced replay simulation of pre-computed route
│       │   │       └── WebSocketConfig.java   # Registers /ws/live/{plate} handler
│       │   └── resources/
│       │       ├── application.yml            # Default configuration (H2 in-memory, Render AI fallback)
│       │       └── application-postgres.yml   # Production datasource profile (PostgreSQL + PostGIS)
│       └── test/java/com/cityai/backend/
│           ├── trajectory/
│           │   ├── GeoUtilsTest.java
│           │   └── TrajectoryScoringServiceTest.java
│           └── util/
│               └── PlateNormalizerTest.java
├── data/                                      # Static datasets & camera definitions
│   ├── .gitignore
│   ├── cameras.json                           # 12 Pune camera junction definitions
│   ├── vehicles.json                          # 9 mock vehicle records
│   └── dataset_samples/                       # Sample test imagery
│       ├── gt/                                # 5 ground-truth images (1.jpg, 10.jpg, 100.JPG, 1000.JPG, 1001.JPG)
│       └── hazy/                              # 5 synthetic hazy images (1.png, 10.png, 100.png, 1000.png, 1001.png)
├── docs/                                      # System documentation & diagrams
├── frontend/                                  # Next.js 16 (App Router) + React 19 Frontend
│   ├── .dockerignore
│   ├── .gitignore
│   ├── Dockerfile                             # Multi-stage Node 22 build with standalone output
│   ├── eslint.config.mjs
│   ├── next.config.ts                         # Rewrites proxying /api/*, /ws/*, /evidence/* to backend
│   ├── package.json                           # Dependencies (Next 16.3.4, React 19.2.8, MapLibre GL 6.6.0)
│   ├── package-lock.json
│   ├── postcss.config.mjs
│   ├── tsconfig.json
│   ├── vercel.json
│   ├── public/                                # Static web assets (MISSING videos/ folder!)
│   │   ├── file.svg, globe.svg, next.svg, vercel.svg, window.svg
│   └── src/
│       ├── app/
│       │   ├── favicon.ico
│       │   ├── globals.css                    # Tailwind CSS v4 directives & theme styles
│       │   ├── layout.tsx                     # Root HTML wrapper & metadata
│       │   ├── page.tsx                       # Single-page dashboard container (Investigation vs Analytics)
│       │   └── api/
│       │       ├── vahan/[plate]/
│       │       │   └── route.ts               # Next.js route calling RapidAPI VAHAN (with hardcoded keys & bypass)
│       │       └── yolo/detect/
│       │           └── route.ts               # Next.js route forwarding base64 frame to localhost:8000/detect-plate
│       ├── components/                        # UI Components
│       │   ├── AnalyticsDashboard.tsx         # City traffic metrics, charts & busiest intersections
│       │   ├── ConfidenceBadge.tsx            # Color-coded confidence pill
│       │   ├── DetectionTimeline.tsx          # Vertical checkpoint list of camera visits
│       │   ├── EvidenceViewer.tsx             # CCTV frame display, real-time client canvas ML inferencer
│       │   ├── InteractiveTrajectoryPlayer.tsx # Scrubbing timeline player with speed controls
│       │   ├── InvestigationDashboard.tsx     # 3-column primary dashboard layout & search coordinator
│       │   ├── InvestigationMap.tsx           # MapLibre GL vector map with Google raster tiles & OSRM lines
│       │   ├── LiveCameraGridModal.tsx        # 12-camera matrix surveillance modal (simulated UI)
│       │   ├── PdfReportExporter.tsx          # jsPDF client-side investigation dossier generator
│       │   ├── SecurityWatchlistModal.tsx     # Watchlist editor & active alert listing
│       │   ├── SystemBootLoader.tsx           # High-tech animated diagnostic boot sequence modal
│       │   ├── SystemStatusBar.tsx            # Top header HUD showing API & Redis connectivity, clock
│       │   ├── TiltCard3D.tsx                 # Mouse-tracking 3D card tilt effect wrapper
│       │   ├── TrajectoryPredictionCard.tsx   # Next-junction probability ranker (hardcoded fallback)
│       │   ├── VehicleHologram3D.tsx          # HTML5 Canvas 3D wireframe car rotator
│       │   ├── VehicleIntelligencePanel.tsx   # Vehicle metadata, RC status, 3D hologram container
│       │   ├── VehicleRegistryModal.tsx       # Modal popup for Indian VAHAN RC search
│       │   ├── VehicleRegistrySection.tsx     # In-page collapsible card for VAHAN RC details
│       │   ├── VehicleSearchPanel.tsx         # HSRP-styled plate input box with preset demo buttons
│       │   └── VideoIngestionModal.tsx        # 4-camera CCTV corridor upload modal (simulated progress)
│       └── lib/
│           ├── api.ts                         # REST fetch client with hardcoded fallback constants
│           ├── format.ts                      # Date, duration, and metric formatting utilities
│           ├── generateRcPdf.ts               # jsPDF generator for Official Form 23 RC Certificate
│           ├── liveClient.ts                  # Native WebSocket client connecting to /ws/live/{plate}
│           ├── registry.ts                    # Hardcoded demo records (ET3633P) & VAHAN query handler
│           └── routing.ts                     # OSRM road coordinate fetcher with spline fallback
├── project-learning-documentation/            # Educational guides, PDF builders, syllabi
├── scripts/                                   # Automation, training, and benchmarking scripts
│   ├── evaluate_pipeline.py                   # OCR and color classifier accuracy test script
│   ├── extract_vehicle_sprites.py             # Crop extractor for vehicle sprite thumbnails
│   ├── generate_demo_footage.py               # Video synthesis utility
│   ├── generate_ml_pdf.py                     # Reportlab ML architecture documentation builder
│   ├── generate_pdf_doc.py                    # Reportlab learning guide PDF builder
│   ├── prepare_plate_dataset.py               # Dataset format conversion
│   ├── process_video.py                       # CLI script ingesting video into backend via REST API
│   ├── run_sih_demo.py                        # Terminal demo launcher printing URLs
│   ├── smoke_test.sh                          # Curl verification script
│   ├── test_sih26127_features.py              # Unit check for multi-camera orchestrator
│   └── train_plate_detector.py                # YOLOv8 training script for license plate model
├── videos/                                    # Raw MP4 video files (~120KB each)
│   ├── CAM-01.mp4 ... CAM-11.mp4              # 11 short junction video clips
│   ├── source_traffic_1.mp4                   # 2.8 MB background traffic clip
│   └── source_traffic_2.mp4                   # 6.0 MB background traffic clip
├── docker-compose.yml                         # Multi-container orchestration (db, redis, backend, ai-service, frontend)
├── package.json                               # Monorepo root workspace descriptor
├── package-lock.json
├── README.md                                  # Repository documentation
├── GETTING_STARTED.md
├── full_system_documentation.md
├── vercel.json                                # Vercel deployment routing rules
└── yolov8n.pt                                 # 6.5 MB root-level YOLOv8n pretrained weights
```

---

## 2. Technology Stack & Exact Versions

| Component Layer | Technology | Declared Version | Configuration File Reference |
| :--- | :--- | :--- | :--- |
| **Frontend Framework** | Next.js (App Router) | `16.3.4` | `frontend/package.json#L16` |
| **Frontend UI Library** | React / React DOM | `19.2.8` | `frontend/package.json#L17-L18` |
| **Map Rendering Engine** | MapLibre GL | `6.6.0` | `frontend/package.json#L15` |
| **Animation Framework** | Framer Motion | `13.1.1` | `frontend/package.json#L13` |
| **PDF Generation** | jsPDF | `4.2.1` | `frontend/package.json#L14` |
| **CSS Styling Engine** | Tailwind CSS / PostCSS | `^4.0.0` | `frontend/package.json#L27` |
| **Language Runtime (FE)** | TypeScript | `^5.0.0` | `frontend/package.json#L28` |
| **Backend Framework** | Spring Boot | `3.3.4` | `backend/pom.xml#L10` |
| **Language Runtime (BE)** | Java | `21` | `backend/pom.xml#L21` |
| **Backend ORM** | Spring Data JPA / Hibernate | `3.3.4` | `backend/pom.xml#L31` |
| **Default Database** | H2 Database (in-memory) | Runtime scoped | `backend/pom.xml#L42-L45` |
| **Production Database** | PostgreSQL Driver | Runtime scoped | `backend/pom.xml#L50-L53` |
| **Production GIS** | PostGIS | `16-3.4` | `docker-compose.yml#L3` |
| **Cache & Pub/Sub** | Spring Data Redis (Lettuce) | `3.3.4` | `backend/pom.xml#L55-L57` |
| **Backend Security** | Spring Security | `3.3.4` | `backend/pom.xml#L68` |
| **WebSocket** | Spring Boot WebSocket | `3.3.4` | `backend/pom.xml#L39` |
| **AI Web Framework** | FastAPI | `0.115.0` | `ai-service/requirements.txt#L1` |
| **ASGI Server** | Uvicorn (standard) | `0.30.6` | `ai-service/requirements.txt#L2` |
| **HTTP Client (Python)** | Requests | `2.34.2` | `ai-service/requirements.txt#L3` |
| **Data Validation** | Pydantic | `>=2.0.0` | `ai-service/requirements.txt#L4` |
| **Async Redis Client** | Redis-py | `>=5.0.0` | `ai-service/requirements.txt#L5` |
| **Object Detection & Tracking**| Ultralytics YOLOv8 | `8.4.138` | `ai-service/requirements.txt#L8` |
| **ByteTrack Solver** | Lap (Linear Assignment Problem)| `0.5.13` | `ai-service/requirements.txt#L9` |
| **OCR Engine** | EasyOCR | `1.7.2` | `ai-service/requirements.txt#L10` |
| **Image Processing** | OpenCV Python Headless | `4.10.0.84` | `ai-service/requirements.txt#L11` |
| **Deep Learning Runtime** | PyTorch / Torchvision | `>=2.0.0 / >=0.15.0`| `ai-service/requirements.txt#L12-L13` |
| **Numerical Processing**| NumPy | `>=1.24.0` | `ai-service/requirements.txt#L14` |

---

## 3. Application Entry Points

### 3.1 Frontend Entry Points
1. **Root Layout**: [`frontend/src/app/layout.tsx`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/layout.tsx#L1-L32)
   - Injects global styles (`globals.css`), metadata, and viewport settings.
2. **Main Application Page**: [`frontend/src/app/page.tsx`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/page.tsx#L1-L89)
   - Client component hosting top navigation tabs, `SystemStatusBar`, `SystemBootLoader`, and conditionally rendering `InvestigationDashboard` or `AnalyticsDashboard`.
3. **Next.js Serverless API Routes**:
   - `GET /api/vahan/[plate]`: [`frontend/src/app/api/vahan/[plate]/route.ts`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L222-L365) — Calls RapidAPI VAHAN registry service or local demo cache.
   - `POST /api/yolo/detect`: [`frontend/src/app/api/yolo/detect/route.ts`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/yolo/detect/route.ts#L3-L40) — Forwards client canvas frames to `http://localhost:8000/detect-plate`.

### 3.2 Backend Entry Point
1. **Spring Boot Main**: [`backend/src/main/java/com/cityai/backend/BackendApplication.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/BackendApplication.java#L10-L16)
   - Standard `@SpringBootApplication` class with `SpringApplication.run(BackendApplication.class, args)`.
2. **Startup Lifecycle Runners**:
   - [`DataSeedService.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/DataSeedService.java#L36-L57): Implements `CommandLineRunner`. Loads `data/cameras.json` into the `cameras` database table if table is empty.
   - [`PostGisMigrationRunner.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/spatial/PostGisMigrationRunner.java#L42-L58): Implements `ApplicationRunner` under `@Profile("postgres")`. Runs `CREATE EXTENSION IF NOT EXISTS postgis` and generates spatial geometry columns and GiST indexes.
   - [`MockVehicleRegistryService.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/MockVehicleRegistryService.java#L33-L53): Executes `@PostConstruct load()` to load `data/vehicles.json` into memory.

### 3.3 AI Microservice Entry Point
1. **FastAPI Application**: [`ai-service/main.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L33-L73)
   - Created via `app = FastAPI(...)`. Runs with Uvicorn `main:app --host 0.0.0.0 --port 8000`.
   - On startup event `@app.on_event("startup")`, calls `await redis_service.initialize()`.

### 3.4 Standalone Scripts & Utilities
1. **Video Ingestion Pipeline CLI**: [`scripts/process_video.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/scripts/process_video.py#L53-L108)
   - Directly imports `VideoPipeline` and iterates over video frames, posting detections to `POST /api/detections/ingest`.
2. **SIH Hackathon Presentation Launcher**: [`scripts/run_sih_demo.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/scripts/run_sih_demo.py#L47-L92)
   - Instantiates `MultiCameraOrchestrator`, adds 4 hardcoded cameras, seeds one watchlist entry, and prints summary URLs.
3. **Pipeline Accuracy Evaluator**: [`scripts/evaluate_pipeline.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/scripts/evaluate_pipeline.py#L40-L126)
   - Evaluates EasyOCR, PlateDetector, and ColorClassifier on images in `data/dataset_samples/gt`.

---

## 4. Main Modules, Classes, Functions & Responsibilities

### 4.1 Backend (`com.cityai.backend`)
- **`controller.CameraController`**: Endpoints for listing all cameras, getting single camera details, and spatial radius search (`/nearby`).
- **`controller.VehicleController`**: Lookup of vehicle summary (`/api/vehicles/{plate}`) and historical detections (`/api/vehicles/{plate}/detections`). Contains hardcoded fallback data if detections are empty.
- **`controller.TrajectoryController`**: Calls `TrajectoryEngine` to reconstruct multi-camera paths.
- **`controller.DetectionController`**: Ingestion endpoint (`/api/detections/ingest`) for AI service outputs, secured by HTTP Basic auth.
- **`controller.AnalyticsController`**: Returns city-wide traffic stats, top routes, and average speed (`/api/analytics/overview`).
- **`controller.AiProxyController`**: Proxies `/watchlist`, `/security-alerts`, `/process-video`, and `/predict-trajectory` to Python AI service, returning hardcoded static fallbacks on failure.
- **`controller.AuditController`**: Exposes `/api/audit/recent` for queries made to vehicle search and trajectory reconstruction.
- **`trajectory.TrajectoryEngine`**: Groups raw frame-level detections by camera, evaluates transition plausibility via `TrajectoryScoringService`, and fabricates fallback demo trajectories when no records exist.
- **`trajectory.TrajectoryScoringService`**: Evaluates kinematic feasibility, distance, direction, and plate match. Hardcodes appearance Re-ID score to `0.6`.
- **`websocket.LiveTrackingWebSocketHandler`**: Accepts WebSocket connections on `/ws/live/{plate}` and replays pre-computed trajectory waypoints every 3 seconds using `ScheduledExecutorService`.
- **`service.MockVehicleRegistryService`**: Queries `data/vehicles.json` or deterministically hashes the plate number to generate synthetic vehicle records on the fly.
- **`security.RedisRateLimiterFilter`**: Servlet filter enforcing sliding-window rate limits (300 req/min) per client IP using Redis.

### 4.2 AI Microservice (`ai-service`)
- **`ai.vehicle_detector.VehicleDetector`**: Loads YOLOv8s and detects COCO vehicle classes (car, motorcycle, bus, truck).
- **`ai.plate_detector.PlateDetector`**: Attempts to load fine-tuned plate model, falls back to HuggingFace pretrained model, and last resort to `yolov8n.pt`.
- **`ai.tracker.VehicleTracker`**: Wraps Ultralytics ByteTrack algorithm to track vehicles per camera across video frames.
- **`ai.ocr.OCRService`**: Integrates EasyOCR with character-level confusable correction for Indian registration formats.
- **`ai.reid.ReIdService`**: Extracts 2048-dimensional embeddings using ResNet50 avgpool layer, with HSV 960-dim histogram fallback.
- **`ai.color_classifier.ColorClassifier`**: Runs HSV K-means clustering on the upper 2/3 of vehicle crops to classify body colors into 10 categories.
- **`ai.dehazer.ImageDehazer`**: Dark Channel Prior (DCP) algorithm for atmospheric light removal. (**Uninvoked in video processing pipeline**).
- **`ai.identity_scorer.IdentityScorer`**: Calculates composite identity score across 6 weighted signals.
- **`ai.global_vehicle_registry.GlobalVehicleRegistry`**: In-memory registry associating local camera track observations to global vehicle IDs (`VEH-GLOBAL-XXXX`).
- **`ai.journey_reconstructor.JourneyReconstructor`**: Assembles chronologically ordered waypoints and flags speed anomalies (>150 km/h) or duplicate concurrent sightings.
- **`ai.trajectory_predictor.TrajectoryPredictor`**: Spatial Markov transition model predicting next-hop junctions based on historical transitions or inverse distance.
- **`ai.watchlist_manager.WatchlistManager`**: In-memory store for hotlisted stolen/wanted plates. Seeds `MH15TC554` and `KL55R2473` on initialization.
- **`services.multi_camera_orchestrator.MultiCameraOrchestrator`**: Coordinates multiple camera feeds simultaneously using a `ThreadPoolExecutor`.
- **`services.video_pipeline.CameraAgent`**: Processes single video feed, extracting vehicle crops, color, Re-ID vectors, plates, and saving evidence images.

### 4.3 Frontend (`frontend/src`)
- **`components/InvestigationDashboard.tsx`**: Primary UI coordinator linking search panel, interactive map, timeline, and CCTV evidence viewer.
- **`components/InvestigationMap.tsx`**: Renders 12 camera locations and trajectory paths using MapLibre GL with Google raster tiles and OSRM real-road geometry.
- **`components/EvidenceViewer.tsx`**: Renders active CCTV checkpoint; runs offscreen HTML5 canvas grab to call `/api/yolo/detect` every 260ms when video is present.
- **`components/VehicleSearchPanel.tsx`**: Search input formatted like an Indian HSRP license plate with quick-select scenario buttons.
- **`components/VehicleIntelligencePanel.tsx`**: Displays detection metrics, Form 23 RC details, and container for 3D wireframe car model.
- **`components/VehicleHologram3D.tsx`**: Canvas-rendered 3D wireframe vehicle model with manual rotation and scanning laser animations.
- **`components/VideoIngestionModal.tsx`**: UI modal simulating 4-camera corridor ingestion with mocked percentage increments.
- **`components/LiveCameraGridModal.tsx`**: Mock 12-camera matrix displaying fake tracking boxes and telemetry.
- **`components/SecurityWatchlistModal.tsx`**: Displays active security alerts and hotlist entries.
- **`components/AnalyticsDashboard.tsx`**: Traffic statistics, hourly distribution, and top routes.
- **`lib/api.ts`**: HTTP client with fallback constants (`DEMO_ANALYTICS`, `DEMO_TRAJECTORY`, `DEMO_SUMMARY`, `SEED_CAMERAS`).
- **`lib/registry.ts`**: Form 23 RC certificate metadata mapping and demo record cache.
- **`lib/liveClient.ts`**: WebSocket client connecting to `/ws/live/{plate}`.

---

## 5. Configuration Files & Environment Variables

### 5.1 Root Level Configuration
- **`docker-compose.yml`**: Defines five services: `db`, `redis`, `backend`, `ai-service`, `frontend`.
- **`package.json`**: Root monorepo workspace containing `frontend`.
- **`vercel.json`**: Defines root routing rules for Vercel deployment.

### 5.2 Backend Configuration (`backend/src/main/resources/application.yml`)
| Environment Variable | Default Value | Description |
| :--- | :--- | :--- |
| `DB_URL` | `jdbc:h2:mem:cityaidb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL` | JDBC connection URL |
| `DB_DRIVER` | `org.h2.Driver` | JDBC driver class |
| `DB_USERNAME` | `sa` | Database username |
| `DB_PASSWORD` | *(empty)* | Database password |
| `DB_DIALECT` | `org.hibernate.dialect.H2Dialect` | Hibernate SQL dialect |
| `REDIS_HOST` | `localhost` | Redis server hostname |
| `REDIS_PORT` | `6379` | Redis server port |
| `REDIS_PASSWORD`| *(empty)* | Redis authentication password |
| `CACHE_TYPE` | `redis` | Spring cache abstraction provider |
| `RATE_LIMIT_ENABLED` | `true` | Enables Redis sliding window rate limiting |
| `RATE_LIMIT_RPM` | `300` | Allowed requests per minute per IP |
| `SERVER_PORT` | `8080` | Spring Boot HTTP port |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,https://sih-project-frontend-dzro.vercel.app` | Allowed CORS origins |
| `INGEST_USERNAME` | `ingest` | HTTP Basic username for POST `/api/detections/**` |
| `INGEST_PASSWORD` | `change-me-in-production` | HTTP Basic password for POST `/api/detections/**` |
| `AI_SERVICE_URL` | `https://city-ai-engine.onrender.com` | Base URL of Python AI microservice |
| `DATA_DIR` | `../data` | Path to static data directory |
| `EVIDENCE_DIR` | `../data/evidence` | Directory where AI evidence frames are served from |

### 5.3 Backend PostgreSQL Profile (`application-postgres.yml`)
| Variable | Value | Notes |
| :--- | :--- | :--- |
| `spring.datasource.url` | `${DB_URL:jdbc:postgresql://localhost:5432/cityai}` | Active when `SPRING_PROFILES_ACTIVE=postgres` |
| `spring.datasource.driver-class-name` | `org.postgresql.Driver` | |
| `spring.datasource.username` | `${DB_USERNAME:cityai}` | |
| `spring.datasource.password` | `${DB_PASSWORD:cityai_dev_password}` | |
| `spring.jpa.properties.hibernate.dialect` | `org.hibernate.dialect.PostgreSQLDialect` | Enables PostGIS spatial support |

### 5.4 AI Microservice Configuration (`ai-service/config.py`)
- `REDIS_HOST`: Environment variable, defaults to `localhost` (`services/redis_service.py`).
- `REDIS_PORT`: Environment variable, defaults to `6379` (`services/redis_service.py`).
- `cfg.models.vehicle_detector`: `ai-service/models/yolov8s.pt`.
- `cfg.models.plate_detector`: `ai-service/models/plate_detector_yolov8n.pt`.
- `cfg.models.plate_detector_pretrained_id`: `keremberke/yolov8n-license-plate-detection`.
- `cfg.detection.vehicle_confidence_threshold`: `0.35`.
- `cfg.detection.plate_confidence_threshold`: `0.30`.
- `cfg.tracking.frame_stride`: `5`.
- `cfg.tracking.plate_sample_stride`: `3`.
- `cfg.ocr.min_confidence`: `0.30`.
- `cfg.identity.weight_plate`: `0.40`.
- `cfg.identity.weight_reid`: `0.30`.
- `cfg.identity.weight_color`: `0.12`.
- `cfg.identity.weight_type`: `0.10`.
- `cfg.identity.weight_temporal`: `0.05`.
- `cfg.identity.weight_topology`: `0.03`.

### 5.5 Frontend Configuration
- `NEXT_PUBLIC_API_BASE_URL`: Environment variable pointing to Spring Boot backend (`http://localhost:8080` locally, `https://sih-project-62k1.onrender.com` in production).
- `NEXT_PUBLIC_AI_SERVICE_URL`: Environment variable pointing to Python microservice (`http://localhost:8000` locally, `https://city-ai-engine.onrender.com` in production).
- `RAPIDAPI_VAHAN_KEY`: Optional override for RapidAPI VAHAN key (hardcoded fallback keys present in code).
- `NEXT_OUTPUT_STANDALONE`: Set to `true` inside Docker builds to enable Next.js standalone server output.

---

## 6. Build, Deployment & Docker Configuration

### 6.1 Docker Compose Specification (`docker-compose.yml`)
1. **`db`**:
   - Image: `postgis/postgis:16-3.4`
   - Exposed Port: `5432:5432`
   - Volume: `db-data:/var/lib/postgresql/data`
   - Healthcheck: `pg_isready -U cityai -d cityai`
2. **`redis`**:
   - Image: `redis:7-alpine`
   - Exposed Port: `6379:6379`
   - Volume: `redis-data:/data`
   - Healthcheck: `redis-cli ping`
3. **`backend`**:
   - Build Context: `./backend` (Multi-stage build)
   - Depends On: `db` (healthy), `redis` (healthy)
   - Exposed Port: `8080:8080`
   - Volumes: `./data:/data`
   - Environment: `SPRING_PROFILES_ACTIVE=postgres`, `DB_URL=jdbc:postgresql://db:5432/cityai`, `AI_SERVICE_URL=http://ai-service:8000`
4. **`ai-service`**:
   - Build Context: `./ai-service`
   - Depends On: `redis` (healthy)
   - Exposed Port: `8000:8000`
   - Volumes: `./videos:/app/videos:ro`, `./data:/data`, `ai-models:/app/models`
5. **`frontend`**:
   - Build Context: `./frontend`
   - Build Args: `NEXT_PUBLIC_API_BASE_URL=http://localhost:8080`
   - Depends On: `backend`
   - Exposed Port: `3000:3000`
   - **Defect Noted**: Does not mount `./videos` volume, meaning `/videos/*.mp4` requests to frontend will 404.

### 6.2 Dockerfiles Analysis
1. **`backend/Dockerfile`**:
   - Stage 1: `maven:3.9-eclipse-temurin-21 AS build` -> `mvn -q -B dependency:go-offline` -> `mvn -q -B package -DskipTests`.
   - Stage 2: `eclipse-temurin:21-jre-jammy` -> Non-root user `appuser` -> Copies `backend-*.jar` -> `ENTRYPOINT ["java", "-jar", "app.jar"]`.
2. **`ai-service/Dockerfile`**:
   - Base: `python:3.11-slim` -> Installs `libgl1`, `libglib2.0-0` (required for headless OpenCV) -> `pip install -r requirements.txt`.
   - Non-root user `appuser` created -> `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]`.
3. **`frontend/Dockerfile`**:
   - Stage 1: `node:22-slim AS build` -> `npm ci` -> `npm run build`.
   - Stage 2: `node:22-slim` -> Non-root user `appuser` -> Copies `.next/standalone` and `.next/static` -> `CMD ["node", "server.js"]`.
   - Note: Requires `NEXT_OUTPUT_STANDALONE=true` during build to generate standalone directory.

