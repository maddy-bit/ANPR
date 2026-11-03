# System Environment Configuration & Secrets Reference

**Project:** City-Wide Multi-Camera Vehicle Intelligence Platform (SIH26127 — BEL)  
**Document Version:** 1.0.0  
**Scope:** Complete environment variable matrix, configuration files, and security handling guide.

---

## 1. Environment Variable Reference Matrix

The following table catalogs every environment variable referenced across the Python AI microservice, Java Spring Boot backend, and Next.js frontend. Safe placeholders are provided in place of actual production credentials.

| Variable | Target Subsystem | Purpose | Required in Dev? | Used In File(s) | Safe Placeholder / Default | Configuration Notes |
|---|---|---|---|---|---|---|
| `SERVER_PORT` | Backend | HTTP web server port | No | `backend/.../application.yml` | `8080` | Port on which the Spring Boot application listens. |
| `DB_URL` | Backend | JDBC database connection URL | No | `backend/.../application.yml`, `application-postgres.yml` | `jdbc:h2:mem:cityaidb;...` (dev) / `jdbc:postgresql://localhost:5432/cityai` (prod) | In dev, defaults to in-memory H2 with PostgreSQL compatibility mode. In prod, points to PostgreSQL 16 + PostGIS. |
| `DB_DRIVER` | Backend | JDBC driver class name | No | `backend/.../application.yml`, `application-postgres.yml` | `org.h2.Driver` (dev) / `org.postgresql.Driver` (prod) | Automatically set by Spring profile. |
| `DB_USERNAME` | Backend | Database login username | No | `backend/.../application.yml`, `application-postgres.yml` | `sa` (dev) / `cityai` (prod) | Database user for connection pool. |
| `DB_PASSWORD` | Backend | Database login password | No | `backend/.../application.yml`, `application-postgres.yml` | `""` (dev) / `cityai_dev_password` (prod) | Sensitive password. In production, provide via Docker secret or AWS Secrets Manager. |
| `DB_DIALECT` | Backend | Hibernate SQL dialect | No | `backend/.../application.yml`, `application-postgres.yml` | `org.hibernate.dialect.H2Dialect` (dev) / `PostgreSQLDialect` (prod) | Determines SQL syntax generation. |
| `SPRING_PROFILES_ACTIVE` | Backend | Active Spring environment profile | No | `backend/Dockerfile`, `docker-compose.yml` | `default` (H2) or `postgres` (PostGIS) | Setting `postgres` activates `PostGisMigrationRunner` and `SpatialCameraService`. |
| `REDIS_HOST` | Backend & AI | Redis server hostname | No | `backend/.../application.yml`, `ai-service/main.py` | `localhost` (dev) / `redis` (Docker) | Hostname of the Redis 7 instance. |
| `REDIS_PORT` | Backend & AI | Redis server port | No | `backend/.../application.yml`, `ai-service/main.py` | `6379` | Standard Redis port. |
| `REDIS_PASSWORD` | Backend & AI | Redis authentication password | No | `backend/.../application.yml` | `""` (unauthenticated in dev) | Must be configured if Redis requires AUTH in production. |
| `RATE_LIMIT_ENABLED` | Backend | Toggles sliding-window rate limiting | No | `backend/.../application.yml` | `true` | If true, `RedisRateLimiterFilter` intercepts requests. |
| `RATE_LIMIT_RPM` | Backend | Allowed requests per minute per IP | No | `backend/.../application.yml` | `300` | Rate threshold before returning HTTP 429 Too Many Requests. |
| `CORS_ALLOWED_ORIGINS` | Backend | Permitted HTTP origins for browser requests | No | `backend/.../application.yml` | `http://localhost:3000` | Comma-separated list of trusted frontend origins. |
| `INGEST_USERNAME` | Backend & Scripts | HTTP Basic auth username for writes | No | `backend/.../application.yml`, `scripts/process_video.py` | `ingest` | User identity for POST `/api/detections/ingest` and `/api/audit/**`. |
| `INGEST_PASSWORD` | Backend & Scripts | HTTP Basic auth password for writes | No | `backend/.../application.yml`, `scripts/process_video.py` | `change-me-in-production` | Secret password. Must be overridden before non-local deployment. |
| `AI_SERVICE_URL` | Backend | Base URL of Python AI microservice | No | `backend/.../application.yml`, `docker-compose.yml` | `http://localhost:8000` (dev) / `http://ai-service:8000` (Docker) | Used by `AiProxyController` to forward requests to FastAPI. |
| `DATA_DIR` | Backend | Directory containing seed JSON files | No | `backend/.../application.yml` | `../data` | Contains `cameras.json` and `vehicles.json`. |
| `EVIDENCE_DIR` | Backend | Directory containing evidence snapshots | No | `backend/.../application.yml` | `../data/evidence` | Served statically at `/evidence/{cameraId}/{filename}`. |
| `NEXT_PUBLIC_API_BASE_URL` | Frontend | Public Spring Boot backend URL | No | `frontend/src/lib/api.ts`, `frontend/Dockerfile` | `http://localhost:8080` | Evaluated in the user's browser; must be reachable from client device. |
| `NEXT_PUBLIC_AI_SERVICE_URL` | Frontend | Public FastAPI service URL | No | `frontend/src/lib/api.ts` | `http://localhost:8000` | Fallback direct URL if frontend bypasses backend proxy. |

