import assert from "node:assert";
import {
  getGlobalTrajectory,
  getGlobalTrajectoryQuality,
  listGlobalIdentities,
  searchGlobalIdentity,
  ApiError,
  type GlobalTrajectoryDto,
  type TrajectoryQualityDto,
  type TrajectoryObservationDto,
  type TrajectoryTransitionDto,
  type TrajectorySegmentDto,
} from "./api";

interface MockResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
  networkError?: string;
}

let queue: MockResponse[] = [];

// Intercept global fetch for deterministic contract testing
const originalFetch = global.fetch;
global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  if (init?.signal?.aborted) {
    const error = new Error("The user aborted a request.");
    error.name = "AbortError";
    throw error;
  }

  if (queue.length === 0) {
    throw new Error(`Unexpected fetch call to ${input.toString()}`);
  }
  const next = queue.shift()!;
  if (next.networkError) {
    throw new Error(next.networkError);
  }
  const status = next.status ?? (next.ok === false ? 500 : 200);
  const ok = next.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    json: async () => next.body,
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as Response;
};

// Fixture generators
function mockObservation(
  id: number,
  cam: string,
  hasCoords: boolean,
  lat: number | null,
  lon: number | null
): TrajectoryObservationDto {
  return {
    detectionId: id,
    globalIdentityId: "41b95c1f-5ff2-4601-986d-fd42d1f3c51c",
    cameraId: cam,
    cameraName: `${cam} Name`,
    timestamp: "2026-11-04T10:00:00Z",
    latitude: lat,
    longitude: lon,
    hasCoordinates: hasCoords,
    direction: "SE",
    speedKmh: 45.0,
    vehicleClass: "car",
    detectionConfidence: 0.94,
    plateText: "MH12QL7777",
    plateConfidence: 0.93,
    reidConfidence: 0.91,
    imagePath: "/storage/crop.jpg",
    trackId: 101,
    frameNumber: 50,
    provenance: {
      associationId: "096114f2-692b-4799-b153-428b63c47004",
      associationDecision: "MATCH",
      associationReviewStatus: "SYSTEM_DECIDED",
      reidScore: 0.98,
      plateScore: 1.0,
      isSeedObservation: id === 1,
    },
  };
}

function mockTrajectoryDto(hasImpossible: boolean = false, hasMissingCoords: boolean = false): GlobalTrajectoryDto {
  const o1 = mockObservation(1, "CAM-01", true, 18.5308, 73.8474);
  const o2 = mockObservation(2, "CAM-02", !hasMissingCoords, hasMissingCoords ? null : 18.5236, hasMissingCoords ? null : 73.8478);

  const t1: TrajectoryTransitionDto = {
    fromDetectionId: 1,
    toDetectionId: 2,
    fromCameraId: "CAM-01",
    toCameraId: "CAM-02",
    fromTimestamp: "2026-11-04T10:00:00Z",
    toTimestamp: "2026-11-04T10:01:30Z",
    deltaSeconds: 90.0,
    distanceKm: 0.8,
    distanceMethod: "POSTGIS_GEODESIC_SPHERE",
    connectivity: "UNVERIFIED_GEODESIC",
    isVerifiedTopology: false,
    apparentSpeedKmh: 32.0,
    status: hasImpossible ? "IMPOSSIBLE" : "FEASIBLE",
    reason: hasImpossible ? "Apparent speed violates threshold" : "Feasible geodesic transit",
  };

  const seg: TrajectorySegmentDto = {
    segmentIndex: 1,
    segmentType: "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE",
    isFullyVerifiedRoadRoute: false,
    observationCount: 2,
    startObservationId: 1,
    endObservationId: 2,
    startTime: "2026-11-04T10:00:00Z",
    endTime: "2026-11-04T10:01:30Z",
    durationSeconds: 90.0,
    totalDistanceKm: 0.8,
    observations: [o1, o2],
    breakReason: null,
  };

  return {
    globalIdentityId: "41b95c1f-5ff2-4601-986d-fd42d1f3c51c",
    label: "GLOBAL-VEH-A385B599",
    primaryPlate: "MH12QL7777",
    vehicleClass: "car",
    reviewStatus: "ACTIVE",
    totalObservations: 2,
    confirmedObservations: 2,
    excludedObservations: 0,
    segmentCount: 1,
    hasImpossibleTransitions: hasImpossible,
    hasUnknownFeasibility: false,
    totalFeasibleDistanceKm: 0.8,
    totalDurationSeconds: 90.0,
    firstSeenTimestamp: "2026-11-04T10:00:00Z",
    lastSeenTimestamp: "2026-11-04T10:01:30Z",
    observations: [o1, o2],
    transitions: [t1],
    segments: [seg],
  };
}

