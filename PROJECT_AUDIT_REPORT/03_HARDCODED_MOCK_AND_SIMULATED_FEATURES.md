# 03. Hardcoded, Mock and Simulated Functionality

## Audit Objective
Every feature in the repository was inspected to determine whether data originates from real live sensors, hardware cameras, databases, and ML models, or whether it relies on static JSON files, deterministic procedural generators, hardcoded fallback constants, and simulated progress timers.

---

## 1. Master Audit Table of Mocked & Simulated Features

| Feature | Current Implementation | Hardcoded/Mock? | Actual Source | Runtime Status | Required Changes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **VAHAN Demo Lookup (ET3633P / MH12AB1234)** | Bypass condition intercepts plate; returns pre-populated Form 23 RC record with fake 85ms latency | **HARDCODED MOCK** | [`route.ts#L229-L238`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L229-L238), [`registry.ts#L104-L211`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/registry.ts#L104-L211) | Fully Mocked (never hits external API) | Remove bypass; query real RTO endpoint or clearly flag as "DEMO MODE" |
| **VAHAN In-Memory Static Cache** | Hardcoded pre-cached live response for plate `UP11BN5141` | **HARDCODED MOCK** | [`route.ts#L111-L139`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L111-L139) | Static Preloaded Response | Store cached records in Redis/DB with expiration |
| **RapidAPI Master Credentials** | Hardcoded API keys committed directly into client server route | **HARDCODED CREDENTIALS** | [`route.ts#L15-L20`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L15-L20) | Source Code Secrets | Move to secure vault or `.env.local` ignored from git |
| **Vehicle Registry Lookup (Backend)** | When plate is not in `data/vehicles.json`, generates synthetic vehicle from `plate.hashCode()` | **PROCEDURAL SYNTHETIC MOCK** | [`MockVehicleRegistryService.java#L66-L88`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/MockVehicleRegistryService.java#L66-L88) | Fake Generator (Any string returns a car) | Integrate real RTO / VAHAN gateway on backend; return 404 if missing |
| **Vehicle Summary Endpoint (`/api/vehicles/{plate}`)** | When vehicle has no detections in DB, returns hardcoded dates, 4 cameras (`CAM-01,03,07,11`), and 15 detections | **HARDCODED FALLBACK** | [`VehicleController.java#L62-L72`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/VehicleController.java#L62-L72) | Fake Summary | Return empty summary or HTTP 404 when no detections exist |
| **Trajectory Reconstruction (`/api/vehicles/{plate}/trajectory`)** | When zero camera visits exist, calls `buildFallbackVisits()` to fabricate 4-checkpoint route | **FABRICATED MOCK** | [`TrajectoryEngine.java#L128-L133,L174-L199`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryEngine.java#L128-L133) | Synthetic Trajectory | Return `NO_TRAJECTORY_FOUND` with empty points array |
| **Live Tracking WebSocket (`/ws/live/{plate}`)** | Replays pre-computed trajectory points sequentially at 3-second intervals using a timer | **SYNTHETIC REPLAY** | [`LiveTrackingWebSocketHandler.java#L26-L45,L77-L85`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java#L26-L45) | Paced Simulation (Not real-time RTSP) | Connect to real Kafka/Redis live detection event stream |
| **12-Camera Grid Matrix Modal** | Displays black boxes with static SVG crosshairs, fake "ANPR LIVE" text, and hardcoded `MH12AB1234` boxes | **100% STATIC MOCK UI** | [`LiveCameraGridModal.tsx#L109-L138,L173-L184`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/LiveCameraGridModal.tsx#L109-L138) | Visual Simulation Only | Stream WebRTC / HLS / RTSP video feeds from cameras |
| **4-Camera Video Ingestion Pipeline Modal** | Runs `setTimeout` sequence (15%, 35%, 65%, 90%, 100%) to simulate ML processing; passes only file names | **SIMULATED PROGRESS** | [`VideoIngestionModal.tsx#L79-L137`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/VideoIngestionModal.tsx#L79-L137) | Fake Progress Timers | Implement real multipart file upload & async job status polling |
| **City Traffic Analytics (`/api/analytics/overview`)** | Frontend falls back to `DEMO_ANALYTICS` (1,482 vehicles, 8,940 detections) if DB detections are zero | **HARDCODED FALLBACK** | [`api.ts#L237-L291,L385-L395`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/api.ts#L237-L291) | Static Demo Figures | Display actual database counts (even if 0) or explicit empty state |
| **Next-Junction Trajectory Predictor Card** | Fails to query AI service due to parameter mismatch (`plate` vs `global_id`); falls back to static candidates | **HARDCODED FALLBACK** | [`TrajectoryPredictionCard.tsx#L11-L33,L48-L53`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/TrajectoryPredictionCard.tsx#L11-L33) | Permanently on Fallback | Align API contract: pass `global_id` or query by plate |
| **Security Watchlist & Alerts (`AiProxyController`)** | If AI service is down or unreachable, returns hardcoded alert `ALT-DEMO-01` (`MH15TC554`) | **HARDCODED FALLBACK** | [`AiProxyController.java#L42-L56,L97-L110`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L42-L56) | Static Mock Alert | Return 503 / 504 error or query a persistent database table |
| **Real-time Plate Detector (`/detect-plate`)** | Echoes `target_plate` from request without performing OCR; uses fixed bumper coordinates (35%w, 70%h) | **HEURISTIC PSEUDO-DETECTION** | [`main.py#L243,L272,L317-L333`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L243) | Heuristic / Echo Mock | Run EasyOCR on vehicle crop; return actual detected characters |
| **Appearance Re-ID Scoring (`TrajectoryScoringService`)** | Assigns constant `appearanceScore = 0.6` because Re-ID embeddings are not stored in database | **HARDCODED CONSTANT** | [`TrajectoryScoringService.java#L24,L60`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java#L24) | Unused Signal (Fixed 0.6) | Add embedding column to `vehicle_detections`; compute cosine similarity |
| **Adverse Weather Dehazing (`ImageDehazer`)** | Module implemented in `ai/dehazer.py`, but never called in `process_feed` or anywhere in pipeline | **DEAD CODE / DISCONNECTED** | [`video_pipeline.py#L56,L67`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L56) | Uninvoked at Runtime | Apply `self.dehazer.dehaze(frame)` before vehicle detection when requested |
| **Spatial Proximity Query (`/api/cameras/nearby`)** | Throws HTTP 501 on default H2 profile because PostGIS service is restricted to `postgres` profile | **PARTIAL IMPLEMENTATION** | [`CameraController.java#L44-L55`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L44-L55) | Disabled on Default Profile | Add Java Haversine fallback calculation for non-PostGIS environments |
| **CCTV Evidence Frame Viewer** | Renders blank black box when no user video is ingested; never binds `imagePath` to an `<img>` tag | **BROKEN VIEWPORT** | [`EvidenceViewer.tsx#L237-L270`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L237-L270) | Blank Screen on Default Search | Render `evidenceImageUrl(activePoint.imagePath)` as thumbnail / still |
| **Corridor Video Assets in Frontend** | Frontend links `/videos/CAM-01.mp4`, but `frontend/public/videos/` does not exist | **BROKEN ASSET LINK (404)** | [`EvidenceViewer.tsx#L291`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L291), [`frontend/public/`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/public) | 404 Video Error | Copy root `videos/*.mp4` into `frontend/public/videos/` |

---

## 2. In-Depth Analysis of Critical Hardcoded Systems

### 2.1 The "Omnipresent Vehicle" Generator
In [`MockVehicleRegistryService.java#L66-L88`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/MockVehicleRegistryService.java#L66-L88):
```java
// Authoritative fallback for any Indian registration plate
int hash = Math.abs(clean.hashCode());
String[] types = {"Sedan", "SUV", "Hatchback", "Compact SUV", "Motorcycle"};
String[] makes = {"Maruti Suzuki", "Hyundai", "Tata Motors", "Mahindra", "Honda", "Toyota", "Kia"};
String[][] models = {
    {"Dzire VXi", "Ciaz Alpha", "Swift ZXi"},
    {"Creta SX", "Venue S", "i20 Asta"}, ...
};
String[] colors = {"Arctic White", "Silver Metallic", "Daytona Grey", "Stealth Black", "Imperial Blue"};

int makeIdx = hash % makes.length;
String make = makes[makeIdx];
String model = models[makeIdx][(hash >> 2) % models[makeIdx].length];
String type = types[(hash >> 1) % types.length];
String color = colors[(hash >> 3) % colors.length];

return Optional.of(new VehicleRegistryRecord(clean, type, make, model, color));
```
**Impact**:
1. It is mathematically impossible for `lookup(plate)` to return empty for any non-blank plate string.
2. If an operator types `XYZ999999`, the service deterministically invents a vehicle (e.g. "Toyota Fortuner 4x4, Stealth Black").
3. When `VehicleController` sees this newly created vehicle with zero detections, it invokes lines 62-72:
   ```java
   if (detections.isEmpty()) {
       List<String> demoCameras = List.of("CAM-01", "CAM-03", "CAM-07", "CAM-11");
       return new VehicleSummaryDto(VehicleDto.from(vehicle), Instant.parse("2026-08-30T18:14:23Z"), ...);
   }
   ```
4. `TrajectoryEngine` then sees zero visits and executes lines 128-132:
   ```java
   if (visits.isEmpty()) {
       List<CameraVisit> fallbackVisits = buildFallbackVisits();
       List<Transition> fallbackTransitions = buildFallbackTransitions(fallbackVisits);
       return new TrajectoryResult(vehicle, fallbackVisits, fallbackTransitions, 0.94, 11.2, 34, null);
   }
   ```
5. **Net Result**: **Any random string entered into the system results in a verified vehicle with a 4-checkpoint trajectory across Pune.**

---

### 2.2 The VAHAN Parivahan Bypass
In [`frontend/src/app/api/vahan/[plate]/route.ts#L229-L238`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L229-L238):
```typescript
// ── 1. Presentation Demo Number Plate: ET3633P ───────────────────────
// Pre-loaded for live presentation demonstrations
if (cleanPlate === "ET3633P" || cleanPlate === "MH12AB1234") {
  const demoRecord = getVehicleRegistryRecord(cleanPlate);
  return NextResponse.json({
    source: "LIVE_PUBLIC_API",
    latencyMs: 85,
    data: demoRecord,
  });
}
```
**Impact**:
The code explicitly pretends to have called the live government API (`source: "LIVE_PUBLIC_API"`) and fakes network latency (`latencyMs: 85`). It loads static object [`KNOWN_REGISTRY_RECORDS["ET3633P"]`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/registry.ts#L105-L157) which contains hardcoded details:
- Owner: "ANAND MUKUND KULKARNI"
- Engine: "2ZR-FXE-8924102"
- Chassis: "MBJAA43B1G9876541"
- FASTag ID: "34161FA98172635481928374"
- Digital Verification Key: "VAHAN4-ET3633P-VERIFIED"

---

### 2.3 The Real-Time YOLO Endpoint Pseudo-Detection
In [`ai-service/main.py#L235-L337`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L235-L337):
```python
@app.post("/detect-plate")
async def detect_plate_endpoint(data: Dict[str, Any]) -> Dict[str, Any]:
    image_b64 = data.get("image")
    target_plate = data.get("targetPlate") or data.get("target_plate") or "ET3633P"
    ...
    # If vehicle detector finds a car but plate detector fails on crop:
    p_left = vx1 + vw * 0.35
    p_top = vy1 + vh * 0.70
    p_w = vw * 0.30
    p_h = vh * 0.16
    return {
        "success": True,
        "detected": True,
        "plate": target_plate,
        "confidence": round(vconf * 0.95, 3),
        "model": "YOLOv8s-VehicleTracking",
        "box": { ... }
    }
```
**Impact**:
When `/detect-plate` is called during CCTV video playback, if a vehicle box is found, it does not read the plate text using EasyOCR. Instead, it places a green box on the lower center bumper zone (35% left, 70% top) and returns `plate: target_plate`.
Thus, whatever plate was passed in the request body is claimed as "detected" with `vconf * 0.95` confidence.