---

## 2. Sanitized Configuration Templates

### A. Sanitized `.env.example` Template
Create this file at the workspace root when deploying to staging or production:

```bash
# ==============================================================================
# City AI Traffic Intelligence Platform (SIH26127) - Environment Template
# Copy this file to .env and configure values before starting containers.
# NEVER commit the active .env file containing sensitive credentials to Git!
# ==============================================================================

# --- DATABASE CONFIGURATION (PostgreSQL 16 + PostGIS 3.4) ---
SPRING_PROFILES_ACTIVE=postgres
DB_URL=jdbc:postgresql://db:5432/cityai
DB_USERNAME=cityai_admin
DB_PASSWORD=REPLACE_WITH_STRONG_GENERATED_PASSWORD_MIN_24_CHARS

# --- CACHING & RATE LIMITING (Redis 7) ---
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=REPLACE_WITH_STRONG_REDIS_AUTH_PASSWORD
RATE_LIMIT_ENABLED=true
RATE_LIMIT_RPM=300

# --- AUTHENTICATION & SECURITY CREDENTIALS ---
# Protects POST /api/detections/ingest and GET /api/audit/recent
INGEST_USERNAME=police_operator_ingest
INGEST_PASSWORD=REPLACE_WITH_STRONG_INGEST_PASSWORD

# --- CORS & NETWORKING ---
CORS_ALLOWED_ORIGINS=http://localhost:3000,https://traffic-intelligence.gov.in
AI_SERVICE_URL=http://ai-service:8000
SERVER_PORT=8080

# --- FILE STORAGE PATHS ---
DATA_DIR=/data
EVIDENCE_DIR=/data/evidence

# --- FRONTEND CLIENT BUILD CONFIGURATION ---
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_AI_SERVICE_URL=http://localhost:8000
```

---

## 3. Configuration Loading Mechanisms

### 1. Java Spring Boot (`backend/`)
- Spring Boot loads configuration via `application.yml` from the classpath.
- Environment variable overrides use the standard Spring syntax: `${ENV_VAR_NAME:default_value}`.
- If `SPRING_PROFILES_ACTIVE=postgres` is set, Spring Boot merges `application-postgres.yml` on top of `application.yml`, activating PostgreSQL drivers and Hibernate dialect.

### 2. Python FastAPI (`ai-service/`)
- In `config.py`, configuration is structured using strongly-typed Python dataclasses (`ModelPaths`, `DetectionConfig`, `TrackingConfig`, `OCRConfig`).
- Model file paths are resolved dynamically using `pathlib.Path(__file__).resolve().parent`.
- Thresholds are centralized in the singleton instance `cfg = PipelineConfig()`, preventing scattered magic numbers across computer vision modules.

### 3. Next.js 16 (`frontend/`)
- Public client-side environment variables must be prefixed with `NEXT_PUBLIC_` so Next.js embeds them into the compiled browser JavaScript bundle during build time.
- In `frontend/src/lib/api.ts`, the function `getApiBaseUrl()` inspects `process.env.NEXT_PUBLIC_API_BASE_URL`, falls back to `window.location.hostname` checking for `localhost`, and defaults to production endpoints when deployed to cloud providers.
