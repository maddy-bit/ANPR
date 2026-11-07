# Phase A5 — Batch 3.1: Core Trajectory Reconstruction Acceptance Report

**Project:** SIH26127 — ANPR Traffic Intelligence & Multi-Camera Vehicle Re-ID Platform  
**Phase:** Phase A5 — Multi-Camera Vehicle Re-ID (Batch 3.1: Core Backend Trajectory Reconstruction & Final Semantic Corrections)  
**Execution Timestamp:** 2026-11-04  
**Database:** Supabase PostgreSQL 17.11 + PostGIS (`aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`)  
**Status:** **ACCEPTED & FULLY VERIFIED**  

---

## Executive Summary

Phase A5 Batch 3.1 establishes the core backend **Trajectory Reconstruction Engine** for the SIH26127 platform, converting confirmed multi-camera vehicle detections into chronological, geographically grounded trajectory observations.

Following the mandatory semantic audit, the engine enforces strict separation between **physical feasibility** (kinematic plausibility) and **verified road connectivity** (empirically calibrated road edges). All 12 primary acceptance scenarios and 4 dedicated semantic regression tests pass unconditionally (16/16 unit tests, 177/177 full backend tests). Live end-to-end integration against Supabase PostgreSQL confirms rigorous edge validation, impossible-jump detection, deterministic tie-breaking, strict seed observation filtering, and segment partitioning.

---

## 1. Final Semantic Corrections Implemented

### 1.1 Physical Feasibility vs. Verified Road Connectivity
- A geodesic calculation establishes only whether a transition is *physically plausible* under urban speed constraints ($v \le 100\text{ km/h}$, $\Delta t > 0.1\text{s}$); it cannot prove that the vehicle actually travelled that corridor.
- Preserved primary status: `FEASIBLE`, `IMPOSSIBLE`, `FEASIBILITY_UNKNOWN`.
- Added explicit `connectivity` field in `TrajectoryTransitionDto`:
  - `VERIFIED_ROAD_EDGE`: Edge calibrated and verified in `camera_edges` table (`is_verified = TRUE`).
  - `UNVERIFIED_GEODESIC`: Feasibility evaluated via geodesic distance (PostGIS or Haversine); explicitly documented that geodesic proximity does not prove an actual travelled road route.
  - `SAME_CAMERA`: Consecutive sightings at identical camera; marked `isVerifiedTopology = false` (stationary/repeated sighting, not a road transition).
  - `UNKNOWN`: Missing timestamps or missing coordinates; distance cannot be evaluated.

### 1.2 Same-Camera Transition Semantics
- Prior code incorrectly flagged same-camera sightings as verified road topology.
- Corrected rule: Same-camera transitions are labeled `connectivity = "SAME_CAMERA"`, `isVerifiedTopology = false`, `distanceMethod = "SAME_CAMERA"`, `distanceKm = 0.0`.
- Timestamp ordering and observation sequences are strictly preserved.

### 1.3 Trajectory Segment Semantics
- Added `segmentType` and `isFullyVerifiedRoadRoute` (boolean) to `TrajectorySegmentDto`:
  - `VERIFIED_ROAD_CONNECTED_PATH`: Every transition in the segment is backed by a verified road edge (`connectivity == "VERIFIED_ROAD_EDGE"`).
  - `PLAUSIBLE_CHRONOLOGICAL_SEQUENCE`: One or more transitions in the segment rely on unverified geodesic links.
- Operators and downstream routing modules are explicitly guarded against assuming unverified geodesic segments reflect actual travelled roads.

### 1.4 Strict Seed Observation & Membership Gating
- If a global identity has established associations, any detection with no association record (`assocsForDet == null || assocsForDet.isEmpty()`) is strictly **EXCLUDED** from the trajectory, even if a stale foreign key `global_identity_id` exists in `vehicle_detections`.
- A seed observation without an association record is admitted **only** when the identity has zero associations total (`totalRawDetectionsForIdentity == 1`) and the detection timestamp matches `identity.getFirstSeenTimestamp()`.

---

## 2. Architecture & Persistence Integrity

1. **Zero Data Duplication:**  
   Trajectories are computed on-demand from authoritative tables (`global_identities`, `vehicle_detections`, `identity_associations`, `cameras`, `camera_edges`). No redundant trajectory cache tables are introduced.
2. **Immutable Detection Evidence:**  
   Raw historical vehicle detections in `vehicle_detections` are never rewritten, deleted, or mutated during trajectory construction.
3. **PostGIS Spherical Geodesics:**  
   Unverified geodesic distances between camera coordinates utilize PostGIS `ST_Distance(ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography, ...)` with automatic fallback to Haversine formula.

---

## 3. Files Created and Modified