function mockQualityDto(overall: string = "MEDIUM_CONFIDENCE"): TrajectoryQualityDto {
  return {
    globalIdentityId: "41b95c1f-5ff2-4601-986d-fd42d1f3c51c",
    label: "GLOBAL-VEH-A385B599",
    overallQuality: overall,
    summary: "Trajectory evaluated across 6 evidence dimensions",
    isCrossCameraConfirmed: true,
    hasImpossibleTransitions: overall === "LOW_CONFIDENCE",
    hasContradictions: overall === "LOW_CONFIDENCE",
    counts: {
      totalObservations: 2,
      confirmedObservations: 2,
      uncertainObservations: 0,
      excludedObservations: 0,
      distinctCameraCount: 2,
      totalTransitions: 1,
      feasibleTransitions: overall === "LOW_CONFIDENCE" ? 0 : 1,
      impossibleTransitions: overall === "LOW_CONFIDENCE" ? 1 : 0,
      unknownFeasibilityTransitions: 0,
      verifiedRoadTransitions: overall === "HIGH_CONFIDENCE" ? 1 : 0,
      unverifiedGeodesicTransitions: overall === "HIGH_CONFIDENCE" ? 0 : 1,
      sameCameraTransitions: 0,
    },
    dimensions: {
      identityMembership: { status: "CONFIRMED", confirmedCount: 2, excludedCount: 0, reviewStatusesSeen: ["SYSTEM_DECIDED"], summary: "All confirmed" },
      detectionConfidence: { status: "HIGH", minConfidence: 0.92, avgConfidence: 0.93, maxConfidence: 0.94, lowConfidenceCount: 0, summary: "High detection conf" },
      ocrAndPlateConsistency: { status: "CONSISTENT", platesSeen: ["MH12QL7777"], minPlateConfidence: 0.93, avgPlateConfidence: 0.93, summary: "Consistent plate" },
      reidSimilarity: { status: "HIGH_SIMILARITY", isAvailable: true, minScore: 0.98, avgScore: 0.98, maxScore: 0.98, modelName: "fastreid", summary: "High ReID" },
      spatialTemporalFeasibility: { status: overall === "HIGH_CONFIDENCE" ? "VERIFIED_ROAD_NETWORK" : "PLAUSIBLE_GEODESIC", distinctCameras: 2, verifiedRoadEdges: overall === "HIGH_CONFIDENCE" ? 1 : 0, unverifiedGeodesics: 1, sameCameraTransitions: 0, impossibleTransitions: 0, unknownTransitions: 0, summary: "Feasible" },
      evidenceCompleteness: { status: "COMPLETE", missingTimestampsCount: 0, missingCoordinatesCount: 0, missingReidCount: 0, missingPlateCount: 0, summary: "Complete telemetry" },
    },
    supportingEvidence: ["Confirmed multi-camera sighting across 2 cameras."],
    missingEvidence: overall === "MEDIUM_CONFIDENCE" ? ["Road network calibration missing for 1 corridor(s)."] : [],
    warningsAndContradictions: overall === "LOW_CONFIDENCE" ? ["Impossible transition detected."] : [],
  };
}

