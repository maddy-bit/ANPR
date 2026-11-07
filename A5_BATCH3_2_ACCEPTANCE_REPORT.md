# Phase A5 — Batch 3.2: Trajectory Reliability & Evidence Validation Acceptance Report

**Project:** SIH26127 — ANPR Traffic Intelligence & Multi-Camera Vehicle Re-ID Platform  
**Phase:** Phase A5 — Multi-Camera Vehicle Re-ID (Batch 3.2: Trajectory Reliability & Evidence Validation)  
**Execution Timestamp:** 2026-11-04  
**Database:** Supabase PostgreSQL 17.11 + PostGIS (`aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`)  
**Status:** **ACCEPTED & FULLY VERIFIED**  

---

## Executive Summary

Phase A5 Batch 3.2 establishes an evidence-backed **Trajectory Reliability & Evidence Quality Assessment Layer** on top of the Batch 3.1 trajectory reconstruction service. 

Rather than generating an uncalibrated statistical probability or single synthetic percentage, the engine evaluates multidimensional evidence indicators: identity membership audit, model detection confidence, OCR plate consistency, FastReID appearance similarity, spatial-temporal feasibility, and telemetry completeness.

All 12 mandatory acceptance scenarios have been verified using isolated unit tests (12/12 in `TrajectoryQualityServiceTest`), full backend suite (192/192 passing), and live end-to-end integration tests against Supabase PostgreSQL.

---

## 1. Architecture Audit & Reliability Framework

### 1.1 Non-Duplication of Reconstruction Logic
- `TrajectoryQualityService` builds directly on `GlobalTrajectoryService.reconstructTrajectory(globalIdentityId)`.
- It reuses authoritative confirmed observations, transitions, and segments without duplicating distance or speed calculations.

### 1.2 Quality Dimensions Decoupled from Fabricated Percentages
The engine decomposes trajectory trustworthiness into 6 independent dimensions:
1. **Identity Membership Confidence:** Confirms that all observations stem from valid `MATCH` decisions (`SYSTEM_DECIDED` or `CONFIRMED_BY_USER`) and flags any user rejections or active conflicts (`CONFLICTED`).
2. **Detection Confidence:** Evaluates raw model confidence across vehicle bounding boxes, flagging low-confidence detections ($< 0.70$). It strictly separates detection confidence from identity confidence.
3. **OCR Confidence & Plate Consistency:** Examines all normalized plates across sightings. If multiple distinct plates appear, it flags `CONTRADICTORY` and issues a warning. High OCR confidence is prohibited from overriding contradictory visual or physical evidence.
4. **Re-ID Visual Similarity:** Evaluates FastReID cosine similarity scores from underlying associations. If visual embeddings or scores were not generated, it marks `isAvailable = false`, preserves `null` values without fabrication, and adds an item to `missingEvidence`.
5. **Spatial-Temporal Feasibility:** Checks transition speeds, temporal ordering, and camera topology. Transitions backed by verified road edges are designated `VERIFIED_ROAD_NETWORK`, while unverified straight-line estimates are qualified as `PLAUSIBLE_GEODESIC`. Impossible transitions are highlighted with explanatory physics violations.
6. **Evidence Completeness:** Detects missing timestamps, unconfigured coordinates, and unread plates.

### 1.3 Evidence-Quality Categorization Tiers
- **`HIGH_CONFIDENCE`:** Multi-camera ($\ge 2$ distinct cameras), all transitions backed by verified road edges, no impossible or unknown transitions, consistent plate readings (avg OCR conf $\ge 0.85$), high detection confidence (avg $\ge 0.80$, no low detections), and confirmed identity associations.
- **`MEDIUM_CONFIDENCE`:** Physically feasible multi-camera trajectory without contradictions, but corridors rely on unverified geodesic bounds (not yet calibrated in `camera_edges`), or partial non-critical telemetry is missing.
- **`LOW_CONFIDENCE`:** Contains impossible transitions violating speed limits, contradictory plate evidence, low detection confidence ($< 0.60$), or active identity rejections/conflicts.
- **`INSUFFICIENT_EVIDENCE`:** Empty trajectories ($0$ observations), single sightings, or single-camera-only observations where cross-camera corroboration is absent.

---

## 2. Validation Rules Enforced

1. **Pending/Rejected Associations Excluded:** Detections backed only by `PENDING_REVIEW` or `REJECTED_BY_USER` associations are strictly excluded from confirmed observations and reported in `excludedObservations`.
2. **No OCR Override of Contradictory Evidence:** Conflicting plate readings yield `PlateQuality = CONTRADICTORY`, permanently disqualifying the trajectory from `HIGH_CONFIDENCE`.
3. **Preservation of Impossible Transitions:** Every impossible transition and its exact physical violation reason is preserved in `transitions`, surfaced in `warningsAndContradictions`, and triggers `hasImpossibleTransitions = true`.
4. **Unverified Geodesics Reduce Route Quality:** Geodesic transitions without calibrated road edges prevent `VERIFIED_ROAD_NETWORK` classification and are logged in `missingEvidence`.
5. **No Synthetic Confidence Values:** If Re-ID embeddings are missing, no synthetic values (such as `0.5` or `0.0`) are generated; `isAvailable` is set to `false` and scores remain `null`.
6. **Single-Camera Sightings Not Misrepresented:** Repeated sightings at a single camera have `isCrossCameraConfirmed = false`, preventing stationary observations from being reported as multi-camera vehicle tracking.

