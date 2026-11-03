# 08. End-to-End Feature Verification

## Objective
Trace the actual runtime execution path of every major feature across all system layers:
`Frontend User Action ──► Next.js / API ──► Backend Controller ──► Service / Repository ──► Database / AI Service ──► Response ──► UI Update`

Identify broken connections, missing implementations, incorrect assumptions, and dead code.

---

## 1. Feature Traces

### 1.1 Target Search & Trajectory Reconstruction

#### Scenario A: Searching Demo Target `ET3633P` (when no detections were ingested via CLI)
1. **Frontend Action**: User enters `ET3633P` in `VehicleSearchPanel` and clicks `"⚡ Reconstruct 3D Trajectory"` with mode `Historical`.
2. **API Call 1**: Frontend calls `GET http://localhost:8080/api/vehicles/ET3633P`.
3. **Backend Execution 1**:
   - `VehicleController.getVehicle("ET3633P")` is invoked.
   - `AuditLogService.record("VEHICLE_SEARCH", "ET3633P", ...)` writes an entry to `audit_log_entries`.
   - `VehicleRepository.findByPlate("ET3633P")` returns empty (if database is fresh).
   - `MockVehicleRegistryService.lookup("ET3633P")` matches `ET3633P` in `data/vehicles.json` -> returns Toyota Prius.
   - `VehicleRepository.save(vehicle)` saves vehicle to `vehicles` table.
   - `VehicleDetectionRepository.findByVehicle_PlateOrderByTimestampAsc("ET3633P")` returns empty list `[]`.
   - **Hardcoded Fallback Triggered** ([`VehicleController.java#L62-L72`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/VehicleController.java#L62-L72)):
     Returns mock `VehicleSummaryDto` with `firstSeen: "2026-08-30T18:14:23Z"`, `lastSeen: "2026-08-30T18:48:02Z"`, `cameraCount: 4`, `camerasVisited: ["CAM-01", "CAM-03", "CAM-07", "CAM-11"]`, `detectionCount: 15`.
4. **API Call 2**: Frontend calls `GET http://localhost:8080/api/vehicles/ET3633P/trajectory`.
5. **Backend Execution 2**:
   - `TrajectoryController.getTrajectory("ET3633P")` calls `TrajectoryEngine.reconstruct("ET3633P")`.
   - Detections query returns empty list. `groupIntoVisits()` returns empty visits.
   - **Hardcoded Fallback Triggered** ([`TrajectoryEngine.java#L128-L133`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryEngine.java#L128-L133)):
     `buildFallbackVisits()` synthesizes 4 camera visits (`CAM-01`, `CAM-03`, `CAM-07`, `CAM-11`) with synthetic confidences (`0.95`, `0.93`, `0.91`, `0.89`), image paths (`"CAM-01/frame_001.jpg"`), total distance 11.2 km, duration 34 min, overall confidence 0.94.
6. **Frontend UI Update**:
   - `InvestigationMap` renders 4 checkpoints and queries OSRM (`router.project-osrm.org`) for road coordinates, drawing glowing blue line.
   - `DetectionTimeline` lists 4 checkpoints.
   - `VehicleIntelligencePanel` displays Toyota Prius stats.
   - `EvidenceViewer` displays `CAM-01`. **However, viewport is blank black screen** because `CAM-01/frame_001.jpg` is not bound to an `<img>` tag and local video is missing.

#### Scenario B: Searching Arbitrary Unknown Plate (e.g. `MH02XY9999`)
1. **Frontend Action**: User enters `MH02XY9999` and submits.
2. **API Call**: `GET /api/vehicles/MH02XY9999`.
3. **Backend Execution**:
   - `VehicleRepository` finds no row.
   - `MockVehicleRegistryService.lookup("MH02XY9999")` executes `Math.abs("MH02XY9999".hashCode())`.
   - Generates a synthetic vehicle: e.g. "Hyundai Creta SX, Arctic White".
   - Saves vehicle to `vehicles` table.
   - Detections are empty -> returns the same hardcoded summary (dates: 2026-08-30, cameras: CAM-01, 03, 07, 11).
   - Trajectory call executes `buildFallbackVisits()`.
4. **Frontend UI Update**:
   - User sees a valid vehicle and a complete 4-camera Pune trajectory for a plate that never existed in any database or video feed.
   - **Verdict**: **Simulated / Synthetic Procedural Generator Bypass**.

---

### 1.2 Live Camera Tracking (`Live 3D Sim` Mode)
1. **Frontend Action**: User selects search mode `Live 3D Sim` and clicks search.
2. **Execution**:
   - Frontend calls `getVehicleSummary(plate)`.
   - Frontend calls `startLive(plate, "live")` in [`InvestigationDashboard.tsx#L75-L116`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/InvestigationDashboard.tsx#L75-L116).
3. **WebSocket Connection**:
   - `liveClient.ts` establishes native WebSocket connection: `ws://localhost:8080/ws/live/ET3633P`.
4. **Backend Handler Execution**:
   - `LiveTrackingWebSocketHandler.afterConnectionEstablished()` runs.
   - Calls `trajectoryEngine.reconstructAsDto("ET3633P")`.
   - Obtains 4 points (either real or fallback demo).
   - Sends `{ type: "connected", plate: "ET3633P", totalEvents: 4 }`.
   - Schedules 4 timer tasks at $t=3s, 6s, 9s, 12s$ using `ScheduledExecutorService`.
5. **Stream Delivery & UI Updates**:
   - At $t=3s$: Backend sends point 0 (`CAM-01`). Frontend appends point to trajectory, pulses radar on map, updates timeline.
   - At $t=6s$: Backend sends point 1 (`CAM-03`). Map vehicle beacon moves along road to CAM-03.
   - At $t=9s$: Backend sends point 2 (`CAM-07`).
   - At $t=12s$: Backend sends point 3 (`CAM-11`) + `{ type: "complete", overallConfidence: 0.893 }`.
6. **Verdict**: **Simulated Timed Replay** (Works reliably as a simulation; is not connected to a live RTSP stream).

---

### 1.3 Official VAHAN RC Lookup

#### Path A: Demo Target `ET3633P` or `MH12AB1234`
1. **Frontend Action**: User clicks `"🏛️ VAHAN Registry"` or searches `ET3633P`.
2. **API Call**: `GET /api/vahan/ET3633P`.
3. **Next.js Server Route**:
   - [`route.ts#L231`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L231) checks `if (cleanPlate === "ET3633P" || cleanPlate === "MH12AB1234")`.
   - Loads static object `KNOWN_REGISTRY_RECORDS["ET3633P"]`.
   - Returns `{ source: "LIVE_PUBLIC_API", latencyMs: 85, data: demoRecord }`.
   - **No external network call is made**.
4. **UI Update**:
   - Displays Form 23 Certificate: Owner "ANAND MUKUND KULKARNI", Toyota Prius, BS-VI, SBI Hypothecation, etc.
   - User can click `"📄 Download PDF"` to generate client-side PDF certificate via jsPDF.
5. **Verdict**: **Hardcoded Mock Bypass**.

#### Path B: Real Indian Plate (e.g. `UP11BN5141` or user's personal vehicle)
1. **Frontend Action**: User types real Indian registration plate (e.g. `UP11BN5141`) in VAHAN modal.
2. **Next.js Server Route**:
   - If plate is `UP11BN5141`: Returns pre-cached RapidAPI JSON response from `LIVE_API_CACHE`.
   - For other plates: Validates format `isValidIndianPlate(plate)`.
   - Loops through `DEFAULT_KEYS` and makes HTTPS POST to `https://rto-vehicle-information-india.p.rapidapi.com/getVehicleInfo`.
   - If API returns 200 with valid data: maps fields to `IndianVehicleRcRecord` and returns HTTP 200.
   - If API returns 429 Quota Exceeded across all keys: returns HTTP 429 `API_QUOTA_EXCEEDED`.
3. **Verdict**: **Functional External API Integration with Mock Cache and Hardcoded Demo Bypass**.

---

### 1.4 CCTV Video Ingestion Pipeline Modal
1. **Frontend Action**: User clicks `"📹 Ingest Video Feed"`, drops 4 MP4 files, enters plate `ET3633P`, and clicks `"⚡ Launch 4-Feed Correlation Pipeline"`.
2. **Frontend Execution**:
   - Runs `setTimeout` progress bar from 15% to 100% over 2.8 seconds.
   - Calls `processVideoFeed(slot.customFile.name, slot.id)` -> `POST /api/process-video`.
3. **Backend Proxy Execution**:
   - `AiProxyController.processVideoFeed()` receives payload `{ videoPath: "my_video.mp4", cameraId: "CAM-01" }`.
   - Forwards to `${ai-service.base-url}/process-video`.
   - If Python AI service is unreachable, returns fallback `{ framesProcessed: 120, detectionsCount: 15 }`.
   - **No file binary is uploaded or processed**.
4. **Client Playback**:
   - Modal creates blob URLs: `URL.createObjectURL(slot.customFile)`.
   - Passes blob URLs to `InvestigationDashboard`.
   - Dashboard feeds blob URL into `EvidenceViewer` `<video src={blobUrl}>`.
   - Video plays in browser; offscreen canvas captures frames every 260ms and calls `/api/yolo/detect`.
5. **Verdict**: **Frontend Simulation with Local Client-Side Video Playback**.

---

### 1.5 12-Camera Matrix Surveillance Wall
1. **Frontend Action**: User clicks `"🎥 12-Camera Grid"`.
2. **Frontend Execution**:
   - Modal opens with 12 cards corresponding to `cameras: CameraDto[]`.
   - Each card displays black box with SVG crosshairs, fake "ANPR LIVE" text, and hardcoded `MH12AB1234` box.
   - Clicking any camera displays fake full-screen stream ("4K UHD, 59.8 FPS").
3. **Verdict**: **100% Static Mock Simulation**.

---

### 1.6 Traffic Analytics Dashboard
1. **Frontend Action**: User clicks `"Traffic Analytics"` tab in header.
2. **API Call**: `GET /api/analytics/overview`.
3. **Backend Execution**:
   - `AnalyticsController` calls `AnalyticsService.overview()`.
   - Queries `cameras`, `vehicles`, `vehicle_detections`.
   - If DB has vehicles with no detections, `trajectoryEngine` injects the fallback route (`CAM-01 -> CAM-03 -> CAM-07 -> CAM-11`), skewing analytics.
   - If DB has zero detections, returns empty DTO.
4. **Frontend Override**:
   - `api.ts#L388` checks `if (!res || res.totalDetections === 0) return DEMO_ANALYTICS;`.
   - Displays hardcoded demo data: 12 cameras, 1,482 vehicles, 8,940 detections.
5. **Verdict**: **Hardcoded Fallback when database is empty**.

---

### 1.7 Next-Junction Trajectory Prediction
1. **Frontend Action**: User searches a vehicle; `TrajectoryPredictionCard` mounts.
2. **API Call**: `GET /api/predict-trajectory/ET3633P`.
3. **Backend Execution**:
   - `AiProxyController` calls `GET ${aiServiceBaseUrl}/predict-trajectory/ET3633P`.
4. **AI Microservice Failure**:
   - AI microservice expects `global_id` (e.g. `VEH-GLOBAL-1001`), not license plate `ET3633P`.
   - Returns HTTP 404: `"Global vehicle ID 'ET3633P' not found."`
5. **Frontend Fallback**:
   - `TrajectoryPredictionCard` catches error and renders `FALLBACK_CANDIDATES` (Swargate 78%, Baner 16%, Aundh 6%).
6. **Verdict**: **Broken API Contract / Permanent Fallback**.

---

### 1.8 Audit Log Security Recording
1. **Action**: User searches a plate or views a trajectory.
2. **Backend Execution**:
   - `VehicleController` calls `auditLogService.record("VEHICLE_SEARCH", normalized, request)`.
   - `TrajectoryController` calls `auditLogService.record("TRAJECTORY_VIEW", normalized, request)`.
   - Inserts row into `audit_log_entries` table with timestamp and client IP.
3. **Query**:
   - `GET /api/audit/recent` (requires HTTP Basic auth `ingest:change-me-in-production`).
   - Returns paginated list of real audit records.
4. **Verdict**: **Fully Functional & Real**.

---

## 2. Summary of Cross-Layer Defect Ledger

| Defect ID | Layer A | Layer B | Nature of Breakdown | File & Line Reference |
| :--- | :--- | :--- | :--- | :--- |
| **BRK-01** | Frontend UI | Static Assets | Video files are in `/videos`, but frontend links `/videos/*.mp4`, returning HTTP 404 | [`EvidenceViewer.tsx#L291`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L291) |
| **BRK-02** | Frontend UI | Backend Data | `activePoint.imagePath` exists in DTO but is never bound to any `<img>` tag in `EvidenceViewer` | [`EvidenceViewer.tsx#L237-L270`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L237-L270) |
| **BRK-03** | Frontend API | AI Microservice | Frontend passes `plate` to `/predict-trajectory/{id}`, but AI microservice requires `global_id` | [`TrajectoryPredictionCard.tsx#L41`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/TrajectoryPredictionCard.tsx#L41), [`main.py#L129`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L129) |
| **BRK-04** | AI Pipeline | AI Pipeline | `ImageDehazer` is instantiated but never called inside `process_feed` | [`video_pipeline.py#L56,L67`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L56) |
| **BRK-05** | AI Service | Backend Database| 2048-dim ResNet50 embeddings are computed in Python but dropped before sending to backend | [`video_pipeline.py#L144`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L144), [`DetectionIngestRequest.java#L12`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/dto/DetectionIngestRequest.java#L12) |
| **BRK-06** | Backend Service | Backend Service | `TrajectoryScoringService` hardcodes appearance score to `0.6` because Re-ID is not in DB | [`TrajectoryScoringService.java#L24,L60`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java#L24) |
| **BRK-07** | Frontend Modal | Backend API | Video Ingestion modal runs fake `setTimeout` timers and does not upload binary video files | [`VideoIngestionModal.tsx#L85-L107`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/VideoIngestionModal.tsx#L85-L107) |
| **BRK-08** | AI Microservice | AI Microservice | Real-time `/detect-plate` echoes target plate without running OCR; uses fixed bumper coordinates | [`main.py#L243,L317-L333`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L243) |
| **BRK-09** | Backend API | Database | Default H2 profile throws 501 on `/api/cameras/nearby` because PostGIS is restricted to `postgres` | [`CameraController.java#L48-L53`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L48-L53) |