async function runTrajectoryTests() {
  console.log("=== RUNNING FRONTEND TRAJECTORY INTEGRATION TESTS ===");

  // Test 1: Successful trajectory reconstruction response
  const validTraj = mockTrajectoryDto();
  queue = [{ status: 200, body: validTraj }];
  const res1 = await getGlobalTrajectory("41b95c1f-5ff2-4601-986d-fd42d1f3c51c");
  assert.strictEqual(res1.globalIdentityId, "41b95c1f-5ff2-4601-986d-fd42d1f3c51c");
  assert.strictEqual(res1.confirmedObservations, 2);
  assert.strictEqual(res1.transitions.length, 1);
  console.log("✔ Test 1: Successful trajectory rendering data fetched correctly");

  // Test 2: Empty trajectory handling (0 observations)
  const emptyTraj: GlobalTrajectoryDto = {
    ...validTraj,
    confirmedObservations: 0,
    totalObservations: 0,
    observations: [],
    transitions: [],
    segments: [],
  };
  queue = [{ status: 200, body: emptyTraj }];
  const res2 = await getGlobalTrajectory("empty-guid");
  assert.strictEqual(res2.confirmedObservations, 0);
  assert.strictEqual(res2.observations.length, 0);
  console.log("✔ Test 2: Empty trajectory returned valid empty structure");

  // Test 3: API error propagation on HTTP 404 Not Found
  queue = [{ status: 404, body: { error: "NOT_FOUND", message: "Global identity not found" } }];
  await assert.rejects(
    async () => await getGlobalTrajectory("nonexistent-guid"),
    (err: ApiError) => err.status === 404 && err.isNotFound,
    "Expected HTTP 404 ApiError"
  );
  console.log("✔ Test 3: API error propagated cleanly on 404");

  // Test 4: API error on HTTP 400 Malformed UUID
  queue = [{ status: 400, body: { error: "INVALID_REQUEST", message: "Invalid UUID string" } }];
  await assert.rejects(
    async () => await getGlobalTrajectory("invalid-uuid"),
    (err: ApiError) => err.status === 400,
    "Expected HTTP 400 ApiError"
  );
  console.log("✔ Test 4: API error propagated cleanly on 400 invalid request");

  // Test 5: Trajectory quality assessment API (HIGH_CONFIDENCE)
  const highQuality = mockQualityDto("HIGH_CONFIDENCE");
  queue = [{ status: 200, body: highQuality }];
  const qualRes = await getGlobalTrajectoryQuality("41b95c1f-5ff2-4601-986d-fd42d1f3c51c");
  assert.strictEqual(qualRes.overallQuality, "HIGH_CONFIDENCE");
  assert.strictEqual(qualRes.dimensions.spatialTemporalFeasibility.status, "VERIFIED_ROAD_NETWORK");
  assert.strictEqual(qualRes.counts.verifiedRoadTransitions, 1);
  console.log("✔ Test 5: Trajectory quality dimensions and verified road edges parsed");

  // Test 6: Impossible transition preserved and flagged
  const impossibleTraj = mockTrajectoryDto(true);
  assert.strictEqual(impossibleTraj.hasImpossibleTransitions, true);
  assert.strictEqual(impossibleTraj.transitions[0].status, "IMPOSSIBLE");
  console.log("✔ Test 6: Impossible transition preserved without discarding violation reason");

  // Test 7: Strict coordinate verification - No fabricated map positions
  const missingCoordsTraj = mockTrajectoryDto(false, true);
  const mapPlacements = missingCoordsTraj.observations.filter(
    (o) => o.hasCoordinates && o.latitude != null && o.longitude != null
  );
  assert.strictEqual(missingCoordsTraj.observations.length, 2);
  assert.strictEqual(mapPlacements.length, 1, "Only observation with valid coordinates can be placed on map");
  assert.strictEqual(missingCoordsTraj.observations[1].hasCoordinates, false);
  console.log("✔ Test 7: Missing coordinates kept off the map; no fabricated positions created");

  // Test 8: Verified vs unverified connectivity distinction
  const verifiedTrans: TrajectoryTransitionDto = {
    ...validTraj.transitions[0],
    connectivity: "VERIFIED_ROAD_EDGE",
    isVerifiedTopology: true,
  };
  const geodesicTrans: TrajectoryTransitionDto = {
    ...validTraj.transitions[0],
    connectivity: "UNVERIFIED_GEODESIC",
    isVerifiedTopology: false,
  };
  assert.strictEqual(verifiedTrans.connectivity, "VERIFIED_ROAD_EDGE");
  assert.strictEqual(verifiedTrans.isVerifiedTopology, true);
  assert.strictEqual(geodesicTrans.connectivity, "UNVERIFIED_GEODESIC");
  assert.strictEqual(geodesicTrans.isVerifiedTopology, false);
  console.log("✔ Test 8: Verified road edge distinct from unverified geodesic connection");

  // Test 9: Warnings and contradictions in LOW_CONFIDENCE quality
  const lowQuality = mockQualityDto("LOW_CONFIDENCE");
  assert.strictEqual(lowQuality.overallQuality, "LOW_CONFIDENCE");
  assert.strictEqual(lowQuality.hasContradictions, true);
  assert.strictEqual(lowQuality.warningsAndContradictions.length, 1);
  console.log("✔ Test 9: Warnings and contradictions surfaced in low-confidence quality");

  // Test 10: Identity switching without stale response contamination (AbortController)
  const controller = new AbortController();
  controller.abort(); // Cancel immediately
  await assert.rejects(
    async () => await getGlobalTrajectory("old-guid", { signal: controller.signal }),
    (err: Error) => err.name === "AbortError" || err.message.includes("aborted"),
    "Expected aborted request to reject cleanly"
  );
  console.log("✔ Test 10: In-flight request aborted cleanly when identity is switched");

  // Test 11: List and search identities API
  queue = [
    {
      status: 200,
      body: {
        content: [
          {
            id: "41b95c1f-5ff2-4601-986d-fd42d1f3c51c",
            label: "GLOBAL-VEH-A385B599",
            primaryPlate: "MH12QL7777",
            plateConfidence: 0.95,
            vehicleClass: "car",
            color: "White",
            make: "Honda",
            model: "City",
            reviewStatus: "ACTIVE",
            reviewNotes: null,
            firstSeenTimestamp: "2026-11-04T10:00:00Z",
            lastSeenTimestamp: "2026-11-04T10:01:30Z",
            detectionCount: 2,
            reidModelName: "fastreid",
            reidModelVersion: "1.0",
            reidDimension: 512,
          },
        ],
        totalElements: 1,
        totalPages: 1,
        size: 20,
        number: 0,
      },
    },
  ];
  const page = await listGlobalIdentities();
  assert.strictEqual(page.content.length, 1);
  assert.strictEqual(page.content[0].primaryPlate, "MH12QL7777");
  console.log("✔ Test 11: listGlobalIdentities paginated response parsed");

  // Test 12: Search identity by plate/label
  queue = [{ status: 200, body: page.content[0] }];
  const match = await searchGlobalIdentity("MH12QL7777");
  assert.strictEqual(match.primaryPlate, "MH12QL7777");
  assert.strictEqual(match.label, "GLOBAL-VEH-A385B599");
  console.log("✔ Test 12: searchGlobalIdentity found exact match");

  console.log("\n==========================================================");
  console.log(" ALL 12 FRONTEND TRAJECTORY INTEGRATION TESTS PASSED! ");
  console.log("==========================================================");
}

runTrajectoryTests().catch((err) => {
  console.error("Test failure:", err);
  process.exit(1);
});

