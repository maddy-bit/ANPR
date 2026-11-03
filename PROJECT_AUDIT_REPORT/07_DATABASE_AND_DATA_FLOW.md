# 07. Database and Data Flow Audit

## Overview
- **Database Systems**:
  - In-Memory H2: Default development profile (`cityaidb`)
  - PostgreSQL 16 + PostGIS 3.4: Production profile (`cityai`)
- **Cache & Pub/Sub**: Redis 7 Alpine
- **Static Seed Files**: `data/cameras.json` (12 cameras), `data/vehicles.json` (9 mock vehicles)

---

## 1. Database Configuration & Active Profiles

### 1.1 Default Profile (H2 In-Memory)
- **Configuration**: [`backend/src/main/resources/application.yml#L5-L19`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application.yml#L5-L19)
- **JDBC URL**: `jdbc:h2:mem:cityaidb;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE;MODE=PostgreSQL`
- **Driver**: `org.h2.Driver`
- **Hibernate Dialect**: `org.hibernate.dialect.H2Dialect`
- **DDL Mode**: `update`
- **H2 Web Console**: Enabled at `/h2-console`
- **Lifecycle**: Volatile in-memory storage. All tables and rows are wiped when the Spring Boot process stops.

### 1.2 Production Profile (PostgreSQL + PostGIS)
- **Configuration**: [`backend/src/main/resources/application-postgres.yml#L9-L23`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application-postgres.yml#L9-L23)
- **Activation Flag**: `SPRING_PROFILES_ACTIVE=postgres`
- **JDBC URL**: `${DB_URL:jdbc:postgresql://localhost:5432/cityai}`
- **Driver**: `org.postgresql.Driver`
- **Hibernate Dialect**: `org.hibernate.dialect.PostgreSQLDialect`
- **DDL Mode**: `update`
- **H2 Console**: Explicitly disabled (`h2.console.enabled: false`)

---

## 2. Entity Definitions, Relationships & SQL Schema

```
┌───────────────────────┐             ┌──────────────────────────────────┐
│        cameras        │             │             vehicles             │
├───────────────────────┤             ├──────────────────────────────────┤
│ id: VARCHAR(255) [PK] │             │ id: BIGINT GENERATED [PK]        │
│ name: VARCHAR(255)    │             │ plate: VARCHAR(255) [UNIQUE]     │
│ latitude: DOUBLE      │             │ vehicle_type: VARCHAR(255)       │
│ longitude: DOUBLE     │             │ color: VARCHAR(255)              │
│ direction: VARCHAR    │             │ make: VARCHAR(255)               │
│ status: VARCHAR       │             │ model: VARCHAR(255)              │
│ video_source: VARCHAR │             └───────────────┬──────────────────┘
│ location: GEOGRAPHY * │                             │
└───────────┬───────────┘                             │ 1
            │                                         │
            │ 1                                       │
            │          ┌───────────────────────────┐  │
            └─────────►│    vehicle_detections     │◄─┘ (0..1, nullable)
             (mandatory│├───────────────────────────┤
              camera_id││ id: BIGINT GENERATED [PK]│
                       ││ vehicle_id: BIGINT [FK]  │
                       ││ camera_id: VARCHAR [FK]  │
                       ││ timestamp: TIMESTAMP     │
                       ││ latitude: DOUBLE         │
                       ││ longitude: DOUBLE        │
                       ││ direction: VARCHAR       │
                       ││ speed_kmh: DOUBLE        │
                       ││ vehicle_class: VARCHAR   │
                       ││ detection_confidence: DBL│
                       ││ plate_confidence: DOUBLE │
                       ││ plate_text_raw: VARCHAR  │
                       ││ plate_text_norm: VARCHAR │
                       ││ reid_confidence: DOUBLE  │
                       ││ image_path: VARCHAR      │
                       ││ track_id: INTEGER        │
                       ││ frame_number: INTEGER    │
                       ││ location: GEOGRAPHY *    │
                       │└───────────────────────────┘

┌─────────────────────────────────┐
│       audit_log_entries         │
├─────────────────────────────────┤
│ id: BIGINT GENERATED [PK]       │
│ timestamp: TIMESTAMP            │
│ action: VARCHAR(255)            │
│ plate: VARCHAR(255)             │
│ remote_address: VARCHAR(255)    │
└─────────────────────────────────┘

* Note: `location` geography column and GiST index exist ONLY under PostgreSQL profile.
```

### 2.1 Entity Details
1. **`Camera`** ([`Camera.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/model/Camera.java#L14-L88)):
   - Table: `cameras`
   - Primary Key: `id` (`VARCHAR`, e.g. `"CAM-01"`).
   - Fields: `name`, `latitude`, `longitude`, `direction`, `status` (`ONLINE`, `PROCESSING`, `OFFLINE`), `videoSource`.
2. **`Vehicle`** ([`Vehicle.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/model/Vehicle.java#L16-L88)):
   - Table: `vehicles`
   - Primary Key: `id` (`BIGINT IDENTITY`).
   - Unique Constraint: `plate` (`VARCHAR`, normalized registration number).
   - Fields: `vehicleType`, `color`, `make`, `model`.
3. **`VehicleDetection`** ([`VehicleDetection.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/model/VehicleDetection.java#L22-L87)):
   - Table: `vehicle_detections`
   - Indexes: `idx_detection_camera_time (camera_id, timestamp)`, `idx_detection_vehicle_time (vehicle_id, timestamp)`.
   - Relationships:
     - `@ManyToOne(optional = true) vehicle`: Nullable to store unreadable plates as unlinked evidence.
     - `@ManyToOne(optional = false) camera`: Mandatory foreign key reference.
   - Fields: `timestamp`, `latitude`, `longitude`, `direction`, `speedKmh`, `vehicleClass`, `detectionConfidence`, `plateConfidence`, `plateTextRaw`, `plateTextNormalized`, `reidConfidence`, `imagePath`, `trackId`, `frameNumber`.
4. **`AuditLogEntry`** ([`AuditLogEntry.java`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/model/AuditLogEntry.java#L16-L59)):
   - Table: `audit_log_entries`
   - Fields: `timestamp`, `action` (`"VEHICLE_SEARCH"`, `"TRAJECTORY_VIEW"`), `plate`, `remoteAddress`.

---

## 3. PostGIS Schema Alterations

When running with `SPRING_PROFILES_ACTIVE=postgres`, [`PostGisMigrationRunner.java#L42-L57`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/spatial/PostGisMigrationRunner.java#L42-L57) executes raw SQL:
```sql
CREATE EXTENSION IF NOT EXISTS postgis;

-- Add generated spatial column to cameras
ALTER TABLE cameras ADD COLUMN IF NOT EXISTS location geography(Point,4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS idx_cameras_location ON cameras USING GIST(location);

-- Add generated spatial column to vehicle_detections
ALTER TABLE vehicle_detections ADD COLUMN IF NOT EXISTS location geography(Point,4326)
    GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)::geography) STORED;
CREATE INDEX IF NOT EXISTS idx_vehicle_detections_location ON vehicle_detections USING GIST(location);
```

---

## 4. Repositories & Actual SQL Queries Executed

| Repository | Query Method | Execution Mechanism | Actual SQL Executed |
| :--- | :--- | :--- | :--- |
| **`CameraRepository`** | `findAll()` | Spring Data JPA | `SELECT id, direction, latitude, longitude, name, status, video_source FROM cameras;` |
| **`CameraRepository`** | `findById(id)` | Spring Data JPA | `SELECT ... FROM cameras WHERE id = ?;` |
| **`VehicleRepository`** | `findByPlate(plate)` | Spring Data JPA | `SELECT id, color, make, model, plate, vehicle_type FROM vehicles WHERE plate = ?;` |
| **`VehicleDetectionRepository`** | `findByVehicle_PlateOrderByTimestampAsc(plate)` | Spring Data JPA Join | `SELECT d.* FROM vehicle_detections d JOIN vehicles v ON d.vehicle_id = v.id WHERE v.plate = ? ORDER BY d.timestamp ASC;` |
| **`AuditLogRepository`** | `findAllByOrderByTimestampDesc(pageable)` | Spring Data JPA Paging | `SELECT id, action, plate, remote_address, timestamp FROM audit_log_entries ORDER BY timestamp DESC LIMIT ?;` |
| **`SpatialCameraService`** | `findNearby(lat, lon, radiusKm)` | JdbcTemplate Native SQL | `SELECT id, name, latitude, longitude, direction, status FROM cameras WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography, ?) ORDER BY location <-> ST_SetSRID(ST_MakePoint(?, ?), 4326)::geography;` |

---

## 5. Seed Data & Startup Persistence

### 5.1 Cameras Seed Data (`data/cameras.json`)
- **Seeded by**: [`DataSeedService.java#L36-L57`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/DataSeedService.java#L36-L57)
- **Condition**: Executes on startup only if `cameraRepository.count() == 0`.
- **Loaded Records**: 12 camera junctions in Pune:
  - `CAM-01`: Shivajinagar Chowk (`18.5308, 73.8474`, SE, ONLINE)
  - `CAM-02`: FC Road Junction (`18.5236, 73.8478`, S, ONLINE)
  - `CAM-03`: JM Road - Deccan Gymkhana (`18.5158, 73.8412`, SW, ONLINE)
  - `CAM-04`: Karve Road Bridge (`18.5074, 73.8258`, W, ONLINE)
  - `CAM-05`: Swargate Junction (`18.5008, 73.8567`, E, ONLINE)
  - `CAM-06`: Hadapsar Industrial Estate (`18.5089, 73.9260`, E, ONLINE)
  - `CAM-07`: Kothrud Depot (`18.5074, 73.8077`, NW, ONLINE)
  - `CAM-08`: Baner Road (`18.5642, 73.7769`, N, ONLINE)
  - `CAM-09`: Hinjewadi Phase 1 (`18.5908, 73.7392`, W, PROCESSING)
  - `CAM-10`: Wakad Bridge (`18.5993, 73.7629`, N, ONLINE)
  - `CAM-11`: Aundh - ITI Road (`18.5590, 73.8080`, NE, ONLINE)
  - `CAM-12`: University Circle (`18.5529, 73.8291`, SE, OFFLINE)

### 5.2 Vehicles Seed Data (`data/vehicles.json`)
- **NOT Seeded into Database**: [`DataSeedService.java#L17-L19`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/DataSeedService.java#L17-L19) explicitly notes:
  *"Vehicles are NOT seeded here - they're created lazily as detections come in, enriched from the mock registry."*
- **In-Memory Mock Store**: Loaded by [`MockVehicleRegistryService.java#L33-L53`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/MockVehicleRegistryService.java#L33-L53) into `Map<String, VehicleRegistryRecord> byPlate` (contains 9 vehicles: `ET3633P`, `MH12AB1234`, `MH14CD5678`, `MH12EF9012`, `MH20GH3456`, `MH12IJ7890`, `MH04KL2345`, `MH12MN6789`, `MH12OP0123`).

---

## 6. Redis Configuration, Keys, TTL & Pub/Sub

### 6.1 Redis Connection & Lettuce Pool
- Configured in [`application.yml#L25-L37`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application.yml#L25-L37):
  - Host: `${REDIS_HOST:localhost}`
  - Port: `${REDIS_PORT:6379}`
  - Max Active Connections: 16
  - Max Idle: 8, Min Idle: 2
  - Max Wait: 1000ms

### 6.2 Redis Keys & Data Structures

| Key Pattern | Redis Type | Component | TTL | Description |
| :--- | :--- | :--- | :--- | :--- |
| `ratelimit:<clientIp>:<epochMinute>` | `string` (integer counter) | `RedisRateLimiterFilter` | 65 seconds | Token counter for IP rate limiting (capped at 300) |
| `cameras::all` | `string` (JSON serialization) | `CameraController` | 10 minutes | Cached list of all cameras |
| `cameras::<cameraId>` | `string` (JSON serialization) | `CameraController` | 10 minutes | Cached single camera DTO |
| `trajectories::<plate>` | `string` (JSON serialization) | `TrajectoryEngine` | 10 minutes | Cached reconstructed trajectory DTO |
| `cityai:job:<jobId>` | `string` (JSON) | Python `RedisService` | 1 hour | Video ingestion job status & progress |
| `cityai:plate_cache:<cropHash>` | `string` (JSON) | Python `RedisService` | None | OCR text cache for vehicle crop hash |

### 6.3 Redis Pub/Sub
- **Topic**: `cityai:detections`
- **Publisher**: [`DetectionIngestionService.java#L90`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/DetectionIngestionService.java#L90) publishes newly ingested `VehicleDetectionDto` on every successful `POST /api/detections/ingest`.
- **Subscriber**: [`RedisPubSubService.java#L74-L84`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/RedisPubSubService.java#L74-L84) listens on `cityai:detections` and logs incoming distributed events.
- **Fail-Safe**: If Redis is offline, both publisher and subscriber log a debug message and gracefully continue without throwing HTTP errors.

---

## 7. Data Provenance Classification

| Data Element | Real | Generated / Synthetic | Seeded | Hardcoded | Simulated |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Camera Coordinates & Names** | | | **X** (from `cameras.json`) | | |
| **Seeded Vehicles Metadata** | | | **X** (from `vehicles.json`) | | |
| **Arbitrary Vehicle Search Record** | | **X** (`hashCode` generated) | | | |
| **Empty Vehicle Summary Result** | | | | **X** (in `VehicleController`) | |
| **Empty Trajectory Waypoints** | | | | **X** (in `TrajectoryEngine`) | |
| **Live Tracking Detection Events**| | | | | **X** (3s paced replay) |
| **Real-Time Video Plate Bounding Box** | | | | **X** (fixed 35%w, 70%h) | |
| **ET3633P / MH12AB1234 VAHAN Record** | | | | **X** (in `registry.ts`) | |
| **Arbitrary Plate VAHAN Record** | **X** (via RapidAPI) | | | | |
| **Road Route Vector Line** | **X** (via OSRM) | **X** (via spline fallback) | | | |
| **Ingested Detection via Script** | **X** (from YOLO + EasyOCR) | | | | |
| **Appearance Re-ID Score in Route** | | | | **X** (constant 0.6) | |

