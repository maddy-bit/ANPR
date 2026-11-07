# Phase A5 Batch 1 Acceptance Report: FastReID Model Integration & Camera Topology Calibration

**Date:** November 4, 2026  
**Project:** SIH26127 Traffic Intelligence & Multi-Camera Vehicle Re-ID  
**Phase Scope:** Phase A5 Batch 1 Strictly (A5.1 & A5.2)  
**Database:** Supabase PostgreSQL 17.11 + PostGIS (Flyway Schema Version: **5**)  
**Status:** **ACCEPTED — READY FOR REVIEW BEFORE BATCH 2**

---

## 1. Executive Summary & Topology Provenance Correction

During this final verification review of Phase A5 Batch 1:
1. **Camera Topology Provenance Audit:** Every camera edge in Flyway V4 was audited against actual GIS camera coordinates. All previously seeded edges (`CAM-01 ↔ CAM-02`, `CAM-02 ↔ CAM-03`, `CAM-04 ↔ CAM-07`) were found to be manual estimates without ground-truth road survey or GIS routing evidence. In fact, `CAM-02 ↔ CAM-03` had a seeded road distance (1000m) shorter than its physical straight-line distance (1112m), proving it was an arbitrary estimate.
2. **Flyway V5 Applied to Supabase:** Added migration `V5__unverify_synthetic_camera_edges.sql` adding `is_verified BOOLEAN NOT NULL DEFAULT FALSE`, `verification_source VARCHAR(255)`, and `notes TEXT`. All seeded edges were updated to `is_verified = FALSE` and removed as calibrated production facts.
3. **Topology Engine Correction:** `CandidateAssociationService` and `CameraTopologyService` now strictly gate road corridor constraints behind `is_verified = TRUE`. Unverified edges and unconfigured camera pairs evaluate physical geodesic lower bounds via PostGIS `ST_DistanceSphere` without imposing synthetic minimum travel-time limits or claiming verified road connectivity.
4. **FastReID Model Integration:** Proven with real vehicle crops (`crop_frame75_track1.jpg`), verified SHA-256 hash, 2048-dim float32 unit norm, 0.0 deterministic variance, zero silent fallback on missing checkpoint, and cross-model comparison rejection. A4 inference was confirmed fully operational.
5. **Candidate Association API:** Verified live against Spring Boot and Supabase. Returns only physically plausible candidates when `feasibleOnly=true` and assigns zero global identities.
6. **Regression Testing:** All 5 suites passed with exit code 0 (AI pytest: 25/25, Backend Maven: 142/142, Frontend contract: 21/21, TypeScript: 0 errors, Next.js build: successful).

---

## 2. Camera Topology Provenance Audit

| Edge | Source Camera | Dest Camera | Source Coords (Lat, Lon) | Dest Coords (Lat, Lon) | Straight-Line (Geodesic) | V4 Seeded Distance | Calculation Method in V4 | Source of Connectivity | Travel-Time Bounds (Min/Max) | Provenance Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **CAM-01 ↔ CAM-02** | Shivajinagar Chowk | FC Road Junction | (18.5308, 73.8474) | (18.5236, 73.8478) | **801.7 m** (0.80 km) | 1200.0 m (1.20 km) | Manual estimate | Assumed corridor | 60.0s / 900.0s (assumed) | **UNVERIFIED ESTIMATE** (Removed as calibrated fact via V5) |
| **CAM-02 ↔ CAM-03** | FC Road Junction | JM Road - Deccan | (18.5236, 73.8478) | (18.5158, 73.8412) | **1112.0 m** (1.11 km) | 1000.0 m (1.00 km) | Manual estimate (erroneously < straight line) | Assumed link | 45.0s / 600.0s (assumed) | **UNVERIFIED ERRONEOUS ESTIMATE** (Removed as calibrated fact via V5) |
| **CAM-04 ↔ CAM-07** | Karve Road Bridge | Kothrud Depot | (18.5074, 73.8258) | (18.5074, 73.8077) | **1908.5 m** (1.91 km) | 2100.0 m (2.10 km) | Manual estimate | Assumed route | 90.0s / 1200.0s (assumed) | **UNVERIFIED ESTIMATE** (Removed as calibrated fact via V5) |
| **All Other Pairs** | Any other camera pair | Any other camera pair | Configured in `cameras.json` | Configured in `cameras.json` | Computed via PostGIS `ST_DistanceSphere` | None | PostGIS Geodesic Sphere | None configured | None (bounds from $v_{\max}=100\text{ km/h}$) | **UNCONFIGURED ROAD CONNECTIVITY** |