| File | Status | Description |
|---|---|---|
| `backend/src/main/java/com/cityai/backend/dto/TrajectoryObservationDto.java` | Created | Observation DTO with coordinates, provenance, OCR, and confidence. |
| `backend/src/main/java/com/cityai/backend/dto/TrajectoryTransitionDto.java` | Modified | Transition DTO with `connectivity`, `isVerifiedTopology`, status, speed, and reason. |
| `backend/src/main/java/com/cityai/backend/dto/TrajectorySegmentDto.java` | Modified | Segment DTO with `segmentType`, `isFullyVerifiedRoadRoute`, break reason, and metrics. |
| `backend/src/main/java/com/cityai/backend/dto/GlobalTrajectoryDto.java` | Created | Top-level trajectory DTO with summary metrics and nested collections. |
| `backend/src/main/java/com/cityai/backend/service/GlobalTrajectoryService.java` | Modified | Reconstruction service implementing semantic separation, edge lookup, and strict seed admission. |
| `backend/src/main/java/com/cityai/backend/controller/GlobalIdentityController.java` | Modified | Endpoint `GET /api/identities/{id}/trajectory`. |
| `backend/src/main/java/com/cityai/backend/service/GlobalIdentityAssociationService.java` | Modified | Label generator updated to `GLOBAL-VEH-<UUID_HEX>` for restart resilience. |
| `backend/src/test/java/com/cityai/backend/service/GlobalTrajectoryServiceTest.java` | Modified | 16 unit tests covering 12 core scenarios and 4 semantic regression tests. |
| `backend/src/test/java/com/cityai/backend/controller/GlobalIdentityControllerTest.java` | Modified | Added controller endpoint tests (200, 404, 400). |
| `scripts/verify_a5_batch3_1_trajectory.py` | Modified | Live integration test verifying API semantics against Supabase PostgreSQL. |

---

## 4. REST API Specification & Live Verified Response

### Endpoint: `GET /api/identities/{id}/trajectory`

