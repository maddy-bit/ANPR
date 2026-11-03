# 04. Frontend Audit

## Overview
- **Framework**: Next.js 16.3.4 (App Router)
- **UI Runtime**: React 19.2.8
- **Styling**: Tailwind CSS v4, custom neo-brutalist utility classes (`globals.css`)
- **Key Client Libraries**: MapLibre GL 6.6.0, Framer Motion 13.1.1, jsPDF 4.2.1
- **TypeScript Configuration**: [`frontend/next.config.ts#L4-L6`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/next.config.ts#L4-L6) has `typescript: { ignoreBuildErrors: true }` enabled.

---

## 1. Page-Level Audit

### 1.1 Root Layout (`frontend/src/app/layout.tsx`)
- **User View**: Sets base HTML shell, page title (`"City AI Traffic Intelligence"`), font imports, and favicon.
- **Rendered Component**: Root server layout wrapping children in `<body className="...">`.
- **API Calls**: None.
- **Status**: **Functional**.

### 1.2 Main Dashboard Container (`frontend/src/app/page.tsx`)
- **User View**:
  - Top navigation bar with logo ("🏙️ City AI Traffic Intelligence").
  - Two primary view switcher tabs: `Target Investigation` and `Traffic Analytics`.
  - Diagnostics replay button ("⚡ Boot Sequence").
  - System status bar (`SystemStatusBar`).
- **Rendered Component**: `DashboardPage` (Client Component).
- **State Management**:
  - `view`: `"investigation"` | `"analytics"` (defaults to `"investigation"`).
  - `showBootLoader`: boolean (defaults to `false`).
- **API Calls**: Indirect via child components.
- **Status**: **Functional**.

---

## 2. Component-by-Component Audit

### 2.1 InvestigationDashboard (`frontend/src/components/InvestigationDashboard.tsx`)
- **User View**:
  - Top action strip with three action buttons: `"📹 Ingest Video Feed"`, `"🎥 12-Camera Grid"`, `"🏛️ VAHAN Registry"`.
  - 3-column responsive layout:
    - Left: Search panel, Watchlist modal trigger, vehicle intelligence panel, PDF report exporter.
    - Center: MapLibre vector map, interactive trajectory player, VAHAN registry section.
    - Right: Checkpoint detection timeline, CCTV evidence viewer.
- **Rendered By**: `InvestigationDashboard`.
- **APIs Called**:
  - `getCameras()` -> `GET /api/cameras` (on mount)
  - `getVehicleSummary(plate)` -> `GET /api/vehicles/{plate}` (on search)
  - `getVehicleTrajectory(plate)` -> `GET /api/vehicles/{plate}/trajectory` (on search)
  - `connectLiveTracking(plate)` -> `ws://<backend>/ws/live/{plate}` (when live mode active)
- **Data Source**: Real backend if running, falls back to `SEED_CAMERAS`, `DEMO_SUMMARY`, and `DEMO_TRAJECTORY` on network failure.
- **Dynamic Updates**: Updates state when new checkpoints are clicked, when live tracking messages arrive, or when search mode changes.
- **Backend Connection**: **Connected** (via `frontend/src/lib/api.ts`).
- **Runtime Status**: **Partially Functional / Simulated Fallback**.

---

### 2.2 VehicleSearchPanel (`frontend/src/components/VehicleSearchPanel.tsx`)
- **User View**:
  - High-contrast Indian High Security Registration Plate (HSRP) styled input with blue "IND" badge and Ashoka Chakra circle.
  - Three search mode radio buttons:
    - `Historical` (Stored Trajectory)
    - `Live 3D Sim` (Real-time Stream)
    - `Hybrid` (Route + Live Play)
  - Three preset buttons: `ET3633P` (Demo Target), `DL04CA2020` (Decoy), `KA05MH8899` (Decoy).
  - Submit button: `"⚡ Reconstruct 3D Trajectory"`.
- **Rendered By**: `VehicleSearchPanel`.
- **APIs Called**: Triggers `onSearch(plate, mode)` prop passed from `InvestigationDashboard`.
- **Data Source**: Form input or static preset values.
- **Dynamic Updates**: State-driven text input.
- **Backend Connection**: Connected through parent callback.
- **Runtime Status**: **Functional**.

---

### 2.3 InvestigationMap (`frontend/src/components/InvestigationMap.tsx`)
- **User View**:
  - Interactive WebGL map rendered with MapLibre GL.
  - Uses Google Maps raster tiles (toggleable between Streets, Satellite, Hybrid).
  - Displays 12 camera markers with status pills (ONLINE in green, PROCESSING in blue, OFFLINE in gray).
  - Glowing blue trajectory line connecting camera checkpoints along actual Pune city streets.
  - Animated pulsing radar ring and vehicle beacon around active selected camera checkpoint.
- **Rendered By**: `InvestigationMap` (dynamically loaded via `next/dynamic` with `ssr: false`).
- **APIs Called**:
  - `fetchRoadRoute(waypoints)` in [`routing.ts`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/routing.ts#L26-L87) calls public OSRM server: `https://router.project-osrm.org/route/v1/driving/...`.
- **Data Source**: Camera coordinates from backend `CameraDto[]`; route geometry from external OSRM API or smooth spline fallback.
- **Dynamic Updates**: Pan-and-zoom controls; moves camera viewport when active checkpoint changes; redraws route when `points` prop updates.
- **Backend Connection**: Connected for camera locations and waypoint coordinates.
- **Runtime Status**: **Functional** (relies on third-party Google raster tiles and free public OSRM demo server).

---

### 2.4 EvidenceViewer (`frontend/src/components/EvidenceViewer.tsx`)
- **User View**:
  - CCTV viewfinder frame titled `"CCTV Evidence Frame"`.
  - Telemetry tags: Camera ID (e.g. `CAM-01`), `TARGET TRACKED` / `SCANNING FEED` / `STANDBY`.
  - Viewport screen.
  - Video controls: Play/Pause, Mute/Unmute, Prev/Next Checkpoint.
  - Forensic readout table: Camera Node, Timestamp, ANPR Plate Match, Vehicle Match, Transition Score.
- **Rendered By**: `EvidenceViewer`.
- **APIs Called**:
  - Real-time ML detection loop: `fetch("/api/yolo/detect", { method: "POST", body: { image, targetPlate, cameraId } })`.
- **Data Source**:
  - Checkpoint metrics (`confidence`, `timestamp`, `cameraName`) originate from `TrajectoryPointDto`.
  - Video feed originates from `customVideoUrls[currentCam]` if user uploaded via modal, or defaults to `/videos/<CAM-ID>.mp4`.
- **Critical Flaws Identified**:
  1. **Blank Screen on Default Search**: When no video is uploaded (`!hasIngestedVideo`), lines 237-270 render a pure empty black `<div>`.
  2. **Unbound Image Path**: `activePoint.imagePath` (`"CAM-01/frame_001.jpg"`) is never bound to any `<img>` tag in the DOM.
  3. **Video 404 Error**: When attempting to play `/videos/<CAM-ID>.mp4`, the browser fails with 404 because `frontend/public/videos/` does not exist. This triggers `onError` in line 291, setting `failedVideos[currentCam] = true`, which forces the viewport into the blank black screen state.
- **Runtime Status**: **Broken in default state / Functional only when user uploads custom video blob via modal**.

---

### 2.5 VehicleIntelligencePanel (`frontend/src/components/VehicleIntelligencePanel.tsx`)
- **User View**:
  - Tab switcher: `Intelligence & Metrics`, `3D Hologram Scan`, `Official VAHAN RC`.
  - Stat tiles: Primary Plate, Vehicle Class, Make & Model, Dominant Color, Route Confidence, Total Distance, Travel Time.
  - Download RC button (`"📄 Download Form 23 RC"`).
  - Embeds `TrajectoryPredictionCard` and `VehicleHologram3D`.
- **Rendered By**: `VehicleIntelligencePanel`.
- **APIs Called**:
  - `fetchVehicleRegistryRecord(plate)` calls `/api/vahan/[plate]`.
  - `generateRcPdf(rcRecord)` triggers client-side jsPDF document creation.
- **Data Source**: Real backend summary + VAHAN route response (or hardcoded `DEMO_SUMMARY` and `KNOWN_REGISTRY_RECORDS["ET3633P"]`).
- **Dynamic Updates**: Updates on tab click or plate search change.
- **Backend Connection**: Connected.
- **Runtime Status**: **Functional** (with hardcoded fallback data for demo plates).

---

### 2.6 VehicleHologram3D (`frontend/src/components/VehicleHologram3D.tsx`)
- **User View**:
  - Rotating 3D green/amber wireframe mesh model of a vehicle chassis.
  - Animated horizontal laser scanline moving up and down across the model.
  - Interactive mouse drag to rotate yaw and pitch.
  - Controls: Auto-rotate toggle, View Mode toggle (`Wireframe`, `Hologram`, `Thermal`).
  - Telemetry watermark: `ROT: X° / Y°`, `VERTICES: 20`, `EDGES: 22`, `FPS: ~60`.
- **Rendered By**: `VehicleHologram3D`.
- **APIs Called**: None (Pure client-side HTML5 2D Canvas math projecting 3D coordinates `[x, y, z]` to screen coordinates via trigonometric rotation matrices).
- **Data Source**: Local vertex array `BASE_VERTICES` and edge array `EDGES`.
- **Dynamic Updates**: Runs in `requestAnimationFrame` render loop.
- **Backend Connection**: N/A (Client animation only).
- **Runtime Status**: **Functional Client-Side Animation**.

---

### 2.7 DetectionTimeline (`frontend/src/components/DetectionTimeline.tsx`)
- **User View**:
  - Vertical chronological list of all camera checkpoints visited by the vehicle.
  - For each checkpoint: Visit index, Camera ID, Name, Timestamp, Plate Confidence badge, Detection Confidence badge.
  - Clicking any checkpoint selects it and focuses the map and CCTV viewer on that node.
- **Rendered By**: `DetectionTimeline`.
- **APIs Called**: None (receives `points: TrajectoryPointDto[]` from parent).
- **Data Source**: Backend trajectory response or `DEMO_TRAJECTORY.points`.
- **Dynamic Updates**: Re-renders when `selectedIndex` or `points` changes.
- **Backend Connection**: Connected through parent component.
- **Runtime Status**: **Functional**.

---

### 2.8 TrajectoryPredictionCard (`frontend/src/components/TrajectoryPredictionCard.tsx`)
- **User View**:
  - Card titled `"Trajectory Predictor // MARKOV"`.
  - Displays top-3 ranked candidate next camera junctions with probability percentages and estimated travel times (ETA).
- **Rendered By**: `TrajectoryPredictionCard`.
- **APIs Called**:
  - Calls `predictTrajectory(plate)` in [`frontend/src/lib/api.ts#L473-L521`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/api.ts#L473-L521), which calls `GET /api/predict-trajectory/{plate}`.
- **Critical Architecture Defect**:
  - Backend controller [`AiProxyController.java#L113-L123`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L113-L123) forwards the argument to Python microservice: `GET ${aiServiceBaseUrl}/predict-trajectory/{globalId}`.
  - In the Python microservice, the endpoint expects a **Global Vehicle UUID** (e.g. `VEH-GLOBAL-1001`), NOT a license plate string.
  - The Python service executes `orchestrator.predict_next_trajectory(global_id)`, which looks up `self.registry.get_record(global_id)`.
  - Because `ET3633P` is not a registered `global_id`, the AI service returns **HTTP 404**.
  - The frontend catches this error and **always displays the hardcoded constant `FALLBACK_CANDIDATES`**:
    1. `#1 Swargate Junction (CAM-05)`: 78% probability, ETA ~5m
    2. `#2 Baner Road (CAM-08)`: 16% probability, ETA ~10m
    3. `#3 Aundh ITI Circle (CAM-11)`: 6% probability, ETA ~14m
- **Runtime Status**: **Broken API Contract / Permanently Rendered as Hardcoded Fallback**.

---

### 2.9 VideoIngestionModal (`frontend/src/components/VideoIngestionModal.tsx`)
- **User View**:
  - Modal titled `"4-Camera Corridor Ingestion Pipeline"`.
  - 4 camera slots (`CAM-01`, `CAM-03`, `CAM-07`, `CAM-11`) with file upload drop zones.
  - Target plate input (`ET3633P`), vehicle type, and color selectors.
  - Button: `"⚡ Launch 4-Feed Correlation Pipeline"`.
  - Progress bar with status messages.
- **Rendered By**: `VideoIngestionModal`.
- **APIs Called**:
  - Iterates over slots and calls `processVideoFeed(videoPath, slot.id)` -> `POST /api/process-video`.
- **Actual Implementation**:
  - **No binary file upload exists**: The file bytes are never transmitted to backend or AI service. Only `slot.customFile.name` (a string) is passed in the JSON body.
  - The progress bar is operated by four fixed `setTimeout` calls:
    - 500ms: 35% ("Running YOLOv8...")
    - 1100ms: 65% ("Extracting Re-ID...")
    - 1600ms: 90% ("Linking Observations...")
    - 2800ms: 100% ("Complete!")
  - Generates browser blob URLs via `URL.createObjectURL(slot.customFile)` and passes them back to parent dashboard to play inside HTML `<video>` elements.
- **Runtime Status**: **Simulated UI with Client-Side Blob Playback**.

---

### 2.10 LiveCameraGridModal (`frontend/src/components/LiveCameraGridModal.tsx`)
- **User View**:
  - 12-camera matrix surveillance wall titled `"Smart City Video Analytics ● REC 60FPS"`.
  - Filters: `ALL`, `ONLINE`, `PROCESSING`.
  - Grid of 12 camera cards with simulated video boxes, neon green reticles, tracking badges (`TRK-01` to `TRK-12`), and vehicle plate overlays.
  - Clicking a camera opens a full-screen expanded camera monitor with telemetry (FPS: 59.8, Bitrate: 14.2 Mbps, Resolution: 3840x2160 UHD).
- **Rendered By**: `LiveCameraGridModal`.
- **APIs Called**: None.
- **Data Source**: Uses `cameras: CameraDto[]` passed from parent.
- **Actual Implementation**:
  - **There are zero video streams**.
  - All 12 viewports are black `<div>` containers with CSS borders and static SVG crosshairs.
  - Every online camera card renders a hardcoded box with text `"SEDAN 96%"` and `"MH12AB1234"`.
  - Expanded camera monitor displays a static emoji `📹` with hardcoded string `"3840 x 2160 UHD"`.
- **Runtime Status**: **100% Mocked Visual Simulation**.

---

### 2.11 SecurityWatchlistModal (`frontend/src/components/SecurityWatchlistModal.tsx`)
- **User View**:
  - Card titled `"BEL Watchlist & Alert Engine"`.
  - Two tabs: `Live Alerts` and `Watchlist`.
  - Add button to open a form allowing entry of Plate Number, Reason (e.g. `HIGH_VALUE_STOLEN_VEHICLE`), and Severity (`CRITICAL`, `HIGH`, `MEDIUM`, `LOW`).
- **Rendered By**: `SecurityWatchlistModal`.
- **APIs Called**:
  - `getSecurityAlerts()` -> `GET /api/security-alerts`
  - `getWatchlist()` -> `GET /api/watchlist`
  - `addWatchlistEntry(...)` -> `POST /api/watchlist`
- **Data Source**:
  - In live environment: Proxied through backend to Python `WatchlistManager`.
  - In disconnected environment: Falls back to hardcoded alert `ALT-DEMO-01` (`MH15TC554`) and watchlist `[MH15TC554, KL55R2473]`.
- **Runtime Status**: **Partially Functional / Fallback Mocked**.

---

### 2.12 VehicleRegistrySection & VehicleRegistryModal (`frontend/src/components/VehicleRegistrySection.tsx`, `VehicleRegistryModal.tsx`)
- **User View**:
  - Official Government of India Ministry of Road Transport & Highways (MoRTH) Parivahan Form 23 Certificate of Registration view.
  - High Security Ashoka Stambh emblem, QR verification stamp, digital verification watermark.
  - Comprehensive RC fields: Owner Name, Father's Name, Permanent Address, Maker/Model, Engine No, Chassis No, Fuel Type, Emission Norms (BS-VI), Insurance Status, PUC Certificate No, Hypothecation Bank, Blacklist Status.
  - Button: `"📄 Download Official Form 23 RC Certificate (PDF)"`.
- **Rendered By**: `VehicleRegistrySection` and `VehicleRegistryModal`.
- **APIs Called**:
  - `fetchVehicleRegistryRecord(plate)` calls Next.js server route `/api/vahan/[plate]`.
  - `generateRcPdf(rcRecord)` generates official formatted PDF.
- **Data Source**:
  - For `ET3633P` or `MH12AB1234`: Returns hardcoded static Form 23 object from `KNOWN_REGISTRY_RECORDS`.
  - For `UP11BN5141`: Returns pre-cached RapidAPI JSON response.
  - For other valid Indian plates: Executes live HTTPS POST to RapidAPI endpoint `rto-vehicle-information-india.p.rapidapi.com`.
- **Runtime Status**: **Partially Functional** (Real for arbitrary plates until API quota expires; Mocked for demo plates).

---

### 2.13 AnalyticsDashboard (`frontend/src/components/AnalyticsDashboard.tsx`)
- **User View**:
  - Top metric strip: Total Intersections (12), Active Cameras (10), Monitored Vehicles (1,482), Total Detections (8,940).
  - Vehicle Type Distribution horizontal bar chart (Sedan, SUV, Hatchback, Motorcycle, Truck).
  - Diurnal Traffic Density hourly histogram (8:00 to 21:00).
  - Critical Bottlenecks & Busiest Junctions ranked list.
  - High-Volume Traffic Corridors (Origins, Destinations, Top Routes).
- **Rendered By**: `AnalyticsDashboard`.
- **APIs Called**:
  - `getAnalyticsOverview()` -> `GET /api/analytics/overview`.
- **Data Source & Flaw**:
  - In [`frontend/src/lib/api.ts#L385-L394`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/api.ts#L385-L394):
    ```typescript
    const res = await apiFetch<AnalyticsOverviewDto>("/analytics/overview");
    if (!res || res.totalCameras === 0 || res.totalDetections === 0) {
      return DEMO_ANALYTICS;
    }
    ```
  - If the database has 0 detections, it refuses to display real data and automatically replaces the entire screen with `DEMO_ANALYTICS` (1,482 vehicles, 8,940 detections).
- **Runtime Status**: **Simulated Fallback when DB is empty; Dynamic only after data ingestion**.

---

### 2.14 SystemStatusBar (`frontend/src/components/SystemStatusBar.tsx`)
- **User View**:
  - Header telemetry widget: `API GATEWAY` (`CONNECTED` / `OFFLINE`), `REDIS CACHE` (`UP` / `STANDALONE` / `OFFLINE`), `CAMERA NODES` (`10/12 ONLINE`), `SYSTEM TIME` (live UTC clock).
- **Rendered By**: `SystemStatusBar`.
- **APIs Called**:
  - `getHealth()` -> `GET /api/health`
  - `getCameras()` -> `GET /api/cameras`
- **Data Source**: Real backend health endpoint.
- **Dynamic Updates**: Polls health on mount and runs 1-second clock timer.
- **Backend Connection**: Connected.
- **Runtime Status**: **Functional**.

---

### 2.15 SystemBootLoader (`frontend/src/components/SystemBootLoader.tsx`)
- **User View**:
  - Full-screen modal overlay presenting a high-tech "Smart City OS" boot terminal.
  - Animated log lines: checking CUDA cores, mounting camera topologies, loading YOLOv8s weights, connecting to Redis cluster, initializing PostGIS.
  - Sound effects toggle, progress percentage bar, and "INITIALIZE CONSOLE" exit button.
- **Rendered By**: `SystemBootLoader`.
- **APIs Called**: None.
- **Data Source**: Hardcoded array of diagnostic text strings with staged timers.
- **Dynamic Updates**: Staged CSS/state timers.
- **Runtime Status**: **Pure Visual Aesthetic Animation**.

