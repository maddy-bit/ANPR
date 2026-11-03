# SIH26127 City AI Traffic Intelligence & Multi-Camera Vehicle Investigation Platform

[![Evaluator Demo Status](https://img.shields.io/badge/Evaluator%20Demo-PASSED-brightgreen.svg)]()
[![Java 21](https://img.shields.io/badge/Java-21%20LTS-orange.svg)]()
[![Spring Boot](https://img.shields.io/badge/Spring%20Boot-3.2.5-brightgreen.svg)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-0.110+-teal.svg)]()
[![Next.js](https://img.shields.io/badge/Next.js-16%20Turbopack-black.svg)]()
[![PyTorch](https://img.shields.io/badge/PyTorch-2.0+-red.svg)]()
[![OpenCV](https://img.shields.io/badge/OpenCV-4.10+-blue.svg)]()

> **SIH Problem Statement SIH26127:** City-Wide Multi-Camera Vehicle Intelligence, Automated Number Plate Recognition (ANPR), Spatial-Temporal Trajectory Reconstruction, and Re-Identification Engine for Urban Traffic Surveillance.
> **Sponsor / Organization:** Bharat Electronics Limited (BEL).

---

## 1. System Architecture

The platform is engineered as a decoupled, resilient microservices system:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   NEXT.JS 16 FRONTEND (Port 3000)                      │
│   • MapLibre GL Vector Map               • Target Investigation Dossier │
│   • Video Ingestion Modal with Real Telemetry • Evidence Crop Viewer   │
│   • Multi-Camera Checkpoint Timeline     • Trajectory Playback Controls │
└───────────────────────┬────────────────────────────┬───────────────────┘
                        │ HTTP / WebSocket           │ HTTP / REST
                        ▼                            ▼
┌────────────────────────────────────────┐  ┌────────────────────────────┐
│      SPRING BOOT BACKEND (Port 8080)   │  │   FASTAPI AI (Port 8000)   │
│ • System of Record (H2 / PostgreSQL)   │  │ • YOLOv8s Vehicle Detector │
│ • Kinematic & Speed Feasibility Engine │  │ • ByteTrack Tracker        │
│ • Haversine Velocity Verification      │  │ • Plate Crop & EasyOCR     │
│ • Re-ID Vector Persistence             │  │ • ResNet50 Re-ID (2048-d)  │
│ • Evidence Frame HTTP Server           │  │ • DCP Smog/Fog Dehazer     │
│ • Audit Logging & Auth Gating          │  │ • Markov Route Predictor   │
└───────────────────▲────────────────────┘  └─────────────┬──────────────┘
                    │                                     │
                    └────────── Synced Detections ────────┘
```

---

## 2. Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Frontend** | Next.js 16 (App Router, Turbopack), React 19, TypeScript, Tailwind CSS, Framer Motion, MapLibre GL |
| **Backend** | Java 21 LTS, Spring Boot 3.2.5, Spring Data JPA, Hibernate Spatial, Spring Security, Spring WebSocket |
| **Database** | Embedded H2 (instant zero-config local demo) / PostgreSQL 16 + PostGIS 3.4 (production profile) |
| **AI / Computer Vision** | Python 3.12, FastAPI, PyTorch, Ultralytics YOLOv8s, ByteTrack, EasyOCR, OpenCV, ResNet50, NumPy |
| **Packaging & CI** | Docker, Multi-Stage Dockerfiles, Docker Compose, PowerShell Orchestration Scripts |

---

## 3. Real AI Pipeline & Model Roles

| AI Model / Service | Implementation File | Role & Operational Responsibility |
| :--- | :--- | :--- |
| **YOLOv8s Vehicle Detector** | `ai-service/ai/detector.py` | Detects vehicle bounding boxes (cars, buses, trucks, motorcycles) on raw video frames. |
| **ByteTrack Tracker** | `ai-service/ai/tracker.py` | Assigns consistent local track IDs across frames; resolves occlusions and prevents duplicate records. |
| **Plate Detector & EasyOCR** | `ai-service/ai/ocr.py` | Localizes license plates and applies alphanumeric recognition with character-level confidence gating. |
| **ResNet50 Re-ID Extractor** | `ai-service/ai/reid.py` | Generates 2048-dimensional L2-normalized visual appearance embeddings for cross-camera vehicle matching without plates. |
| **Dark Channel Prior (DCP)** | `ai-service/ai/dehaze.py` | Physical atmospheric scattering model (He et al.) to remove smog, fog, or nighttime CCTV glare. |
| **Kinematic Trajectory Scorer** | `TrajectoryScoringService.java` | Verifies physical velocity ($v \le 150$ km/h), topological camera adjacency, and appearance similarity. |
| **Markov Route Predictor** | `ai-service/ai/predictor.py` | Spatial probability model predicting the next camera junction a target vehicle is likely to visit. |

---

## 4. Single-Command Demo Startup & Shutdown

### 🚀 Launch Platform
From an administrative or standard PowerShell terminal:
```powershell
.\START_DEMO.ps1
```
The startup controller automatically:
1. Validates Python venv, Java 21 JDK, Maven, and Node.js.
2. Checks port availability on 8000, 8080, and 3000.
3. Spawns all three services in background daemon processes.
4. Polls service health checks until all three respond `READY (HTTP 200)`.
5. Opens `http://localhost:3000` in your default browser.

### 🛑 Stop Platform
To cleanly shut down all services, release listening ports, and terminate daemon processes:
```powershell
.\STOP_DEMO.ps1
```

---

## 5. Manual Local Setup Instructions

If you prefer to start each service manually in separate terminal windows:

### Prerequisites
- **Java 21+** (`java -version`)
- **Maven 3.9+** (`mvn -v` or use bundled `tools/apache-maven-3.9.6`)
- **Python 3.10+** (`python --version`)
- **Node.js 18+** (`node -v`)

### Terminal 1: AI Service (FastAPI)
```powershell
cd "c:\Users\Asus\OneDrive\Desktop\ai traffic"
.\ai-service\venv\Scripts\uvicorn.exe main:app --app-dir ai-service --host 127.0.0.1 --port 8000
```
*Health Check:* `curl http://localhost:8000/health` $\rightarrow$ `{"status":"ok"}`

### Terminal 2: Backend (Spring Boot)
```powershell
cd "c:\Users\Asus\OneDrive\Desktop\ai traffic"
$env:JAVA_HOME = "C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$((Get-Item tools/apache-maven-3.9.6/bin).FullName);$env:PATH"
$env:CACHE_TYPE = "none"
$env:AI_SERVICE_URL = "http://localhost:8000"
mvn spring-boot:run -f backend/pom.xml
```
*Health Check:* `curl http://localhost:8080/api/health` $\rightarrow$ `{"status":"ok"}`

### Terminal 3: Frontend (Next.js)
```powershell
cd "c:\Users\Asus\OneDrive\Desktop\ai traffic\frontend"
npm run dev
```
*Access UI:* Open `http://localhost:3000`

---

## 6. Containerized Deployment (Docker Compose)

The entire platform can be deployed via Docker Compose with PostgreSQL + PostGIS and Redis:

```bash
docker compose up -d --build
```

**Services Orchestrated:**
* `frontend`: Next.js 16 on port `3000`
* `backend`: Spring Boot 3 on port `8080` (connected to PostGIS and Redis)
* `ai-service`: FastAPI on port `8000` (persisting model weights to volume)
* `db`: PostGIS 16-3.4 on port `5432`
* `redis`: Redis 7 Alpine on port `6379`

To view container status and logs:
```bash
docker compose ps
docker compose logs -f
```

---

## 7. Environment Configuration

Copy `.env.example` to create your local `.env`:

```ini
# Backend
SERVER_PORT=8080
SPRING_PROFILES_ACTIVE=dev
INGEST_USERNAME=ingest
INGEST_PASSWORD=local-dev-ingest-only-not-for-prod
AI_SERVICE_URL=http://localhost:8000
CORS_ALLOWED_ORIGINS=http://localhost:3000

# Frontend
NEXT_PUBLIC_API_URL=http://localhost:8080
NEXT_PUBLIC_AI_SERVICE_URL=http://localhost:8000
```

---

## 8. Primary API Endpoints

### AI Service (Port 8000)
* `GET /health`: Health status & Redis connection telemetry.
* `POST /upload-video`: Multipart video binary upload $\rightarrow$ returns `{ "job_id": "job-...", "status": "QUEUED" }`.
* `GET /jobs/{job_id}`: Job execution telemetry, frames processed, detections count, and recognized plates.
* `POST /predict-trajectory/{global_id}`: Markov transition probabilities for next camera checkpoint.
* `GET /watchlist`, `POST /watchlist`: Target vehicle security watchlist.
* `GET /security-alerts`: Active urban security alarms.

### Backend (Port 8080)
* `GET /api/health`: Backend health status.
* `POST /api/upload-video`: Proxies multipart video upload to AI service.
* `GET /api/jobs/{job_id}`: Proxies job polling to AI service.
* `POST /api/detections/ingest/batch`: Authenticated ingestion endpoint where AI service syncs detections, crops, and Re-ID vectors.
* `GET /api/vehicles/{plate}/summary`: Vehicle intelligence profile and camera visit history.
* `GET /api/vehicles/{plate}/trajectory`: Spatial-temporal trajectory reconstruction, Haversine velocity checks, and kinematic warnings.
* `GET /api/vehicles/{plate}/detections`: Full historical detection records including Re-ID vectors.
* `GET /evidence/{camera_id}/{filename}`: Serves saved JPEG evidence snapshots (`HTTP 200 OK`).

---

## 9. Automated Regression Test Suite

All test suites pass with a 100% success rate:

```bash
# 1. Spring Boot Maven Test Suite (61 unit & integration tests)
mvn test -f backend/pom.xml
# Result: Tests run: 61, Failures: 0, Errors: 0, Skipped: 0 (BUILD SUCCESS)

# 2. AI Pipeline Pytest Suite (5 computer vision tests)
.\ai-service\venv\Scripts\pytest.exe ai-service/tests/test_ai_pipeline.py
# Result: 5 passed in 4.27s

# 3. TypeScript Type-Safety Check
cd frontend && npx tsc --noEmit
# Result: 0 errors

# 4. Failure, Boundary & Security Suite (10 integration tests)
python scripts/failure_and_security_test.py
# Result: 10/10 PASSED (empty uploads, oversized 413, invalid plates, auth checks, CORS)

# 5. Full End-to-End Playwright Browser Acceptance Test
python -u scripts/e2e_browser_acceptance.py
# Result: VERDICT PASS (Recorded video upload, OCR, Re-ID 0.8014, and screenshots captured)
```

---

## 10. Technical Honesty & Known Limitations

1. **OCR Dependent on Camera Geometry**: Real CCTV cameras placed high above roads or capturing vehicles at acute angles may not yield readable number plates. The platform mitigates this through **2048-dimensional visual Re-ID embeddings** (ResNet50) to track vehicles by physical appearance.
2. **Single-Camera Kinematic Defense**: When only a single camera checkpoint exists for a target vehicle, velocity and direction cannot be mathematically determined. The system **honestly refuses to hallucinate a trajectory**, displaying a clear warning banner:
   > `KINEMATIC WARNING: NO_RELIABLE_TRAJECTORY_FOUND: only one camera detection available.`
3. **Inference Throughput**: On standard CPU architectures without GPU acceleration, YOLOv8s + EasyOCR processes video at ~1.5–2.5 FPS. Production deployments with NVIDIA CUDA GPUs achieve 30+ FPS real-time processing.