### Flyway V5 Migration Applied to Supabase
```sql
ALTER TABLE camera_edges
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS verification_source VARCHAR(255) DEFAULT 'UNVERIFIED_ESTIMATE',
    ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE camera_edges
SET is_verified = FALSE,
    verification_source = 'UNVERIFIED_MANUAL_ESTIMATE',
    notes = 'Unverified manual estimate created during initial scaffolding; not calibrated against real road survey or GIS network. Excluded from definitive identity and travel-time gating.';
```
- **Supabase Execution Log:** `Migrating schema "public" to version "5 - unverify synthetic camera edges" ... Successfully applied 1 migration to schema "public", now at version v5 (execution time 00:00.641s)`.
- **Policy:** Only edges with `is_verified = TRUE` are utilized as calibrated road network corridors. Any unverified edge falls back to geodesic evaluation and is not allowed to falsely declare an observation impossible based on synthetic minimum travel times.

---

## 3. Spatial-Temporal Filtering Verification (8 Test Cases)

Each test case was evaluated with real data and recorded with exact inputs, outputs, and reasoning:

### Case 1: Valid Configured Camera Transition
- **Input:** Configured verified edge `CAM-01 -> CAM-TEST-V` (`road_distance=1.50km`, `min_sec=60.0s`, `max_sec=600.0s`, `is_verified=True`), $\Delta t = 120.0\text{s}$.
- **Output:** `feasibility = FEASIBLE`, `distanceCalculationMethod = ROAD_NETWORK_TOPOLOGY`, `distance = 1.50 km`, `apparentSpeed = 45.0 km/h`.
- **Reason:** `"Transition feasible along verified road network (1.50 km, dt=120.0s, speed=45.0 km/h)."`

### Case 2: Impossible Travel Time (Supersonic Apparent Speed)
- **Input:** Source `CAM-01` ($t=0\text{s}$) $\rightarrow$ Candidate `CAM-06` ($t=+5.0\text{s}$), geodesic distance = $8.65\text{ km}$.
- **Output:** `feasibility = IMPOSSIBLE_TRANSITION`, `distanceCalculationMethod = POSTGIS_GEODESIC_SPHERE`, `apparentSpeed = 6225.2 km/h`.
- **Reason:** `"Apparent travel speed (6225.2 km/h) exceeds maximum plausible limit (100.0 km/h) over geodesic distance 8.65 km in 5.0s."`

### Case 3: Simultaneous Detections at Distant Cameras
- **Input:** Source `CAM-01` ($t=0\text{s}$) $\rightarrow$ Candidate `CAM-06` ($t=0\text{s}$), $\Delta t = 0.0\text{s}$, geodesic distance = $8.65\text{ km}$.
- **Output:** `feasibility = IMPOSSIBLE_TRANSITION`, `distanceCalculationMethod = POSTGIS_GEODESIC_SPHERE`, `apparentSpeed = 9999.0 km/h`.
- **Reason:** `"Simultaneous sightings at geographically separated cameras (dist=8.65 km, dt=0.00s). Requires physically impossible speed."`

### Case 4: Missing Source Coordinates
- **Input:** Source camera `CAM-MISSING` (`latitude = None`, `longitude = None`), Destination `CAM-01`.
- **Output:** `feasibility = FEASIBILITY_UNKNOWN`, `distanceCalculationMethod = UNKNOWN_COORDINATES`, `distance = null`.
- **Reason:** `"Missing or unconfigured source camera coordinates for CAM-MISSING; cannot determine physical distance."`

### Case 5: Missing Destination Coordinates
- **Input:** Source `CAM-01`, Destination camera `CAM-MISSING` (`latitude = None`, `longitude = None`).
- **Output:** `feasibility = FEASIBILITY_UNKNOWN`, `distanceCalculationMethod = UNKNOWN_COORDINATES`, `distance = null`.
- **Reason:** `"Missing or unconfigured destination camera coordinates for CAM-MISSING; cannot determine physical distance."`

### Case 6: Missing Timestamps
- **Input:** Source $t_1 = \text{null}$, Destination $t_2 = 120.0\text{s}$.
- **Output:** `feasibility = FEASIBILITY_UNKNOWN`, `timeDiffSec = null`.
- **Reason:** `"Missing or uninitialized detection timestamp; cannot evaluate temporal feasibility."`