#### Live Verified JSON Response (`200 OK`):
```json
{
  "globalIdentityId": "ab69cd4d-cc77-43f2-a3d7-70ff328bbb2d",
  "label": "GLOBAL-VEH-3CD578C3",
  "primaryPlate": "MH12TR9999",
  "vehicleClass": "car",
  "reviewStatus": "ACTIVE",
  "totalObservations": 3,
  "confirmedObservations": 3,
  "excludedObservations": 0,
  "segmentCount": 2,
  "hasImpossibleTransitions": true,
  "hasUnknownFeasibility": false,
  "totalFeasibleDistanceKm": 0.798,
  "totalDurationSeconds": 92.0,
  "firstSeenTimestamp": "2026-11-04T14:00:00Z",
  "lastSeenTimestamp": "2026-11-04T14:01:32Z",
  "observations": [
    {
      "detectionId": 83,
      "globalIdentityId": "ab69cd4d-cc77-43f2-a3d7-70ff328bbb2d",
      "cameraId": "CAM-01",
      "cameraName": "Shivajinagar Chowk",
      "timestamp": "2026-11-04T14:00:00Z",
      "latitude": 18.5308,
      "longitude": 73.8474,
      "hasCoordinates": true,
      "direction": "SE",
      "speedKmh": 45.0,
      "vehicleClass": "car",
      "detectionConfidence": 0.95,
      "plateText": "MH12TR9999",
      "plateConfidence": 0.93,
      "reidConfidence": 0.91,
      "imagePath": "/storage/crops/traj_t1.jpg",
      "trackId": 701,
      "frameNumber": 100,
      "provenance": {
        "associationId": "096114f2-692b-4799-b153-428b63c47004",
        "associationDecision": "MATCH",
        "associationReviewStatus": "SYSTEM_DECIDED",
        "reidScore": 0.982,
        "plateScore": 1.0,
        "isSeedObservation": true
      }
    },
    {
      "detectionId": 84,
      "globalIdentityId": "ab69cd4d-cc77-43f2-a3d7-70ff328bbb2d",
      "cameraId": "CAM-02",
      "cameraName": "FC Road Junction",
      "timestamp": "2026-11-04T14:01:30Z",
      "latitude": 18.5236,
      "longitude": 73.8478,
      "hasCoordinates": true,
      "direction": "S",
      "speedKmh": 48.0,
      "vehicleClass": "car",
      "detectionConfidence": 0.94,
      "plateText": "MH12TR9999",
      "plateConfidence": 0.92,
      "reidConfidence": 0.90,
      "imagePath": "/storage/crops/traj_t2.jpg",
      "trackId": 702,
      "frameNumber": 120,
      "provenance": {
        "associationId": "096114f2-692b-4799-b153-428b63c47004",
        "associationDecision": "MATCH",
        "associationReviewStatus": "SYSTEM_DECIDED",
        "reidScore": 0.982,
        "plateScore": 1.0,
        "isSeedObservation": false
      }
    },
    {
      "detectionId": 85,
      "globalIdentityId": "ab69cd4d-cc77-43f2-a3d7-70ff328bbb2d",
      "cameraId": "CAM-06",
      "cameraName": "Hadapsar Industrial Estate",
      "timestamp": "2026-11-04T14:01:32Z",
      "latitude": 18.5089,
      "longitude": 73.9260,
      "hasCoordinates": true,
      "direction": "E",
      "speedKmh": 50.0,
      "vehicleClass": "car",
      "detectionConfidence": 0.93,
      "plateText": "MH12TR9999",
      "plateConfidence": 0.91,
      "reidConfidence": 0.89,
      "imagePath": "/storage/crops/traj_t3.jpg",
      "trackId": 703,
      "frameNumber": 150,
      "provenance": {
        "associationId": "7c34472b-e227-458a-8a2a-00c0ecf98ef8",
        "associationDecision": "MATCH",
        "associationReviewStatus": "CONFIRMED_BY_USER",
        "reidScore": 0.980,
        "plateScore": 1.0,
        "isSeedObservation": false
      }
    }
  ],
  "transitions": [
    {
      "fromDetectionId": 83,
      "toDetectionId": 84,
      "fromCameraId": "CAM-01",
      "toCameraId": "CAM-02",
      "fromTimestamp": "2026-11-04T14:00:00Z",
      "toTimestamp": "2026-11-04T14:01:30Z",
      "deltaSeconds": 90.0,
      "distanceKm": 0.798,
      "distanceMethod": "POSTGIS_GEODESIC_SPHERE",
      "connectivity": "UNVERIFIED_GEODESIC",
      "isVerifiedTopology": false,
      "apparentSpeedKmh": 31.9,
      "status": "FEASIBLE",
      "reason": "Physically feasible geodesic transition (0.80 km, dt=90.0s, apparent speed=31.9 km/h); unverified geodesic path, does not prove actual travelled road route."
    },
    {
      "fromDetectionId": 84,
      "toDetectionId": 85,
      "fromCameraId": "CAM-02",
      "toCameraId": "CAM-06",
      "fromTimestamp": "2026-11-04T14:01:30Z",
      "toTimestamp": "2026-11-04T14:01:32Z",
      "deltaSeconds": 2.0,
      "distanceKm": 8.416,
      "distanceMethod": "POSTGIS_GEODESIC_SPHERE",
      "connectivity": "UNVERIFIED_GEODESIC",
      "isVerifiedTopology": false,
      "apparentSpeedKmh": 15149.0,
      "status": "IMPOSSIBLE",
      "reason": "Apparent straight-line speed (15149.0 km/h) exceeds physical threshold (100.0 km/h) over 8.42 km in 2.0s; unverified geodesic transition."
    }
  ],
  "segments": [
    {
      "segmentIndex": 1,
      "segmentType": "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE",
      "isFullyVerifiedRoadRoute": false,
      "observationCount": 2,
      "startObservationId": 83,
      "endObservationId": 84,
      "startTime": "2026-11-04T14:00:00Z",
      "endTime": "2026-11-04T14:01:30Z",
      "durationSeconds": 90.0,
      "totalDistanceKm": 0.798,
      "breakReason": null
    },
    {
      "segmentIndex": 2,
      "segmentType": "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE",
      "isFullyVerifiedRoadRoute": false,
      "observationCount": 1,
      "startObservationId": 85,
      "endObservationId": 85,
      "startTime": "2026-11-04T14:01:32Z",
      "endTime": "2026-11-04T14:01:32Z",
      "durationSeconds": 0.0,
      "totalDistanceKm": 0.0,
      "breakReason": "Segment break at detection 84 -> 85: [IMPOSSIBLE] Apparent straight-line speed (15149.0 km/h) exceeds physical threshold (100.0 km/h) over 8.42 km in 2.0s; unverified geodesic transition."
    }
  ]
}
```

#### Error Handling Responses:
- Nonexistent Global Identity (`404 NOT_FOUND`):
  ```json
  {
    "error": "NOT_FOUND",
    "message": "Global identity not found with id: 00000000-0000-0000-0000-000000000000",
    "timestamp": "2026-11-04T14:08:08.210Z"
  }
  ```
- Malformed UUID String (`400 INVALID_REQUEST`):
  ```json
  {
    "error": "INVALID_REQUEST",
    "message": "Invalid UUID string: invalid-uuid-string",
    "timestamp": "2026-11-04T14:08:08.245Z"
  }
  ```

