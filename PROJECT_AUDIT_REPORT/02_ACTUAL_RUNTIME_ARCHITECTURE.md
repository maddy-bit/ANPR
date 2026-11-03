# 02. Actual Runtime Architecture

## Architecture Ground Truth
This document describes the **actual implemented runtime architecture**, derived strictly from executable lines of code in the repository. Uninvoked classes, uncalled APIs, and speculative design patterns are identified as such.

---

## 1. Services & Port Map

| Service Name | Technology / Runtime | Port (Local) | Port (Docker) | Production Hosted URL (Fallbacks) | Source Config File |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Frontend** | Next.js 16 (Node.js 22) | `3000` | `3000` | `https://sih-project-frontend-dzro.vercel.app` | `frontend/package.json`, `next.config.ts` |
| **Backend API** | Spring Boot 3.3.4 (Java 21) | `8080` | `8080` | `https://sih-project-62k1.onrender.com` | `backend/src/main/resources/application.yml` |
| **AI Microservice** | FastAPI (Python 3.11/3.12) | `8000` | `8000` | `https://city-ai-engine.onrender.com` | `ai-service/main.py`, `ai-service/config.py` |
| **Database** | PostgreSQL 16 + PostGIS 3.4 / H2 | `5432` | `5432` | N/A (Internal / Containerized) | `docker-compose.yml`, `application-postgres.yml` |
| **Cache & Pub/Sub**| Redis 7 Alpine | `6379` | `6379` | N/A (Internal / Containerized) | `docker-compose.yml`, `RedisConfig.java` |

---

## 2. Inter-Service Communication Matrix

```
                      ┌──────────────────────────────────────────────┐
                      │              Web Browser (User)              │
                      └──────────────┬───────────────────────────────┘
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
                 ▼ (Port 3000)                           ▼ (Port 8080)
┌─────────────────────────────────┐     HTTP Rewrites    ┌─────────────────────────────────┐
│     Next.js Frontend Server     ├─────────────────────►│    Spring Boot Backend API      │
│  - React 19 UI / MapLibre GL    │  (or direct browser) │  - Ingestion, Trajectory Engine │
│  - Route: /api/vahan/[plate]    │                      │  - WebSocket: /ws/live/{plate}  │
│  - Route: /api/yolo/detect      │                      │  - AiProxyController            │
└──────┬──────────────────┬───────┘                      └───────┬─────────┬───────────────┘
       │                  │                                      │         │
       │ HTTP / RapidAPI  │ HTTP (Hardcoded localhost:8000)      │         │
       ▼                  ▼                                      │         │
┌──────────────┐   ┌──────────────┐                              │         │
│ RapidAPI     │   │              │◄─────────────────────────────┘         │
│ Parivahan    │   │  FastAPI     │    HTTP RestTemplate                   │
│ VAHAN Portal │   │  AI Service  │    (ai-service.base-url)               │
└──────────────┘   │  (Port 8000) │                                        │
                   └──┬────────┬──┘                                        │
                      │        │                                           │
                      │        │ Redis                                     │ Redis
                      │        │ (aioredis)                                │ (Lettuce)
                      │        ▼                                           ▼
                      │    ┌────────────────────────────────────────────────────────┐
                      │    │                   Redis 7 (Port 6379)                  │
                      │    │   - Rate Limit Counters: ratelimit:<ip>:<min>          │
                      │    │   - Pub/Sub Channel: cityai:detections                 │
                      │    │   - Spring Cache: cameras, trajectories                │
                      │    └────────────────────────────────────────────────────────┘
                      │
                      │
                      ▼ Database (JDBC)
           ┌─────────────────────────────────────────┐
           │ Database Engine (Port 5432 / In-Memory) │
           │ - Default: H2 in-memory (cityaidb)      │
           │ - Prod: PostgreSQL 16 + PostGIS 3.4     │
           │   Tables: cameras, vehicles,            │
           │           vehicle_detections, audit_log │
           └─────────────────────────────────────────┘
```

---

## 3. Communication Channel Details