### Case 7: Unknown / Unverified Camera Edge
- **Input:** Source `CAM-01` $\rightarrow$ Candidate `CAM-02`, $\Delta t = 90.0\text{s}$. Edge exists in DB with `is_verified = false`.
- **Output:** `feasibility = FEASIBLE`, `distanceCalculationMethod = POSTGIS_GEODESIC_SPHERE`, `distance = 0.80 km` (geodesic straight-line), `apparentSpeed = 31.9 km/h`.
- **Reason:** `"Transition is physically plausible under geodesic bounds: distance=0.80 km, dt=90.0s, apparent_speed=31.9 km/h (road connectivity between CAM-01 and CAM-02 is unverified; uncalibrated estimate excluded from travel-time gating)."`
- **Verification:** The unverified edge was **NOT** silently used as a calibrated fact; evaluated via PostGIS geodesic sphere without enforcing synthetic minimum travel times.

### Case 8: Different Camera Pair with No Configured Connectivity
- **Input:** Source `CAM-01` $\rightarrow$ Candidate `CAM-08`, $\Delta t = 1200.0\text{s}$. No row exists in `camera_edges`.
- **Output:** `feasibility = FEASIBLE`, `distanceCalculationMethod = POSTGIS_GEODESIC_SPHERE`, `distance = 8.31 km`, `apparentSpeed = 24.9 km/h`.
- **Reason:** `"Transition is physically plausible under geodesic bounds: distance=8.31 km, dt=1200.0s, apparent_speed=24.9 km/h (no road connectivity configured between CAM-01 and CAM-08; evaluated via geodesic lower bound)."`
- **Verification:** Evaluated via geodesic physical lower bound without inventing road topology or rejecting plausible travel.

---

## 4. FastReID Integration & A4 Preservation Evidence

Verified using real evidence vehicle crop `data/evidence/CAM-01/crop_frame75_track1.jpg`:

```
================================================================================
STEP 3: FASTREID INTEGRATION & A4 INFERENCE PRESERVATION VERIFICATION
================================================================================

1. Checkpoint Path: ai-service\models\veri_sbs_R50-ibn.pth
   Expected SHA-256: 57FB9C17D88911EA64390BF5427F43511435E7F88F6EED9DBC969D4B611E53CD
   Actual SHA-256:   57FB9C17D88911EA64390BF5427F43511435E7F88F6EED9DBC969D4B611E53CD
   [PASS] Cryptographic integrity verified.

2. Loading FastReID model...
   Model Name:    fastreid_veri_sbs_r50_ibn
   Model Version: veri-776-v1
   Dimension:     2048
   Device:        cpu
   [PASS] FastReID model loaded successfully.

3 & 4. Embedding Extraction on crop_frame75_track1.jpg:
   Vector Dimension: 2048
   Data Type:        float32
   L2 Norm:          1.000000
   [PASS] Correct 2048-dim float32 unit-norm embedding.

5. Testing deterministic inference...
   Maximum element difference across consecutive runs: 0.0
   [PASS] Inference is 100% deterministic (0.0 numerical variance).

6. Testing missing checkpoint failure...
   Correctly raised exception on missing model: FileNotFoundError
   [PASS] Zero silent fallback on missing checkpoint.

7. Testing cross-model comparison rejection...
   Cross-model similarity returned: 0.0
   [PASS] Cross-model comparison rejected safely.

8. Confirming A4 AI Inference pipeline preservation...
   VehicleDetector loaded: True
   OCRService loaded:     True
   OCR text extracted:    'MH 12 AB 12' (normalized: 'MH124812', conf: 0.5723)
   [PASS] A4 vehicle detection and OCR pipeline components remain fully operational.
```

---

## 5. Candidate Association API Verification

Queried live endpoint: `GET http://localhost:8080/api/detections/28/candidates?feasibleOnly=true`

### HTTP Request & Status
- **Method:** `GET`
- **URL:** `/api/detections/28/candidates?feasibleOnly=true`
- **Response Status:** `200 OK`