---

## 5. Verification Results Across All Unit & Semantic Test Cases

All 16 unit tests in `GlobalTrajectoryServiceTest` pass cleanly:

| # | Acceptance Scenario | Test Method in `GlobalTrajectoryServiceTest` | Status |
|---|---|---|---|
| **1** | Two confirmed detections from different cameras | `testCase1_TwoConfirmedDetections_DifferentCameras` | **PASS** |
| **2** | Multiple detections sorted chronologically (tied timestamps deterministic) | `testCase2_MultipleDetections_SortedChronologically_AndDeterministicTies` | **PASS** |
| **3** | Pending-review association excluded | `testCase3_PendingReviewAssociation_Excluded` | **PASS** |
| **4** | Rejected association excluded | `testCase4_RejectedAssociation_Excluded` | **PASS** |
| **5** | Impossible speed transition flagged | `testCase5_ImpossibleSpeedTransition_Flagged` | **PASS** |
| **6** | Missing camera coordinates evaluated as `FEASIBILITY_UNKNOWN` | `testCase6_MissingCameraCoordinates_FeasibilityUnknown` | **PASS** |
| **7** | Missing timestamp evaluated as `FEASIBILITY_UNKNOWN` | `testCase7_MissingTimestamp_FeasibilityUnknown` | **PASS** |
| **8** | Unverified topology remains explicitly unverified | `testCase8_UnverifiedTopology_RemainsExplicitlyUnverified` | **PASS** |
| **9** | Same-camera repeated observations evaluated as $0.0\text{ km}$, `FEASIBLE` | `testCase9_SameCameraObservations_Feasible` | **PASS** |
| **10** | Multiple disconnected trajectory segments created on impossible transitions | `testCase10_MultipleDisconnectedSegments_WhenTransitionImpossible` | **PASS** |
| **11** | Nonexistent global identity throws `NoSuchElementException` (HTTP 404) | `testCase11_NonexistentGlobalIdentity_ThrowsException` | **PASS** |
| **12** | Empty trajectory returns valid empty DTO | `testCase12_EmptyTrajectory_ReturnsValidEmptyDto` | **PASS** |
| **S1** | Unverified geodesic distinct from verified road connectivity | `testSemantic_UnverifiedGeodesic_DistinctFromVerifiedRoadConnectivity` | **PASS** |
| **S2** | Same-camera transition not labeled verified road topology | `testSemantic_SameCamera_NotLabelledVerifiedRoadTopology` | **PASS** |
| **S3** | Unassociated unrelated detection excluded | `testSemantic_UnassociatedUnrelatedDetection_Excluded` | **PASS** |
| **S4** | Verified road-edge transition correctly identified | `testSemantic_VerifiedRoadEdgeTransition_CorrectlyIdentified` | **PASS** |

---

## 6. Full Regression Suite Results

All unit, integration, contract, type-checking, and build suites completed cleanly with zero regressions:

| Suite | Component | Command | Result | Duration |
|---|---|---|---|---|
| **Backend** | Spring Boot / Maven | `mvn test -f backend/pom.xml` | **177 passed / 177 total** | 15.40m |
| **AI Service** | Pytest | `pytest ai-service/tests/ -v` | **28 passed / 28 total** | 10.34s |
| **Frontend Contract** | Vitest / tsx | `npm --prefix frontend test -- --run` | **21 passed / 21 total** | 2.10s |
| **Frontend Types** | TypeScript Compiler | `tsc --project frontend/tsconfig.json --noEmit` | **Clean (0 errors)** | 2.30s |
| **Frontend Build** | Next.js 16.3.4 (Turbopack) | `npm --prefix frontend run build` | **5 / 5 pages built** | 0.89s |

---

## 7. Operational & Security Governance

1. **Strict Semantic Honesty:**  
   Downstream systems or operators viewing reconstructed trajectories are never misled: geodesic segments are clearly stamped `PLAUSIBLE_CHRONOLOGICAL_SEQUENCE` with `isFullyVerifiedRoadRoute = false`, while same-camera observations are explicitly designated `SAME_CAMERA`.
2. **Access Control Boundary:**  
   Trajectory query endpoints remain accessible to internal components during local development. For production deployment, endpoint security will bind to Spring Security OAuth2 / JWT filters enforcing `ROLE_OPERATOR` and `ROLE_INVESTIGATOR` authorizations.
3. **Audit Trail & Evidence Integrity:**  
   Every observation embeds full provenance referencing the exact underlying pairwise `IdentityAssociation` ID, scores, and review decision.
4. **Git Scope Boundary:**  
   In compliance with acceptance directives, no git commits, pushes, or remote modifications were made.