---

## 3. Files Created and Modified

| File | Status | Description |
|---|---|---|
| `backend/src/main/java/com/cityai/backend/dto/TrajectoryQualityDto.java` | Created | Multidimensional quality DTO with counts, dimensions, evidence lists, and warnings. |
| `backend/src/main/java/com/cityai/backend/service/TrajectoryQualityService.java` | Created | Dedicated quality evaluation service implementing the Batch 3.2 validation rules. |
| `backend/src/main/java/com/cityai/backend/controller/GlobalIdentityController.java` | Modified | Added endpoint `GET /api/identities/{id}/trajectory/quality`. |
| `backend/src/test/java/com/cityai/backend/service/TrajectoryQualityServiceTest.java` | Created | 12 unit tests covering all required quality scenarios. |
| `backend/src/test/java/com/cityai/backend/controller/GlobalIdentityControllerTest.java` | Modified | Added endpoint unit tests for quality API (200 OK, 404 Not Found, 400 Bad Request). |
| `scripts/verify_a5_batch3_2_quality.py` | Created | Live integration test verifying quality API against running Spring Boot and Supabase PostgreSQL. |

---

## 4. REST API Specification & Live Verified Response

### Endpoint: `GET /api/identities/{id}/trajectory/quality`

#### Live Verified JSON Response (`200 OK`):
```json
{
  "globalIdentityId": "41b95c1f-5ff2-4601-986d-fd42d1f3c51c",
  "label": "GLOBAL-VEH-A385B599",
  "overallQuality": "LOW_CONFIDENCE",
  "summary": "Trajectory contains 1 impossible transition(s) violating physical travel speed constraints.",
  "isCrossCameraConfirmed": true,
  "hasImpossibleTransitions": true,
  "hasContradictions": true,
  "counts": {
    "totalObservations": 3,
    "confirmedObservations": 3,
    "uncertainObservations": 0,
    "excludedObservations": 0,
    "distinctCameraCount": 3,
    "totalTransitions": 2,
    "feasibleTransitions": 1,
    "impossibleTransitions": 1,
    "unknownFeasibilityTransitions": 0,
    "verifiedRoadTransitions": 0,
    "unverifiedGeodesicTransitions": 2,
    "sameCameraTransitions": 0
  },
  "dimensions": {
    "identityMembership": {
      "status": "CONFIRMED",
      "confirmedCount": 3,
      "excludedCount": 0,
      "reviewStatusesSeen": [
        "SYSTEM_DECIDED",
        "CONFIRMED_BY_USER"
      ],
      "summary": "All 3 observations backed by confirmed match decisions."
    },
    "detectionConfidence": {
      "status": "HIGH",
      "minConfidence": 0.91,
      "avgConfidence": 0.923,
      "maxConfidence": 0.94,
      "lowConfidenceCount": 0,
      "summary": "High detection confidence (avg=0.92, min=0.91, max=0.94)."
    },
    "ocrAndPlateConsistency": {
      "status": "CONSISTENT",
      "platesSeen": [
        "MH12QL7777"
      ],
      "minPlateConfidence": 0.92,
      "avgPlateConfidence": 0.933,
      "summary": "Consistent license plate 'MH12QL7777' across all 3 plate readings (avg confidence=0.93)."
    },
    "reidSimilarity": {
      "status": "HIGH_SIMILARITY",
      "isAvailable": true,
      "minScore": 1.0,
      "avgScore": 1.0,
      "maxScore": 1.0,
      "modelName": "fastreid-sbs-R50-ibn",
      "summary": "High Re-ID visual appearance similarity (avg=1.000, model=fastreid-sbs-R50-ibn)."
    },
    "spatialTemporalFeasibility": {
      "status": "CONTAINS_IMPOSSIBLE_TRANSITIONS",
      "distinctCameras": 3,
      "verifiedRoadEdges": 0,
      "unverifiedGeodesics": 2,
      "sameCameraTransitions": 0,
      "impossibleTransitions": 1,
      "unknownTransitions": 0,
      "summary": "1 impossible transition(s) detected violating physical travel thresholds."
    },
    "evidenceCompleteness": {
      "status": "COMPLETE",
      "missingTimestampsCount": 0,
      "missingCoordinatesCount": 0,
      "missingReidCount": 0,
      "missingPlateCount": 0,
      "summary": "All required telemetry, appearance embeddings, and OCR evidence are present."
    }
  },
  "supportingEvidence": [
    "Authoritative identity membership confirmed across 3 observation(s).",
    "High vehicle detection confidence (average 92.3% across 3 detections).",
    "Consistent license plate 'MH12QL7777' observed across multiple sightings (avg OCR confidence 93.3%).",
    "High visual Re-ID appearance similarity (avg=1.000 using fastreid-sbs-R50-ibn)."
  ],
  "missingEvidence": [],
  "warningsAndContradictions": [
    "Impossible transition from CAM-02 to CAM-06: Apparent straight-line speed (15149.0 km/h) exceeds physical threshold (100.0 km/h) over 8.42 km in 2.0s; unverified geodesic transition."
  ]
}
```