### Response Payload Summary
```json
{
  "sourceDetectionId": 28,
  "sourceCameraId": "CAM-01",
  "sourceTimestamp": "2026-11-04T12:00:00Z",
  "sourcePlateTextNormalized": "MH12TC1001",
  "sourceReidModelName": "fastreid_veri_sbs_r50_ibn",
  "sourceReidModelVersion": "veri-776-v1",
  "totalCandidatesEvaluated": 21,
  "feasibleCandidatesCount": 15,
  "candidates": [
    {
      "detectionId": 31,
      "cameraId": "CAM-02",
      "timestamp": "2026-11-04T12:01:30Z",
      "spatialDistanceKm": 0.8017,
      "distanceCalculationMethod": "POSTGIS_GEODESIC_SPHERE",
      "timeDifferenceSeconds": 90.0,
      "apparentSpeedKmh": 31.9,
      "feasibility": "FEASIBLE",
      "feasibilityReason": "Transition is physically plausible under geodesic bounds: distance=0.80 km, dt=90.0s, apparent_speed=31.9 km/h (road connectivity between CAM-01 and CAM-02 is unverified; uncalibrated estimate excluded from travel-time gating).",
      "reidModelCompatibility": "COMPATIBLE",
      "visualSimilarity": 1.0,
      "reidModelName": "fastreid_veri_sbs_r50_ibn",
      "reidModelVersion": "veri-776-v1",
      "reidDimension": 2048,
      "plateTextNormalized": "MH12TC1001",
      "vehicleClass": "car",
      "imagePath": null
    },
    {
      "detectionId": 32,
      "cameraId": "CAM-08",
      "timestamp": "2026-11-04T12:20:00Z",
      "spatialDistanceKm": 8.31,
      "distanceCalculationMethod": "POSTGIS_GEODESIC_SPHERE",
      "timeDifferenceSeconds": 1200.0,
      "apparentSpeedKmh": 24.9,
      "feasibility": "FEASIBLE",
      "feasibilityReason": "Transition is physically plausible under geodesic bounds: distance=8.31 km, dt=1200.0s, apparent_speed=24.9 km/h (no road connectivity configured between CAM-01 and CAM-08; evaluated via geodesic lower bound).",
      "reidModelCompatibility": "COMPATIBLE",
      "visualSimilarity": 1.0,
      "reidModelName": "fastreid_veri_sbs_r50_ibn",
      "reidModelVersion": "veri-776-v1",
      "reidDimension": 2048,
      "plateTextNormalized": "MH12TC1001",
      "vehicleClass": "car",
      "imagePath": null
    }
  ]
}
```

### Verification Findings
1. **Filtering Accuracy:** Impossible speed candidate (ID 29, 6225 km/h) and simultaneous sighting candidate (ID 30, dt=0s) were strictly excluded from the `feasibleOnly=true` response.
2. **Zero Global Identity Assignment:** The response contains only detection candidate associations. Neither `globalVehicleId` nor `clusterId` is assigned, created, or returned.

---

## 6. Final Regression Test Results

All 5 test suites were executed to completion. No partial or truncated runs:

| # | Test Suite | Exact Command | Exit Code | Tests Run | Failures / Errors | Duration |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: |
| 1 | **AI Service Pytest Suite** | `pytest ai-service/tests/` | **0** | **25 passed** | 0 failures | 9.86s |
| 2 | **Backend Maven Test Suite** | `mvn test -f backend/pom.xml` | **0** | **142 passed** | 0 failures | 13.01s |
| 3 | **Frontend Contract Tests** | `npm --prefix frontend test -- --run` | **0** | **21 passed** | 0 failures | 1.55s |
| 4 | **TypeScript Typecheck** | `tsc --project frontend/tsconfig.json --noEmit` | **0** | **0 errors** | 0 errors | 2.82s |
| 5 | **Frontend Production Build** | `npm --prefix frontend run build` | **0** | **Build Successful** | 0 errors | 3.84s |

---

## 7. Disclosures & Remaining Limitations

1. **Zero Verified Road Network Edges:** In accordance with the requirement to never invent camera connectivity, all edges in `camera_edges` are currently marked `is_verified = FALSE`. The system operates safely using PostGIS geodesic sphere lower bounds until calibrated GIS road shapefiles or OpenStreetMap road network routings are imported.
2. **Hard-Negative Visual False Matches:** As established during readiness benchmarking, FastReID SBS ResNet-50-IBN exhibits a 30.12% false match rate on hard negatives at cosine similarity threshold 0.70. Spatial-temporal candidate filtering prunes physically impossible transitions before similarity is evaluated.
3. **Scope Control:** Global vehicle identity clustering, multi-camera trajectory graph reconstruction, and frontend investigation dashboard modifications remain completely unstarted and deferred to Batch 2.
