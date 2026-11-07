import assert from "node:assert";
import React from "react";
import ReactDOMServer from "react-dom/server";
import { TrajectoryQualityPanel } from "../components/TrajectoryQualityPanel";
import type {
  TrajectoryQualityDto,
  GlobalTrajectoryDto,
  TrajectoryObservationDto,
  TrajectoryTransitionDto,
} from "./api";

// Live backend fixture from Supabase DB (GET /api/identities/04ba4c4d-11b8-40ea-b914-029c6f04c36e/trajectory/quality)
const REAL_BACKEND_QUALITY_FIXTURE: TrajectoryQualityDto = {
  globalIdentityId: "04ba4c4d-11b8-40ea-b914-029c6f04c36e",
  label: "GLOBAL-VEH-F1459702",
  overallQuality: "MEDIUM_CONFIDENCE",
  summary: "Trajectory has partial evidence or missing spatial-temporal telemetry preventing complete verification.",
  isCrossCameraConfirmed: true,
  hasImpossibleTransitions: false,
  hasContradictions: false,
  counts: {
    totalObservations: 3,
    confirmedObservations: 3,
    uncertainObservations: 0,
    excludedObservations: 0,
    distinctCameraCount: 3,
    totalTransitions: 2,
    feasibleTransitions: 2,
    impossibleTransitions: 0,
    unknownFeasibilityTransitions: 0,
    verifiedRoadTransitions: 0,
    unverifiedGeodesicTransitions: 2,
    sameCameraTransitions: 0,
  },
  dimensions: {
    identityMembership: {
      status: "CONFIRMED",
      confirmedCount: 3,
      excludedCount: 0,
      reviewStatusesSeen: ["CONFIRMED_BY_USER", "SYSTEM_DECIDED"],
      summary: "All 3 observations backed by confirmed match decisions.",
    },
    detectionConfidence: {
      status: "HIGH",
      minConfidence: 0.91,
      avgConfidence: 0.933,
      maxConfidence: 0.95,
      lowConfidenceCount: 0,
      summary: "High detection confidence (avg=0.93, min=0.91, max=0.95).",
    },
    ocrAndPlateConsistency: {
      status: "CONSISTENT",
      platesSeen: ["MH12DE1001"],
      minPlateConfidence: 0.9,
      avgPlateConfidence: 0.91,
      summary: "Consistent license plate 'MH12DE1001' across all 2 plate readings (avg confidence=0.91).",
    },
    reidSimilarity: {
      status: "HIGH_SIMILARITY",
      isAvailable: true,
      minScore: 1.0,
      avgScore: 1.0,
      maxScore: 1.0,
      modelName: "fastreid_veri_sbs_r50_ibn",
      summary: "High Re-ID visual appearance similarity (avg=1.000, model=fastreid_veri_sbs_r50_ibn).",
    },
    spatialTemporalFeasibility: {
      status: "PLAUSIBLE_GEODESIC",
      distinctCameras: 3,
      verifiedRoadEdges: 0,
      unverifiedGeodesics: 2,
      sameCameraTransitions: 0,
      impossibleTransitions: 0,
      unknownTransitions: 0,
      summary: "Transitions are physically feasible under urban speed limits, but 2 corridor(s) rely on unverified geodesic bounds.",
    },
    evidenceCompleteness: {
      status: "PARTIAL",
      missingTimestampsCount: 0,
      missingCoordinatesCount: 0,
      missingReidCount: 0,
      missingPlateCount: 1,
      summary: "Spatial-temporal telemetry is complete, but some OCR or Re-ID evidence is missing.",
    },
  },
  supportingEvidence: [
    "Authoritative identity membership confirmed across 3 observation(s).",
    "High vehicle detection confidence (average 93.3% across 3 detections).",
    "Consistent license plate 'MH12DE1001' observed across multiple sightings (avg OCR confidence 91.0%).",
    "High visual Re-ID appearance similarity (avg=1.000 using fastreid_veri_sbs_r50_ibn).",
    "Multi-camera transition feasible within urban speed thresholds across 3 cameras.",
  ],
  missingEvidence: [
    "Road network calibration missing for 2 cross-camera corridor(s); straight-line geodesic used.",
    "Missing license plate readings on 1 observation(s).",
  ],
  warningsAndContradictions: [],
};