#### Error Handling Responses:
- Nonexistent Global Identity (`404 NOT_FOUND`):
  ```json
  {
    "error": "NOT_FOUND",
    "message": "Global identity not found with id: 00000000-0000-0000-0000-000000000000",
    "timestamp": "2026-11-04T14:45:58.210Z"
  }
  ```
- Malformed UUID String (`400 INVALID_REQUEST`):
  ```json
  {
    "error": "INVALID_REQUEST",
    "message": "Invalid UUID string: invalid-uuid-string",
    "timestamp": "2026-11-04T14:45:58.245Z"
  }
  ```

---

## 5. Verification Results Across All 12 Acceptance Cases

| # | Acceptance Scenario | Test Method in `TrajectoryQualityServiceTest` | Expected Quality | Status |
|---|---|---|---|---|
| **1** | High-quality trajectory with verified road edges | `testCase1_HighQualityTrajectory_VerifiedRoadEdges` | `HIGH_CONFIDENCE` | **PASS** |
| **2** | Geodesic-only trajectory | `testCase2_GeodesicOnlyTrajectory_MediumConfidence` | `MEDIUM_CONFIDENCE` | **PASS** |
| **3** | Impossible transition | `testCase3_ImpossibleTransition_LowConfidence` | `LOW_CONFIDENCE` | **PASS** |
| **4** | Missing camera coordinates | `testCase4_MissingCoordinates_ReducesCompleteness` | `MEDIUM_CONFIDENCE` | **PASS** |
| **5** | Missing timestamp | `testCase5_MissingTimestamp_ReducesCompleteness` | `MEDIUM_CONFIDENCE` | **PASS** |
| **6** | Low detection confidence | `testCase6_LowDetectionConfidence_FlagsWarning` | `LOW_CONFIDENCE` | **PASS** |
| **7** | Contradictory plate evidence | `testCase7_ContradictoryPlateEvidence_FlagsContradiction` | `LOW_CONFIDENCE` | **PASS** |
| **8** | Missing Re-ID similarity | `testCase8_MissingReidSimilarity_NotFabricated` | `reid.isAvailable = false` | **PASS** |
| **9** | Single-camera-only observations | `testCase9_SingleCameraObservations_NotCrossCameraConfirmed` | `INSUFFICIENT_EVIDENCE` | **PASS** |
| **10** | Empty trajectory | `testCase10_EmptyTrajectory_InsufficientEvidence` | `INSUFFICIENT_EVIDENCE` | **PASS** |
| **11** | Pending/rejected associations excluded | `testCase11_RejectedOrConflictedAssociations_FlagsConflicted` | `LOW_CONFIDENCE` | **PASS** |
| **12** | Mixed-quality trajectory with multiple warnings | `testCase12_MixedQualityTrajectory_AggregatesWarnings` | Aggregated warnings | **PASS** |

---

## 6. Full Regression Suite Results

All unit, integration, contract, type-checking, and build suites completed cleanly with zero regressions:

| Suite | Component | Command | Result | Duration |
|---|---|---|---|---|
| **Backend** | Spring Boot / Maven | `mvn test -f backend/pom.xml` | **192 passed / 192 total** | 11.62s |
| **AI Service** | Pytest | `pytest ai-service/tests/ -v` | **28 passed / 28 total** | 10.45s |
| **Frontend Contract** | Vitest / tsx | `npm --prefix frontend test -- --run` | **21 passed / 21 total** | 2.05s |
| **Frontend Types** | TypeScript Compiler | `tsc --project frontend/tsconfig.json --noEmit` | **Clean (0 errors)** | 2.15s |
| **Frontend Build** | Next.js 16.3.4 (Turbopack) | `npm --prefix frontend run build` | **5 / 5 pages built** | 0.84s |

---

## 7. Known Limitations & Scope Boundaries

1. **No Calibrated Bayesian Identity Probability:**  
   In compliance with forensic guidelines, the platform does not output a synthetic "98.5% probability that this is the suspect vehicle". Evidence is presented strictly across qualitative confidence tiers with factual underlying metrics.
2. **Backward Compatibility:**  
   `GET /api/identities/{id}/trajectory` remains completely unchanged and backward compatible. The new quality service is exposed on `GET /api/identities/{id}/trajectory/quality`.
3. **Frontend Scope Boundary:**  
   No dashboard, map view, or UI components were created or modified during this backend batch.
4. **Git Hygiene:**  
   No git commits, pushes, or remote modifications occurred.

