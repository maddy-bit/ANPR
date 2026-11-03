# 05. Backend API Audit

## Overview
- **Framework**: Spring Boot 3.3.4 on Java 21
- **Persistence**: Spring Data JPA / Hibernate
- **Caching & Messaging**: Spring Data Redis (Lettuce), Spring Cache
- **Security**: Spring Security (HTTP Basic on selected endpoints)
- **Real-time Protocol**: Spring WebSocket (`TextWebSocketHandler`)
- **Total Controllers**: 9
- **Total Documented Endpoints**: 17

---

## 1. Complete API Inventory & Technical Audit

### 1.1 `GET /api/health`
- **Controller**: [`HealthController.java#L24-L29`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/HealthController.java#L24-L29)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll` (No authentication required)
- **Request Parameters**: None
- **Response Structure**:
  ```json
  {
    "status": "ok",
    "service": "city-ai-backend",
    "version": "0.1.0",
    "timestamp": "2026-11-02T09:44:23.123Z",
    "redisStatus": "UP", // or "STANDALONE_FALLBACK"
    "redisLatencyMs": 4
  }
  ```
- **Service Called**: `RedisPubSubService.checkLatencyMs()`
- **Database Tables Accessed**: None
- **Business Logic Executed**: Probes Redis server with `connection.ping()`. If response is `"PONG"`, returns latency in milliseconds; otherwise flags status as `"STANDALONE_FALLBACK"`.
- **Error Handling**: Catches exceptions in ping probe, gracefully defaults to null latency.
- **Connection Status**: **Fully Connected & Real**.

---

### 1.2 `GET /api/cameras`
- **Controller**: [`CameraController.java#L31-L35`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L31-L35)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Request Parameters**: None
- **Caching**: `@Cacheable(value = "cameras", key = "'all'")` (TTL: 10 minutes)
- **Response Structure**:
  ```json
  [
    {
      "id": "CAM-01",
      "name": "Shivajinagar Chowk",
      "latitude": 18.5308,
      "longitude": 73.8474,
      "direction": "SE",
      "status": "ONLINE",
      "videoSource": "videos/cam01.mp4"
    }
  ]
  ```
- **Repository Called**: `CameraRepository.findAll()`
- **Database Tables Accessed**: `cameras` table
- **Business Logic Executed**: Retrieves all seeded or saved camera records from SQL database and maps to `CameraDto`.
- **Connection Status**: **Fully Connected & Real** (seeded from `data/cameras.json`).

---

### 1.3 `GET /api/cameras/{cameraId}`
- **Controller**: [`CameraController.java#L57-L66`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L57-L66)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Request Parameters**: Path variable `cameraId` (e.g. `CAM-01`)
- **Caching**: `@Cacheable(value = "cameras", key = "#cameraId")`
- **Response Structure**: Single `CameraDto` object
- **Repository Called**: `CameraRepository.findById(cameraId)`
- **Database Tables Accessed**: `cameras` table
- **Error Handling**: Throws `NoSuchElementException("Unknown camera: <id>")` resulting in HTTP 404 handled by `ApiExceptionHandler`.
- **Connection Status**: **Fully Connected & Real**.

---

### 1.4 `GET /api/cameras/nearby`
- **Controller**: [`CameraController.java#L44-L55`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/CameraController.java#L44-L55)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Request Parameters**:
  - `lat` (double, required)
  - `lon` (double, required)
  - `radiusKm` (double, optional, default: 5.0)
- **Service Called**: `SpatialCameraService.findNearby(lat, lon, radiusKm)`
- **Database Tables Accessed**: `cameras` table via PostGIS native SQL query
- **SQL Executed**:
  ```sql
  SELECT id, name, latitude, longitude, direction, status
  FROM cameras
  WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?)
  ORDER BY location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography;
  ```
- **Error Handling / Profile Restriction**:
  - `SpatialCameraService` is annotated with `@Profile("postgres")`.
  - On the default H2 profile, `spatialCameraService.getIfAvailable()` returns `null`.
  - The controller throws `ResponseStatusException(HttpStatus.NOT_IMPLEMENTED, "Spatial queries require the 'postgres' profile...")`.
- **Connection Status**: **Partially Functional** (Real on PostgreSQL + PostGIS; returns 501 on default H2).

---

### 1.5 `GET /api/vehicles/{plate}`
- **Controller**: [`VehicleController.java#L43-L87`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/VehicleController.java#L43-L87)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Rate Limit**: Enforced by `RedisRateLimiterFilter` (300 req/min)
- **Request Parameters**: Path variable `plate` (e.g. `ET3633P` or `MH12AB1234`)
- **Services & Repositories Called**:
  - `PlateNormalizer.normalize(plate)`
  - `AuditLogService.record("VEHICLE_SEARCH", normalized, request)`
  - `VehicleRepository.findByPlate(normalized)`
  - `VehicleRegistryService.lookup(normalized)`
  - `VehicleDetectionRepository.findByVehicle_PlateOrderByTimestampAsc(normalized)`
- **Database Tables Accessed**: `vehicles`, `vehicle_detections`, `audit_log_entries`
- **Business Logic Executed**:
  1. Records search action in `audit_log_entries`.
  2. Queries `vehicles` table. If not found, calls `MockVehicleRegistryService.lookup()`.
  3. `MockVehicleRegistryService` **synthesizes a fake vehicle using hash of plate** and saves it to the `vehicles` table.
  4. Queries `vehicle_detections` table for this vehicle.
  5. **Mock Fallback**: If detections list is empty (`detections.isEmpty()`), it returns:
     ```java
     List<String> demoCameras = List.of("CAM-01", "CAM-03", "CAM-07", "CAM-11");
     return new VehicleSummaryDto(
         VehicleDto.from(vehicle),
         Instant.parse("2026-08-30T18:14:23Z"),
         Instant.parse("2026-08-30T18:48:02Z"),
         demoCameras.size(),
         demoCameras,
         15
     );
     ```
- **Connection Status**: **Contains Mock Fallback** (Returns fake dates, cameras, and detection counts if DB has no detections).

---

### 1.6 `GET /api/vehicles/{plate}/detections`
- **Controller**: [`VehicleController.java#L89-L95`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/VehicleController.java#L89-L95)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Request Parameters**: Path variable `plate`
- **Repository Called**: `VehicleDetectionRepository.findByVehicle_PlateOrderByTimestampAsc(normalized)`
- **Database Tables Accessed**: `vehicle_detections`
- **Response Structure**: List of `VehicleDetectionDto` objects (empty if no real detections ingested).
- **Connection Status**: **Fully Connected & Real** (does not inject fake detections).

---

### 1.7 `GET /api/vehicles/{plate}/trajectory`
- **Controller**: [`TrajectoryController.java#L25-L30`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/TrajectoryController.java#L25-L30)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Caching**: `@Cacheable(value = "trajectories", key = "#normalizedPlate")`
- **Services & Repositories Called**:
  - `PlateNormalizer.normalize(plate)`
  - `AuditLogService.record("TRAJECTORY_VIEW", normalized, request)`
  - `TrajectoryEngine.reconstructAsDto(normalized)`
- **Database Tables Accessed**: `vehicles`, `vehicle_detections`, `cameras`, `audit_log_entries`
- **Business Logic Executed**:
  1. Resolves vehicle identity (or generates synthetic one via `MockVehicleRegistryService`).
  2. Queries detections and groups consecutive same-camera sightings into `CameraVisit` records.
  3. **Mock Fallback**: In [`TrajectoryEngine.java#L128-L133`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/trajectory/TrajectoryEngine.java#L128-L133):
     If `visits.isEmpty()`, calls `buildFallbackVisits()`:
     - Checkpoint 1: `CAM-01` (`2026-08-30T18:14:23Z`, plateConf: 0.95, detConf: 0.92, img: `"CAM-01/frame_001.jpg"`)
     - Checkpoint 2: `CAM-03` (+600s, plateConf: 0.93, detConf: 0.92, img: `"CAM-03/frame_001.jpg"`)
     - Checkpoint 3: `CAM-07` (+1200s, plateConf: 0.91, detConf: 0.92, img: `"CAM-07/frame_001.jpg"`)
     - Checkpoint 4: `CAM-11` (+1800s, plateConf: 0.89, detConf: 0.92, img: `"CAM-11/frame_001.jpg"`)
     - Fabricates transitions with implied speed 19.2 km/h, distance 11.2 km, duration 34 min, overall confidence 0.94.
  4. If real visits exist, scores transitions via `TrajectoryScoringService.score()`. Note that `appearanceScore` is hardcoded to `0.6`.
- **Connection Status**: **Contains Mock Fallback** (Fabricates 4-checkpoint trajectory for any vehicle with 0 detections).

---

### 1.8 `POST /api/detections/ingest`
- **Controller**: [`DetectionController.java#L30-L34`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/DetectionController.java#L30-L34)
- **HTTP Method**: `POST`
- **Auth Requirements**: **HTTP Basic Auth** (`ROLE_INGEST`, username: `ingest`)
- **Rate Limit**: Enforced by `RedisRateLimiterFilter`
- **Request Body**:
  ```json
  {
    "cameraId": "CAM-01",
    "timestamp": "2026-09-05T12:00:15Z",
    "vehicleClass": "car",
    "detectionConfidence": 0.94,
    "plateTextRaw": "MH 12 AB 1234",
    "plateTextNormalized": "MH12AB1234",
    "plateConfidence": 0.91,
    "trackId": 3,
    "frameNumber": 120,
    "imagePath": "CAM-01/crop_frame120_track3.jpg"
  }
  ```
- **Service Called**: `DetectionIngestionService.ingest(request)`
- **Database Tables Accessed**: `cameras` (read), `vehicles` (read/insert), `vehicle_detections` (insert)
- **Business Logic Executed**:
  1. Validates camera existence.
  2. Resolves or creates vehicle record from `plateTextNormalized`.
  3. Inserts row into `vehicle_detections`.
  4. Evicts cached trajectories and vehicle summaries for this plate from Spring Redis cache (`evictPlateCaches`).
  5. Publishes `VehicleDetectionDto` to Redis topic `cityai:detections` via `RedisPubSubService.publishDetection()`.
- **Response**: HTTP 201 CREATED with stored `VehicleDetectionDto`.
- **Connection Status**: **Fully Connected & Real**.

---

### 1.9 `POST /api/detections/ingest/batch`
- **Controller**: [`DetectionController.java#L36-L43`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/DetectionController.java#L36-L43)
- **HTTP Method**: `POST`
- **Auth Requirements**: **HTTP Basic Auth** (`ROLE_INGEST`)
- **Request Body**: JSON Array of `DetectionIngestRequest` objects
- **Business Logic Executed**: Maps each item to `ingestionService.ingest(request)` and returns HTTP 201 CREATED with list of saved entities.
- **Connection Status**: **Fully Connected & Real**.

---

### 1.10 `GET /api/analytics/overview`
- **Controller**: [`AnalyticsController.java#L19-L22`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AnalyticsController.java#L19-L22)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **Service Called**: `AnalyticsService.overview()`
- **Database Tables Accessed**: `cameras`, `vehicles`, `vehicle_detections`
- **Business Logic Executed**:
  1. Counts camera statuses (Online, Processing, Offline).
  2. Aggregates `vehicleTypeDistribution` from `vehicles` table.
  3. Groups detections by UTC hour from `vehicle_detections` table.
  4. Ranks `busiestCameras` by detection count.
  5. For each vehicle in the database, calls `trajectoryEngine.reconstruct(plate)`.
  6. **Indirect Mock Injection**: If a vehicle has zero detections, `trajectoryEngine` returns the 4 fallback visits (`CAM-01 -> CAM-03 -> CAM-07 -> CAM-11`). The analytics service incorporates these fake transitions into its `topRoutes` and `averageTransitionSpeedKmh` metrics!
  7. If database is completely empty (0 detections), returns an empty overview DTO (which frontend then overrides with `DEMO_ANALYTICS`).
- **Connection Status**: **Partially Real / Polluted by Fallback Trajectories**.

---

### 1.11 `GET /api/audit/recent`
- **Controller**: [`AuditController.java#L28-L33`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AuditController.java#L28-L33)
- **HTTP Method**: `GET`
- **Auth Requirements**: **HTTP Basic Auth** (`ROLE_INGEST`)
- **Request Parameters**: `limit` (integer, default: 50, capped at 500)
- **Repository Called**: `AuditLogRepository.findAllByOrderByTimestampDesc(PageRequest.of(0, limit))`
- **Database Tables Accessed**: `audit_log_entries`
- **Response Structure**: List of `AuditLogEntryDto` (id, timestamp, action, plate, remoteAddress).
- **Connection Status**: **Fully Connected & Real**.

---

### 1.12 `GET /api/watchlist` (AI Proxy)
- **Controller**: [`AiProxyController.java#L34-L58`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L34-L58)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **External Call**: `restTemplate.getForObject("${ai-service.base-url}/watchlist", Object.class)`
- **Error Handling / Fallback**: Catches `Exception` and returns hardcoded array:
  ```json
  [
    { "plateNumber": "MH15TC554", "reason": "HIGH_VALUE_STOLEN_VEHICLE", "severity": "CRITICAL" },
    { "plateNumber": "KL55R2473", "reason": "SUSPECT_OF_INTEREST", "severity": "HIGH" }
  ]
  ```
- **Connection Status**: **Proxy with Hardcoded Mock Fallback**.

---

### 1.13 `POST /api/watchlist` (AI Proxy)
- **Controller**: [`AiProxyController.java#L60-L70`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L60-L70)
- **HTTP Method**: `POST`
- **Auth Requirements**: `permitAll`
- **External Call**: `restTemplate.postForObject("${ai-service.base-url}/watchlist", body, Object.class)`
- **Error Handling / Fallback**: If AI service fails, echoes back the incoming request body with HTTP 200 OK.
- **Connection Status**: **Proxy with Echo Fallback**.

---

### 1.14 `POST /api/process-video` (AI Proxy)
- **Controller**: [`AiProxyController.java#L72-L87`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L72-L87)
- **HTTP Method**: `POST`
- **Auth Requirements**: `permitAll`
- **External Call**: `restTemplate.postForObject("${ai-service.base-url}/process-video", body, Object.class)`
- **Error Handling / Fallback**: Catches `Exception` and returns hardcoded mock:
  ```json
  {
    "cameraId": "CAM-01",
    "videoPath": "videos/cam01.mp4",
    "framesProcessed": 120,
    "detectionsCount": 15
  }
  ```
- **Connection Status**: **Proxy with Hardcoded Mock Fallback**.

---

### 1.15 `GET /api/security-alerts` (AI Proxy)
- **Controller**: [`AiProxyController.java#L89-L111`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L89-L111)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **External Call**: `restTemplate.getForObject("${ai-service.base-url}/security-alerts", Object.class)`
- **Error Handling / Fallback**: Catches `Exception` and returns hardcoded alert list containing:
  ```json
  [
    {
      "alertId": "ALT-DEMO-01",
      "alertType": "HOTLIST_MATCH",
      "severity": "CRITICAL",
      "plateNumber": "MH15TC554",
      "cameraId": "CAM-01",
      "description": "SECURITY ALERT: Watchlisted high-value vehicle 'MH15TC554' spotted on CAM-01!"
    }
  ]
  ```
- **Connection Status**: **Proxy with Hardcoded Mock Fallback**.

---

### 1.16 `GET /api/predict-trajectory/{globalId}` (AI Proxy)
- **Controller**: [`AiProxyController.java#L113-L123`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L113-L123)
- **HTTP Method**: `GET`
- **Auth Requirements**: `permitAll`
- **External Call**: `restTemplate.getForObject("${ai-service.base-url}/predict-trajectory/" + globalId, Object.class)`
- **Error Handling / Fallback**: Returns `[]` on error.
- **Contract Bug**: Frontend calls this endpoint with a license plate (e.g. `ET3633P`), but AI service expects internal UUID `globalId`.
- **Connection Status**: **Broken Contract / Proxy**.

---

### 1.17 `GET /ws/live/{plate}` (WebSocket)
- **Handler**: [`LiveTrackingWebSocketHandler.java#L51-L85`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java#L51-L85)
- **Protocol**: WebSocket
- **Auth Requirements**: None (unauthenticated handshake)
- **Execution**:
  - Reconstructs trajectory via `trajectoryEngine.reconstructAsDto(normalized)`.
  - Paces messages through `scheduler.schedule(..., (index + 1) * 3, TimeUnit.SECONDS)`.
  - Emits JSON payloads for `connected`, `detection`, and `complete`.
- **Connection Status**: **Simulated Timed Replay**.