### 3.1 Frontend to Backend Communication
1. **Next.js Reverse Proxy Rewrites**:
   - **Source**: [`frontend/next.config.ts#L8-L27`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/next.config.ts#L8-L27)
   - **Mechanism**: Next.js server proxies incoming requests matching `/api/:path((?!vahan\/).*)` to `${NEXT_PUBLIC_API_BASE_URL}/api/:path*`.
   - **Exceptions**: `/api/vahan/*` is explicitly excluded to route to Next.js native API route.
   - **WebSocket Proxy**: `/ws/:path*` is proxied to `${backendUrl}/ws/:path*`.
   - **Evidence Files**: `/evidence/:path*` is proxied to `${backendUrl}/evidence/:path*`.
2. **Direct Browser API Calls**:
   - **Source**: [`frontend/src/lib/api.ts#L6-L14`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/api.ts#L6-L14)
   - Function `getApiBaseUrl()` evaluates `process.env.NEXT_PUBLIC_API_BASE_URL`. If undefined and hostname is `localhost`, resolves to `http://localhost:8080`.

### 3.2 Frontend to AI Service Communication
1. **Real-Time Client Frame Inference**:
   - **Source**: [`frontend/src/app/api/yolo/detect/route.ts#L14-L19`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/yolo/detect/route.ts#L14-L19)
   - **Mechanism**: The browser grabs a video frame from an HTML5 `<video>` tag onto an offscreen canvas every 260ms in [`EvidenceViewer.tsx#L108-L118`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/EvidenceViewer.tsx#L108-L118) and POSTs `{ image, targetPlate, cameraId }` to `/api/yolo/detect`.
   - **Hardcoded Target**: The server route invokes `fetch("http://localhost:8000/detect-plate", ...)` with an 1800ms timeout.
   - **Failure Behavior**: If `http://localhost:8000` is unreachable (e.g. in Docker or Vercel), it silently catches the error and returns `{ success: true, detected: false }`.

### 3.3 Backend to AI Service Communication
1. **HTTP RestTemplate Proxy**:
   - **Source**: [`backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L28-L32`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/controller/AiProxyController.java#L28-L32)
   - **Base URL**: Driven by `${ai-service.base-url}`, which defaults to `https://city-ai-engine.onrender.com` in [`application.yml#L63`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application.yml#L63) and is overridden to `http://ai-service:8000` in `docker-compose.yml`.
   - **Endpoints Proxied**:
     - `GET /api/watchlist` -> calls `GET ${aiServiceBaseUrl}/watchlist`
     - `POST /api/watchlist` -> calls `POST ${aiServiceBaseUrl}/watchlist`
     - `POST /api/process-video` -> calls `POST ${aiServiceBaseUrl}/process-video`
     - `GET /api/security-alerts` -> calls `GET ${aiServiceBaseUrl}/security-alerts`
     - `GET /api/predict-trajectory/{globalId}` -> calls `GET ${aiServiceBaseUrl}/predict-trajectory/{globalId}`
   - **Fallback Mechanism**: Every endpoint in `AiProxyController.java` catches `Exception` and returns hardcoded mock JSON objects instead of propagating the error.

### 3.4 WebSocket Communication (Live Tracking)
1. **Endpoint**: `GET /ws/live/{plate}`
2. **Server Handler**: [`backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java#L51-L85`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java#L51-L85)
3. **Client Connection**: [`frontend/src/lib/liveClient.ts#L50-L72`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/liveClient.ts#L50-L72)
4. **Actual Mechanism**:
   - Upon connection, the handler normalizes the plate string.
   - It calls `trajectoryEngine.reconstructAsDto(normalized)`.
   - It schedules tasks using `ScheduledExecutorService scheduler = Executors.newScheduledThreadPool(4)`.
   - Events are emitted every 3 seconds (`EVENT_INTERVAL_SECONDS = 3`):
     - `type: "connected"` (initial)
     - `type: "detection"`, `index: N`, `point: {...}` (every 3s)
     - `type: "complete"`, `overallConfidence: 0.893`, etc. (final event)
   - **Reality**: It is **not** connected to a live CCTV RTSP feed; it is a timed replay of static or pre-computed trajectory waypoints.

### 3.5 Database Connections
1. **Spring Data JPA / Hibernate**:
   - **Configuration**: [`application.yml#L5-L19`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application.yml#L5-L19)
   - **Default Profile**: In-memory H2 database (`jdbc:h2:mem:cityaidb`). Hibernate DDL auto is `update`.
   - **PostgreSQL Profile**: `jdbc:postgresql://localhost:5432/cityai` (`application-postgres.yml#L10-L23`).
   - **PostGIS Initialization**: [`PostGisMigrationRunner.java#L42-L57`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/spatial/PostGisMigrationRunner.java#L42-L57) executes raw SQL on startup to create geography point columns and GiST spatial indexes.
2. **AI Microservice**:
   - **No Database Connection**: The Python AI microservice has **no database connection or ORM**. All observations, records, and topologies exist exclusively in RAM (`GlobalVehicleRegistry.records = {}`).

### 3.6 Redis Communication
1. **Backend Redis Usage**:
   - **Connection Pool**: Lettuce connection pool configured in [`application.yml#L31-L36`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/resources/application.yml#L31-L36) (`max-active: 16`, `max-wait: 1000ms`).
   - **Rate Limiting**: [`RedisRateLimiterFilter.java#L52-L79`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/security/RedisRateLimiterFilter.java#L52-L79) increments key `ratelimit:<clientIp>:<currentEpochMinute>` with 65s expiration. If Redis is down, it gracefully fails open.
   - **Pub/Sub Distributed Sync**: [`RedisPubSubService.java#L61-L84`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/service/RedisPubSubService.java#L61-L84) publishes newly ingested detections to topic `cityai:detections`.
   - **Caching**: `@Cacheable(value = "cameras")` and `@Cacheable(value = "trajectories")` with default 10-minute TTL (`application.yml#L41`).
2. **AI Microservice Redis Usage**:
   - **Connection**: [`ai-service/services/redis_service.py#L32-L46`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/redis_service.py#L32-L46) connects via `redis.asyncio.Redis`.
   - **Features**: Stores job progress in `cityai:job:{job_id}` (TTL 3600s) and checks `cityai:plate_cache:{crop_hash}`. Falls back to in-memory dictionaries `_in_memory_jobs` and `_in_memory_cache` if Redis is offline.

### 3.7 External API Integrations
1. **Indian Parivahan / VAHAN Official RC Lookup**:
   - **Source**: [`frontend/src/app/api/vahan/[plate]/route.ts#L265-L341`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/app/api/vahan/%5Bplate%5D/route.ts#L265-L341)
   - **Host**: `rto-vehicle-information-india.p.rapidapi.com` (`POST /getVehicleInfo`)
   - **Credentials**: Multi-key failover with hardcoded keys in `DEFAULT_KEYS` (`route.ts#L15-L20`).
   - **Bypass**: If plate is `ET3633P` or `MH12AB1234`, it bypasses the external API completely and loads local mock records (`route.ts#L229-L238`).
2. **OSRM (Open Source Routing Machine)**:
   - **Source**: [`frontend/src/lib/routing.ts#L54-L87`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/lib/routing.ts#L54-L87)
   - **URL**: `https://router.project-osrm.org/route/v1/driving/{coords}?overview=full&geometries=geojson`
   - **Role**: Snaps straight-line camera-to-camera checkpoint links to real Pune road geometries.
   - **Fallback**: Generates smooth interpolated spline waypoints if OSRM times out (>3.5s) or detours >2.5x.
3. **Google Maps Raster Tiles**:
   - **Source**: [`frontend/src/components/InvestigationMap.tsx#L97-L105`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/frontend/src/components/InvestigationMap.tsx#L97-L105)
   - **Tiles**: `https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}` (Streets), `lyrs=y` (Hybrid), `lyrs=s` (Satellite).

---

## 4. Background Jobs & Scheduled Tasks

1. **Backend Trajectory Replay Scheduler**:
   - **Source**: [`LiveTrackingWebSocketHandler.java#L43`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/websocket/LiveTrackingWebSocketHandler.java#L43)
   - `Executors.newScheduledThreadPool(4)` schedules emission of waypoints at `(index + 1) * 3` seconds.
2. **No Async Queue / Worker Engine**:
   - There is **no Celery, RabbitMQ, Kafka, or Quartz scheduler** implemented in the codebase.
   - Video processing initiated via `POST /api/process-video` or `POST /process-multi-camera` runs synchronously on HTTP request threads or in a transient `ThreadPoolExecutor(max_workers=4)`.

---

## 5. Authentication & Authorization Flow

1. **Protected Endpoints**:
   - Defined in [`backend/src/main/java/com/cityai/backend/security/SecurityConfig.java#L59-L67`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/backend/src/main/java/com/cityai/backend/security/SecurityConfig.java#L59-L67):
     - `POST /api/detections/**` -> Requires `ROLE_INGEST` via HTTP Basic authentication.
     - `GET /api/audit/**` -> Requires `ROLE_INGEST` via HTTP Basic authentication.
2. **Credentials Store**:
   - In-memory credentials managed by `InMemoryUserDetailsManager`.
   - Username: `${ingest.username:ingest}`
   - Password: `${ingest.password:change-me-in-production}`
3. **Public Endpoints (`permitAll`)**:
   - All `GET /api/vehicles/**`
   - All `GET /api/cameras/**`
   - All `GET /api/analytics/**`
   - All `GET /api/health`
   - All `POST /api/process-video`
   - All `GET /api/watchlist` and `POST /api/watchlist`
   - All `GET /api/security-alerts`
   - All `GET /api/predict-trajectory/**`
   - Native WebSocket `/ws/live/**` (No authentication token or cookie validated)
4. **Frontend Auth State**:
   - The frontend investigation dashboard has **zero login screens, session management, or JWT handling**.
   - All frontend queries to the backend are made unauthenticated.