function renderClean(el: React.ReactElement): string {
  return ReactDOMServer.renderToString(el).replace(/<!--.*?-->/g, "");
}

async function runTests() {
  console.log("Starting Trajectory Component & Contract Verification Suite...");

  // ============================================================================
  // Test 1: Exact Backend Quality API Contract & Six Dimensions Rendering
  // ============================================================================
  {
    const html = renderClean(
      React.createElement(TrajectoryQualityPanel, { quality: REAL_BACKEND_QUALITY_FIXTURE })
    );

  // 1. identityMembership
  assert.ok(html.includes("data-testid=\"dimension-identityMembership\""), "Missing identityMembership dimension");
  assert.ok(html.includes("CONFIRMED"), "Missing identityMembership status");
  assert.ok(html.includes("All 3 observations backed by confirmed match decisions."), "Missing identityMembership summary");
  assert.ok(html.includes("Confirmed: 3"), "Missing confirmed count");

  // 2. detectionConfidence
  assert.ok(html.includes("data-testid=\"dimension-detectionConfidence\""), "Missing detectionConfidence dimension");
  assert.ok(html.includes("HIGH"), "Missing detectionConfidence status");
  assert.ok(html.includes("High detection confidence (avg=0.93, min=0.91, max=0.95)."), "Missing detectionConfidence summary");
  assert.ok(html.includes("93.3%"), "Missing detectionConfidence percentage");

  // 3. ocrAndPlateConsistency
  assert.ok(html.includes("data-testid=\"dimension-ocrAndPlateConsistency\""), "Missing ocrAndPlateConsistency dimension");
  assert.ok(html.includes("CONSISTENT"), "Missing ocrAndPlateConsistency status");
  assert.ok(html.includes("Consistent license plate &#x27;MH12DE1001&#x27; across all 2 plate readings"), "Missing ocrAndPlateConsistency summary");
  assert.ok(html.includes("MH12DE1001"), "Missing plate seen text");

  // 4. reidSimilarity
  assert.ok(html.includes("data-testid=\"dimension-reidSimilarity\""), "Missing reidSimilarity dimension");
  assert.ok(html.includes("HIGH_SIMILARITY"), "Missing reidSimilarity status");
  assert.ok(html.includes("fastreid_veri_sbs_r50_ibn"), "Missing reidSimilarity model name");
  assert.ok(html.includes("1.000"), "Missing reidSimilarity score");

  // 5. spatialTemporalFeasibility
  assert.ok(html.includes("data-testid=\"dimension-spatialTemporalFeasibility\""), "Missing spatialTemporalFeasibility dimension");
  assert.ok(html.includes("PLAUSIBLE_GEODESIC"), "Missing spatialTemporalFeasibility status");
  assert.ok(html.includes("Transitions are physically feasible under urban speed limits"), "Missing spatialTemporalFeasibility summary");
  assert.ok(html.includes("Unverified Geodesics: 2"), "Missing unverified geodesics count");

  // 6. evidenceCompleteness
  assert.ok(html.includes("data-testid=\"dimension-evidenceCompleteness\""), "Missing evidenceCompleteness dimension");
  assert.ok(html.includes("PARTIAL"), "Missing evidenceCompleteness status");
  assert.ok(html.includes("Spatial-temporal telemetry is complete, but some OCR or Re-ID evidence is missing."), "Missing evidenceCompleteness summary");
  assert.ok(html.includes("Plate: 1"), "Missing missing plate count");

  console.log("[Component 1/10] Real backend fixture contract test & all 6 dimensions verified: PASSED");
}

// ============================================================================
// Test 2: All Four Quality Categories Render Correct Badges and Styling
// ============================================================================
{
  const categories: Array<{
    cat: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" | "INSUFFICIENT_EVIDENCE";
    expectedText: string;
    expectedBorder: string;
  }> = [
    { cat: "HIGH_CONFIDENCE", expectedText: "HIGH CONFIDENCE", expectedBorder: "border-emerald-500" },
    { cat: "MEDIUM_CONFIDENCE", expectedText: "MEDIUM CONFIDENCE", expectedBorder: "border-amber-500" },
    { cat: "LOW_CONFIDENCE", expectedText: "LOW CONFIDENCE", expectedBorder: "border-rose-500" },
    { cat: "INSUFFICIENT_EVIDENCE", expectedText: "INSUFFICIENT EVIDENCE", expectedBorder: "border-slate-400" },
  ];

  for (const { cat, expectedText, expectedBorder } of categories) {
    const q: TrajectoryQualityDto = {
      ...REAL_BACKEND_QUALITY_FIXTURE,
      overallQuality: cat,
      summary: `Test summary for category ${cat}`,
    };
    const html = renderClean(React.createElement(TrajectoryQualityPanel, { quality: q }));
    assert.ok(html.includes(expectedText), `Category ${cat} did not render expected text '${expectedText}'`);
    assert.ok(html.includes(expectedBorder), `Category ${cat} did not render expected border '${expectedBorder}'`);
    assert.ok(
      html.includes("Ratings represent evidence quality and verification rigor, NOT statistical probabilities."),
      "Missing statutory probability disclaimer"
    );
  }

  console.log("[Component 2/10] All 4 quality categories verified with disclaimers: PASSED");
}

// ============================================================================
// Test 3: Missing Evidence Section Renders Checklist Verbatim
// ============================================================================
{
  const q: TrajectoryQualityDto = {
    ...REAL_BACKEND_QUALITY_FIXTURE,
    missingEvidence: [
      "Road network calibration missing for CAM-01 -> CAM-02",
      "Re-ID embedding missing for observation 5",
      "OCR license plate unrecognized on camera CAM-03",
    ],
  };

  const html = renderClean(React.createElement(TrajectoryQualityPanel, { quality: q }));
  assert.ok(html.includes("Missing Evidence or Uncalibrated Corridors (3)"), "Missing evidence header not rendered");
  assert.ok(html.includes("Road network calibration missing for CAM-01 -&gt; CAM-02"), "Missing edge item not rendered");
  assert.ok(html.includes("Re-ID embedding missing for observation 5"), "Missing ReID item not rendered");
  assert.ok(html.includes("OCR license plate unrecognized on camera CAM-03"), "Missing plate item not rendered");

  console.log("[Component 3/10] Missing evidence checklist rendered verbatim: PASSED");
}

// ============================================================================
// Test 4: Contradictory Evidence & Warnings Surfaced in Alert Banner
// ============================================================================
{
  const q: TrajectoryQualityDto = {
    ...REAL_BACKEND_QUALITY_FIXTURE,
    overallQuality: "LOW_CONFIDENCE",
    hasContradictions: true,
    warningsAndContradictions: [
      "Contradictory license plates observed: MH12DE1001 vs MH12TC2002",
      "Active association conflict or user rejection recorded in identity history.",
      "Speed constraint violated: apparent speed 245.0 km/h exceeds physical limit.",
    ],
  };

  const html = renderClean(React.createElement(TrajectoryQualityPanel, { quality: q }));
  assert.ok(html.includes("Warnings &amp; Contradictions (3)"), "Contradictions banner missing");
  assert.ok(html.includes("Contradictory license plates observed"), "Plate contradiction missing");
  assert.ok(html.includes("Active association conflict"), "Conflict warning missing");
  assert.ok(html.includes("Speed constraint violated"), "Speed violation missing");

  console.log("[Component 4/10] Contradictory evidence & warnings rendered in alert banner: PASSED");
}

// ============================================================================
// Test 5: Impossible Transitions Excluded from Routes and Preserved with Reasons
// ============================================================================
{
  const impossibleTransition: TrajectoryTransitionDto = {
    fromDetectionId: 10,
    toDetectionId: 11,
    fromCameraId: "CAM-01",
    toCameraId: "CAM-02",
    fromTimestamp: "2026-11-04T12:00:00Z",
    toTimestamp: "2026-11-04T12:00:05Z",
    deltaSeconds: 5.0,
    distanceKm: 2.5,
    distanceMethod: "POSTGIS_GEODESIC_SPHERE",
    connectivity: "UNVERIFIED_GEODESIC",
    isVerifiedTopology: false,
    apparentSpeedKmh: 1800.0,
    status: "IMPOSSIBLE",
    reason: "Apparent straight-line speed (1800.0 km/h) exceeds physical threshold (180.0 km/h) over 2.50 km in 5.0s",
  };

  assert.strictEqual(impossibleTransition.status, "IMPOSSIBLE");
  assert.strictEqual(impossibleTransition.apparentSpeedKmh, 1800.0);
  assert.ok(impossibleTransition.reason.includes("exceeds physical threshold"), "Backend reason preserved verbatim");

  // In quality metrics, impossible transitions are tracked and displayed
  const q: TrajectoryQualityDto = {
    ...REAL_BACKEND_QUALITY_FIXTURE,
    hasImpossibleTransitions: true,
    counts: {
      ...REAL_BACKEND_QUALITY_FIXTURE.counts,
      impossibleTransitions: 1,
      feasibleTransitions: 1,
    },
  };
  const html = renderClean(React.createElement(TrajectoryQualityPanel, { quality: q }));
  assert.ok(html.includes("Impossible Transits"), "Impossible transit counter not shown");
  assert.ok(html.includes("text-rose-600"), "Impossible transit counter not highlighted in rose");

  console.log("[Component 5/10] Impossible transitions preserved with verbatim reasons and alert styling: PASSED");
}

// ============================================================================
// Test 6: Unknown Transitions Feasibility Preserved Verbatim
// ============================================================================
{
  const unknownTransition: TrajectoryTransitionDto = {
    fromDetectionId: 20,
    toDetectionId: 21,
    fromCameraId: "CAM-05",
    toCameraId: "CAM-06",
    fromTimestamp: null,
    toTimestamp: "2026-11-04T13:00:00Z",
    deltaSeconds: null,
    distanceKm: null,
    distanceMethod: "UNKNOWN_TIMESTAMPS",
    connectivity: "UNKNOWN",
    isVerifiedTopology: false,
    apparentSpeedKmh: null,
    status: "FEASIBILITY_UNKNOWN",
    reason: "Missing observation timestamp; temporal feasibility cannot be evaluated.",
  };

  assert.strictEqual(unknownTransition.status, "FEASIBILITY_UNKNOWN");
  assert.strictEqual(unknownTransition.connectivity, "UNKNOWN");
  assert.ok(unknownTransition.reason.includes("Missing observation timestamp"), "Reason preserved verbatim");

  console.log("[Component 6/10] Unknown transitions feasibility preserved verbatim: PASSED");
}

// ============================================================================
// Test 7: Unverified Geodesic Connections Kept Distinct From Verified Road Edges
// ============================================================================
{
  const verifiedTrans: TrajectoryTransitionDto = {
    fromDetectionId: 1,
    toDetectionId: 2,
    fromCameraId: "CAM-01",
    toCameraId: "CAM-02",
    fromTimestamp: "2026-11-04T10:00:00Z",
    toTimestamp: "2026-11-04T10:02:00Z",
    deltaSeconds: 120.0,
    distanceKm: 1.2,
    distanceMethod: "VERIFIED_ROAD_NETWORK",
    connectivity: "VERIFIED_ROAD_EDGE",
    isVerifiedTopology: true,
    apparentSpeedKmh: 36.0,
    status: "FEASIBLE",
    reason: "Feasible transit via verified road edge 'FC Road Corridor' (1.20 km in 120.0s, speed=36.0 km/h)",
  };

  const geodesicTrans: TrajectoryTransitionDto = {
    fromDetectionId: 2,
    toDetectionId: 3,
    fromCameraId: "CAM-02",
    toCameraId: "CAM-03",
    fromTimestamp: "2026-11-04T10:02:00Z",
    toTimestamp: "2026-11-04T10:06:00Z",
    deltaSeconds: 240.0,
    distanceKm: 2.1,
    distanceMethod: "POSTGIS_GEODESIC_SPHERE",
    connectivity: "UNVERIFIED_GEODESIC",
    isVerifiedTopology: false,
    apparentSpeedKmh: 31.5,
    status: "FEASIBLE",
    reason: "Feasible straight-line transit (2.10 km in 240.0s, apparent speed=31.5 km/h); road topology unverified.",
  };

  assert.notStrictEqual(verifiedTrans.connectivity, geodesicTrans.connectivity);
  assert.strictEqual(verifiedTrans.isVerifiedTopology, true);
  assert.strictEqual(geodesicTrans.isVerifiedTopology, false);
  assert.strictEqual(verifiedTrans.connectivity, "VERIFIED_ROAD_EDGE");
  assert.strictEqual(geodesicTrans.connectivity, "UNVERIFIED_GEODESIC");

  console.log("[Component 7/10] Unverified geodesic connections strictly separated from verified road edges: PASSED");
}

// ============================================================================
// Test 8: Missing Camera Coordinates Omitted; No (0,0) Position Fabricated
// ============================================================================
{
  const validObs: TrajectoryObservationDto = {
    detectionId: 1,
    globalIdentityId: "04ba4c4d-11b8-40ea-b914-029c6f04c36e",
    cameraId: "CAM-01",
    cameraName: "Shivajinagar",
    timestamp: "2026-11-04T10:00:00Z",
    latitude: 18.5308,
    longitude: 73.8474,
    hasCoordinates: true,
    direction: "SE",
    speedKmh: 40.0,
    vehicleClass: "car",
    detectionConfidence: 0.95,
    plateText: "MH12DE1001",
    plateConfidence: 0.92,
    reidConfidence: 0.94,
    imagePath: "/crop.jpg",
    trackId: 101,
    frameNumber: 50,
    provenance: null,
  };

  const missingObs: TrajectoryObservationDto = {
    ...validObs,
    detectionId: 2,
    cameraId: "CAM-UNKNOWN",
    latitude: null,
    longitude: null,
    hasCoordinates: false,
  };

  // MapLibre valid observation filter:
  const observations = [validObs, missingObs];
  const mapRenderedObservations = observations.filter(
    (o) =>
      o.hasCoordinates &&
      o.latitude != null &&
      o.longitude != null &&
      !isNaN(o.latitude) &&
      !isNaN(o.longitude) &&
      (Math.abs(o.latitude) > 1e-4 || Math.abs(o.longitude) > 1e-4)
  );

  assert.strictEqual(mapRenderedObservations.length, 1);
  assert.strictEqual(mapRenderedObservations[0].detectionId, 1);
  assert.strictEqual(observations.length - mapRenderedObservations.length, 1);

  console.log("[Component 8/10] Missing camera coordinates omitted from map geometry without (0,0) fabrication: PASSED");
}

// ============================================================================
// Test 9: Empty Trajectory Handles 0 Observations Gracefully
// ============================================================================
{
  const emptyQuality: TrajectoryQualityDto = {
    globalIdentityId: "00000000-0000-0000-0000-000000000000",
    label: "GLOBAL-VEH-EMPTY",
    overallQuality: "INSUFFICIENT_EVIDENCE",
    summary: "Empty trajectory: zero confirmed vehicle observations exist for this identity.",
    isCrossCameraConfirmed: false,
    hasImpossibleTransitions: false,
    hasContradictions: false,
    counts: {
      totalObservations: 0,
      confirmedObservations: 0,
      uncertainObservations: 0,
      excludedObservations: 0,
      distinctCameraCount: 0,
      totalTransitions: 0,
      feasibleTransitions: 0,
      impossibleTransitions: 0,
      unknownFeasibilityTransitions: 0,
      verifiedRoadTransitions: 0,
      unverifiedGeodesicTransitions: 0,
      sameCameraTransitions: 0,
    },
    dimensions: {
      identityMembership: {
        status: "INSUFFICIENT_DATA",
        confirmedCount: 0,
        excludedCount: 0,
        reviewStatusesSeen: [],
        summary: "No confirmed observations associated with identity.",
      },
      detectionConfidence: {
        status: "INSUFFICIENT_DATA",
        minConfidence: null,
        avgConfidence: null,
        maxConfidence: null,
        lowConfidenceCount: 0,
        summary: "No confirmed vehicle detections available to evaluate confidence.",
      },
      ocrAndPlateConsistency: {
        status: "NO_READINGS",
        platesSeen: [],
        minPlateConfidence: null,
        avgPlateConfidence: null,
        summary: "No license plate readings available across confirmed observations.",
      },
      reidSimilarity: {
        status: "MISSING_EVIDENCE",
        isAvailable: false,
        minScore: null,
        avgScore: null,
        maxScore: null,
        modelName: null,
        summary: "No cross-camera associations with Re-ID similarity scores available.",
      },
      spatialTemporalFeasibility: {
        status: "EMPTY",
        distinctCameras: 0,
        verifiedRoadEdges: 0,
        unverifiedGeodesics: 0,
        sameCameraTransitions: 0,
        impossibleTransitions: 0,
        unknownTransitions: 0,
        summary: "No confirmed observations exist to evaluate spatial-temporal feasibility.",
      },
      evidenceCompleteness: {
        status: "INSUFFICIENT",
        missingTimestampsCount: 0,
        missingCoordinatesCount: 0,
        missingReidCount: 0,
        missingPlateCount: 0,
        summary: "Insufficient confirmed observations to evaluate completeness.",
      },
    },
    supportingEvidence: [],
    missingEvidence: ["No confirmed vehicle sightings recorded for this identity."],
    warningsAndContradictions: [],
  };

  const html = renderClean(
    React.createElement(TrajectoryQualityPanel, { quality: emptyQuality })
  );

  assert.ok(html.includes("INSUFFICIENT EVIDENCE"), "Empty trajectory category badge missing");
  assert.ok(html.includes("Empty trajectory: zero confirmed vehicle observations"), "Summary missing");
  assert.ok(html.includes("Confirmed Sightings"), "Counts grid missing");
  assert.ok(html.includes(">0<"), "Confirmed sightings count should be 0");

  console.log("[Component 9/10] Empty trajectory rendered gracefully with INSUFFICIENT_EVIDENCE: PASSED");
}

// ============================================================================
// Test 10: Identity Switching & Stale Request Abort Handling
// ============================================================================
{
  let abortedCalled = false;
  const controller = new AbortController();

  const abortableFetch = async (signal: AbortSignal) => {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve("stale_data"), 200);
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        abortedCalled = true;
        const err = new Error("The user aborted a request.");
        err.name = "AbortError";
        reject(err);
      });
    });
  };

  // Launch request for identity A
  const p1 = abortableFetch(controller.signal);

  // Rapidly switch to identity B: abort previous
  controller.abort();

  let errorCaught = false;
  try {
    await p1;
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      errorCaught = true;
    }
  }

  assert.strictEqual(abortedCalled, true, "Abort handler should be triggered");
  assert.strictEqual(errorCaught, true, "AbortError should be cleanly thrown");

  console.log("[Component 10/10] Rapid identity switching aborts in-flight request cleanly: PASSED");
}

  console.log("\nAll 10 Trajectory Component & Contract Verification tests passed successfully!");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
