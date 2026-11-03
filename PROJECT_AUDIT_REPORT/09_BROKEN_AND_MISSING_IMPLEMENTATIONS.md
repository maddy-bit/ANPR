# 09. Broken and Missing Implementations

## Executive Summary
This report catalogues all broken connections, missing implementations, dead code, architectural anti-patterns, and incorrect assumptions discovered during the static code audit.

---

## 1. Critical Broken Connections

### 1.1 Broken CCTV Video Playback in Frontend
- **File**: [`frontend/src/components/EvidenceViewer.tsx#L281-L293`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L281-L293), [`frontend/src/lib/api.ts#L402-L406`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/api.ts#L402-L406)
- **Expected Behavior**: When an investigator inspects a camera checkpoint (e.g. `CAM-01`), the CCTV viewport should stream or loop the recorded junction traffic video.
- **Actual Code**:
  - `cameraVideoUrl(cameraId)` returns `/videos/${normalized}.mp4` (e.g. `/videos/CAM-01.mp4`).
  - Next.js serves static web assets from `frontend/public/`.
  - The actual MP4 video files reside in the root repository directory `C:\Users\Asus\OneDrive\Desktop\ai traffic\videos\`.
  - The directory `frontend/public/videos/` **does not exist**.
  - `docker-compose.yml` mounts `./videos` into `ai-service`, but **does not mount it into `frontend`**.
- **Failure Mechanism**:
  1. The browser sends HTTP GET to `http://localhost:3000/videos/CAM-01.mp4`.
  2. Next.js returns **HTTP 404 Not Found**.
  3. The `<video>` element triggers `onError` at line 291: `setFailedVideos((prev) => ({ ...prev, [currentCam]: true }))`.
  4. Flag `hasIngestedVideo` evaluates to `false`.
  5. The viewport switches permanently to lines 237-270: an empty black `<div>`.
- **Severity**: **HIGH**. Primary video evidence display is completely black for all default camera checkpoints.
- **Required Fix**:
  - Copy `videos/*.mp4` into `frontend/public/videos/` or configure Next.js rewrites / Express static handler to serve `/videos/**` from the repository root.

---

### 1.2 Unbound Still Frame Evidence Image (`imagePath`)
- **File**: [`frontend/src/components/EvidenceViewer.tsx#L237-L270`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L237-L270)
- **Expected Behavior**: If video stream is absent, the viewer should display the high-resolution evidence crop saved during detection (`activePoint.imagePath`, e.g. `"CAM-01/crop_frame120_track3.jpg"` or `"CAM-01/frame_001.jpg"`).
- **Actual Code**:
  - In `backend/src/main/java/com/cityai/backend/config/EvidenceResourceConfig.java`, an HTTP static resource handler is registered: `/evidence/**` -> `file:../data/evidence/`.
  - In `frontend/src/lib/api.ts#L397-L400`, helper `evidenceImageUrl(imagePath)` exists: `${API_BASE_URL}/evidence/${imagePath}`.
  - **In `EvidenceViewer.tsx`, neither `activePoint.imagePath` nor `evidenceImageUrl` is ever used in the JSX**.
- **Failure Mechanism**: The author wrote the backend resource handler and frontend URL builder, but never placed an `<img src={evidenceImageUrl(activePoint.imagePath)} />` tag inside `EvidenceViewer.tsx`. Instead, lines 237-270 render a raw black box.
- **Severity**: **MEDIUM-HIGH**. Investigators cannot see still photographic evidence.
- **Required Fix**: Render `<img src={evidenceImageUrl(activePoint.imagePath)} />` inside the fallback viewport when video is unavailable.

---

### 1.3 Trajectory Prediction API Contract Mismatch
- **Files**:
  - Frontend: [`frontend/src/components/TrajectoryPredictionCard.tsx#L41`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/TrajectoryPredictionCard.tsx#L41)
  - Backend Proxy: [`backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L113-L123`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L113-L123)
  - Python AI Service: [`ai-service/main.py#L129-L136`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/main.py#L129-L136)
- **Expected Behavior**: The UI displays Markov-predicted candidate junctions for the target vehicle currently being investigated.
- **Actual Code**:
  - `TrajectoryPredictionCard` invokes `predictTrajectory(plate)` passing the vehicle license plate (e.g. `"ET3633P"`).
  - Backend `AiProxyController.predictTrajectory(globalId)` forwards: `GET ${aiServiceBaseUrl}/predict-trajectory/ET3633P`.
  - Python AI microservice declares:
    ```python
    @app.get("/predict-trajectory/{global_id}")
    def predict_next_trajectory(global_id: str):
        journey = orchestrator.predict_next_trajectory(global_id)
        if not journey: raise HTTPException(404, ...)
    ```
  - In Python `MultiCameraOrchestrator`, `predict_next_trajectory` calls `self.registry.get_record(global_id)`.
  - `self.registry.records` is indexed strictly by internal UUIDs (`"VEH-GLOBAL-1001"`), **not** by license plate string.
- **Failure Mechanism**:
  1. AI service returns HTTP 404: `"Global vehicle ID 'ET3633P' not found."`
  2. `AiProxyController` catches exception and returns HTTP 200 with empty array `[]`.
  3. `TrajectoryPredictionCard` sees empty array and falls back to hardcoded `FALLBACK_CANDIDATES` (Swargate 78%, Baner 16%, Aundh 6%).
- **Severity**: **HIGH**. Real Markov prediction model is completely unreachable from the UI; hardcoded predictions are always shown.
- **Required Fix**: Update AI service to look up records either by `global_id` or by `primary_plate` via `plate_to_global_id` dictionary.

---

### 1.4 Hardcoded RapidAPI Keys in Version-Controlled Client Route
- **File**: [`frontend/src/app/api/vahan/[plate]/route.ts#L15-L20`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L15-L20)
- **Problem**:
  ```typescript
  const DEFAULT_KEYS = [
    "6f0881c1c1mshda5cc01a91b057dp1ac9f0jsn976262889eea",
    "0724709417msh4efb2cee3613ee3p13687ajsn5c5258e6d4db",
  ];
  ```
- **Risk**: Active API secrets committed to a public Git repository (`origin: https://github.com/maddy-bit/SIH_Project.git`). Keys will be revoked or exhausted by scrapers.
- **Severity**: **CRITICAL SECURITY RISK**.
- **Required Fix**: Revoke exposed keys immediately in RapidAPI console; read exclusively from `process.env.RAPIDAPI_VAHAN_KEY`.

---

## 2. Dead Code & Disconnected Implementations

### 2.1 Adverse Weather Image Dehazer Disconnected from Pipeline
- **Files**: [`ai-service/ai/dehazer.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/dehazer.py#L46-L94), [`ai-service/services/video_pipeline.py#L56,L67`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L56)
- **What Exists**: A 94-line implementation of Dark Channel Prior (DCP) defogging and CLAHE contrast recovery in `ai/dehazer.py`.
- **What is Broken**:
  - In `CameraAgent.__init__`, `self.dehazer = ImageDehazer()` is instantiated.
  - In `process_feed(..., enable_dehaze: bool = False)`, the argument `enable_dehaze` is accepted.
  - In the entire loop over tracked frames ([`video_pipeline.py#L102-L198`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L102-L198)), `self.dehazer.dehaze()` is **never called**.
  - Frame images pass straight into `crop` extraction and plate detection without defogging.
- **Verdict**: **Dead code**. Adverse weather processing cannot affect detection accuracy.

---

### 2.2 Deep Re-ID Embeddings Dropped Before Reaching Backend
- **Files**:
  - Python: [`ai-service/ai/reid.py`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/reid.py#L25-L105), [`ai-service/services/video_pipeline.py#L144-L146`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L144-L146)
  - Java DTO: [`backend/src/main/java/com/cityai/backend/dto/DetectionIngestRequest.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/dto/DetectionIngestRequest.java#L12-L24)
  - Java Entity: [`backend/src/main/java/com/cityai/backend/model/VehicleDetection.java#L67-L68`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/model/VehicleDetection.java#L67-L68)
  - Java Scoring: [`backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java#L24,L60`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryScoringService.java#L24)
- **What Exists**:
  - PyTorch ResNet50 executes forward pass on vehicle crops to produce 2048-dimensional float32 feature vectors.
- **Where It Breaks**:
  - `DetectionIngestRequest` in Spring Boot does not declare an embedding field or vector array.
  - In `VehicleDetection.java`, `private Double reidConfidence;` is an empty float field annotated with `/** Placeholder for appearance-based Re-ID confidence (Phase 8+). */`.
  - In `TrajectoryScoringService.java`:
    ```java
    private static final double WEIGHT_APPEARANCE = 0.15;
    ...
    double appearanceScore = 0.6; // neutral placeholder - see class docs
    ```
- **Verdict**: **Architectural Disconnection**. The heavy ResNet50 neural network runs in Python, but its output is discarded at the backend boundary. Backend route scoring uses a hardcoded constant `0.6`.

---

### 2.3 Deprecated Haar Cascade Left as Orphan Asset
- **File**: `ai-service/models/haarcascade_russian_plate_number.xml`
- **Documentation**: [`ai-service/ai/plate_detector.py#L11-L12`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/plate_detector.py#L11-L12) states:
  *"The Haar cascade is REMOVED. It produced too many false positives on Indian vehicles and could not be confidence-scored reliably."*
- **Verdict**: Dead binary asset (78 KB XML) left in repository.

---

### 2.4 Missing Plate Model Weights in `ai-service/models/`
- **File**: `ai-service/models/`
- **Declared in Config**: `cfg.models.plate_detector = _MODELS_DIR / "plate_detector_yolov8n.pt"`.
- **Reality**: `plate_detector_yolov8n.pt` does not exist in `ai-service/models/`.
- **Runtime Fallback**: Falls back to pulling `keremberke/yolov8n-license-plate-detection` from HuggingFace, and if that fails, loads `yolov8n.pt` (generic COCO object detector).
- **Verdict**: Incomplete deployment artifact.

---

## 3. Missing Implementations & Incomplete Features

### 3.1 Python AI Service Completely Lacks Persistent Storage
- **Files**: `ai-service/ai/global_vehicle_registry.py`, `ai-service/ai/watchlist_manager.py`
- **Mechanism**: All global vehicle records, observations, and watchlist entries exist exclusively inside Python memory dictionaries (`self.records = {}`).
- **Impact**: Any microservice restart, crash, or horizontal auto-scaling (e.g. on Render or Kubernetes) destroys all tracked vehicles and active security alerts.

### 3.2 PostGIS Spatial Queries Disabled on Default Development Profile
- **File**: [`backend/src/main/java/com/cityai/backend/controller/CameraController.java#L44-L55`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L44-L55)
- **Mechanism**: `SpatialCameraService` is annotated with `@Profile("postgres")`. On the default H2 profile, calling `GET /api/cameras/nearby` throws HTTP 501 NOT IMPLEMENTED.
- **Missing Implementation**: No standard Java trigonometric Haversine fallback is implemented for development or test environments.

### 3.3 Video Ingestion Modal Does Not Support Real File Uploads
- **File**: [`frontend/src/components/VideoIngestionModal.tsx#L104-L107`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/VideoIngestionModal.tsx#L104-L107)
- **Mechanism**: The modal accepts file drops via HTML input, but only passes the file's string name (`slot.customFile.name`) in a JSON request. It has no `FormData` multipart binary upload endpoint.
- **Impact**: Backend and AI microservice cannot process user-uploaded videos from the frontend UI.

