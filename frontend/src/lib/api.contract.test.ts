import assert from "node:assert";
import {
  getCameras,
  getRecentVehicles,
  getSecurityAlerts,
  getWatchlist,
  addWatchlistEntry,
  predictTrajectory,
  getVideoUploads,
  getVideoUpload,
  deleteVideoUpload,
  uploadVideoToStorage,
  processVideoUpload,
  getVideoDetections,
  ApiError,
  getApiBaseUrl,
  getAiServiceBaseUrl,
  normalizeApiPath,
} from "./api";

interface MockResponse {
  ok?: boolean;
  status?: number;
  body?: unknown;
  networkError?: string;
  abort?: boolean;
}

let queue: MockResponse[] = [];
let fetchHistory: { url: string; method: string; body?: unknown; signalAborted?: boolean }[] = [];

// Intercept global fetch
const originalFetch = global.fetch;
global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = input.toString();
  const signalAborted = Boolean(init?.signal?.aborted);
  fetchHistory.push({
    url,
    method: (init?.method || "GET").toUpperCase(),
    body: init?.body,
    signalAborted,
  });

  if (signalAborted) {
    const abortErr = new Error("This operation was aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }

  if (queue.length === 0) {
    throw new Error(`Unexpected fetch call to ${url}`);
  }
  const next = queue.shift()!;
  if (next.abort) {
    const abortErr = new Error("This operation was aborted");
    abortErr.name = "AbortError";
    throw abortErr;
  }
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

async function runTests() {
  console.log("=== RUNNING FRONTEND API CONTRACT ACCEPTANCE TESTS ===");

  // Test 1: getCameras - 200 empty array
  queue = [{ status: 200, body: [] }];
  const camsEmpty = await getCameras();
  assert.deepStrictEqual(camsEmpty, [], "getCameras must return empty array on 200 with []");
  console.log("✔ Test 1: getCameras returns [] on 200 empty response");

  // Test 2: getCameras - 500 error propagation
  queue = [{ status: 500, body: { message: "Internal DB failure" } }];
  await assert.rejects(
    async () => await getCameras(),
    (err: any) => err instanceof ApiError && err.status === 500 && err.message.includes("Internal DB failure"),
    "getCameras must propagate ApiError on HTTP 500"
  );
  console.log("✔ Test 2: getCameras propagates ApiError on HTTP 500");

  // Test 3: getRecentVehicles - 200 empty array
  queue = [{ status: 200, body: [] }];
  const recentEmpty = await getRecentVehicles();
  assert.deepStrictEqual(recentEmpty, [], "getRecentVehicles must return [] on 200 with []");
  console.log("✔ Test 3: getRecentVehicles returns [] on 200 empty response");

  // Test 4: getRecentVehicles - network error propagation
  queue = [{ networkError: "Connection refused" }];
  await assert.rejects(
    async () => await getRecentVehicles(),
    (err: any) => err instanceof ApiError && err.message.includes("Unable to reach backend"),
    "getRecentVehicles must propagate ApiError on network error"
  );
  console.log("✔ Test 4: getRecentVehicles propagates ApiError on network failure");

  // Test 5: getSecurityAlerts - 200 empty array
  queue = [{ status: 200, body: [] }];
  const alertsEmpty = await getSecurityAlerts();
  assert.deepStrictEqual(alertsEmpty, [], "getSecurityAlerts must return [] on 200 with []");
  console.log("✔ Test 5: getSecurityAlerts returns [] on 200 empty response");

  // Test 6: getSecurityAlerts - 503 error propagation (when backend and direct fail)
  queue = [
    { status: 503, body: { error: "AI_SERVICE_UNAVAILABLE", message: "Security alerts unavailable" } },
    { status: 503, body: { detail: "Engine offline" } },
  ];
  await assert.rejects(
    async () => await getSecurityAlerts(),
    (err: any) => err instanceof ApiError && err.status === 503,
    "getSecurityAlerts must propagate ApiError when both backend and direct fail"
  );
  console.log("✔ Test 6: getSecurityAlerts propagates ApiError on service unavailable (never swallows into [])");

  // Test 7: getWatchlist - 200 empty array
  queue = [{ status: 200, body: [] }];
  const watchlistEmpty = await getWatchlist();
  assert.deepStrictEqual(watchlistEmpty, [], "getWatchlist must return [] on 200 with []");
  console.log("✔ Test 7: getWatchlist returns [] on 200 empty response");

  // Test 8: getWatchlist - network error propagation
  queue = [
    { networkError: "Network failure" },
    { networkError: "Network failure" },
  ];
  await assert.rejects(
    async () => await getWatchlist(),
    (err: any) => err instanceof ApiError,
    "getWatchlist must propagate ApiError when services are unreachable"
  );
  console.log("✔ Test 8: getWatchlist propagates ApiError on network failure");

  // Test 9: addWatchlistEntry - error propagation (never fakes success)
  queue = [
    { status: 503, body: { error: "UNAVAILABLE" } },
    { status: 503, body: { detail: "Engine offline" } },
  ];
  await assert.rejects(
    async () => await addWatchlistEntry({ plateNumber: "MH12XY9999", reason: "STOLEN", severity: "CRITICAL" }),
    (err: any) => err instanceof ApiError,
    "addWatchlistEntry must throw ApiError on failure, never return fake entry"
  );
  console.log("✔ Test 9: addWatchlistEntry throws ApiError on failure (no fabricated success)");

  // Test 10: predictTrajectory - error propagation
  queue = [
    { status: 503, body: { error: "UNAVAILABLE" } },
    { status: 503, body: { detail: "Predictor offline" } },
  ];
  await assert.rejects(
    async () => await predictTrajectory("GLOBAL-123"),
    (err: any) => err instanceof ApiError,
    "predictTrajectory must throw ApiError when service is down"
  );
  console.log("✔ Test 10: predictTrajectory throws ApiError when service is down");

  // Test 11: getVideoUploads - 200 returns paginated list
  const mockPage = {
    content: [
      {
        id: "d9c3a372-e1a5-4f47-bcf9-5f2122606820",
        originalFilename: "traffic.mp4",
        storageKey: "uploads/2026/11/04/traffic.mp4",
        storageProvider: "LOCAL",
        mimeType: "video/mp4",
        fileSize: 1048576,
        status: "UPLOADED",
        cameraId: "CAM-01",
        createdAt: "2026-11-04T05:00:00Z",
        updatedAt: "2026-11-04T05:00:00Z",
        failureReason: null,
        sha256Hash: "abcd1234",
      },
    ],
    totalElements: 1,
    totalPages: 1,
    size: 10,
    number: 0,
  };
  queue = [{ status: 200, body: mockPage }];
  const uploads = await getVideoUploads(0, 10);
  assert.strictEqual(uploads.content.length, 1);
  assert.strictEqual(uploads.content[0].originalFilename, "traffic.mp4");
  console.log("✔ Test 11: getVideoUploads returns paginated upload records on 200");

  // Test 12: getVideoUploads - 500 propagates ApiError
  queue = [{ status: 500, body: { message: "Database connection failed" } }];
  await assert.rejects(
    async () => await getVideoUploads(0, 10),
    (err: any) => err instanceof ApiError && err.status === 500,
    "getVideoUploads must throw ApiError on HTTP 500"
  );
  console.log("✔ Test 12: getVideoUploads propagates ApiError on HTTP 500");

  // Test 13: getVideoUpload - 200 returns record
  queue = [{ status: 200, body: mockPage.content[0] }];
  const single = await getVideoUpload("d9c3a372-e1a5-4f47-bcf9-5f2122606820");
  assert.strictEqual(single.id, "d9c3a372-e1a5-4f47-bcf9-5f2122606820");
  console.log("✔ Test 13: getVideoUpload returns single record on 200");

  // Test 14: getVideoUpload - 404 propagates ApiError
  queue = [{ status: 404, body: { message: "Video upload not found" } }];
  await assert.rejects(
    async () => await getVideoUpload("non-existent-uuid"),
    (err: any) => err instanceof ApiError && err.status === 404,
    "getVideoUpload must throw ApiError on HTTP 404"
  );
  console.log("✔ Test 14: getVideoUpload propagates ApiError on HTTP 404");

  // Test 15: deleteVideoUpload - 204 succeeds
  queue = [{ status: 204, body: null }];
  await deleteVideoUpload("d9c3a372-e1a5-4f47-bcf9-5f2122606820");
  console.log("✔ Test 15: deleteVideoUpload succeeds on HTTP 204");

  // Test 16: deleteVideoUpload - 404 propagates ApiError
  queue = [{ status: 404, body: { message: "Cannot delete non-existent video" } }];
  await assert.rejects(
    async () => await deleteVideoUpload("non-existent-uuid"),
    (err: any) => err instanceof ApiError && err.status === 404,
    "deleteVideoUpload must throw ApiError on HTTP 404"
  );
  console.log("✔ Test 16: deleteVideoUpload propagates ApiError on HTTP 404");

  // Test 17: uploadVideoToStorage - rejects empty file (0 bytes) before network
  const emptyFile = { name: "empty.mp4", size: 0 } as File;
  await assert.rejects(
    async () => await uploadVideoToStorage(emptyFile),
    (err: any) => err instanceof ApiError && err.status === 400 && err.message.includes("empty"),
    "uploadVideoToStorage must reject empty file with 400 ApiError"
  );
  console.log("✔ Test 17: uploadVideoToStorage rejects empty file (0 bytes) with 400 ApiError");

  // Test 18: uploadVideoToStorage - rejects oversized file (>500MB) before network
  const oversizedFile = { name: "huge.mp4", size: 501 * 1024 * 1024 } as File;
  await assert.rejects(
    async () => await uploadVideoToStorage(oversizedFile),
    (err: any) => err instanceof ApiError && err.status === 413 && err.message.includes("500 MB"),
    "uploadVideoToStorage must reject oversized file (>500MB) with 413 ApiError"
  );
  console.log("✔ Test 18: uploadVideoToStorage rejects oversized file (>500MB) with 413 ApiError");

  // Test 19: processVideoUpload - succeeds on HTTP 202
  queue = [{ status: 202, body: { status: "PROCESSING", job_id: "job-999" } }];
  const procRes = await processVideoUpload("198a7777-8f89-49d6-86f8-6451cf2e808e", { enableDehaze: false, frameStride: 5 });
  assert.strictEqual(procRes.status, "PROCESSING");
  assert.strictEqual(procRes.job_id, "job-999");
  console.log("✔ Test 19: processVideoUpload returns processing response on HTTP 202");

  // Test 20: getVideoDetections - returns paginated detections on 200
  queue = [{
    status: 200,
    body: {
      content: [{ id: 1, plateTextNormalized: "MH12AB1234", vehicleClass: "car", bbox: "0,0,10,10" }],
      totalElements: 1,
      totalPages: 1,
    }
  }];
  const detectionsPage = await getVideoDetections("198a7777-8f89-49d6-86f8-6451cf2e808e");
  assert.strictEqual(detectionsPage.content.length, 1);
  assert.strictEqual(detectionsPage.content[0].plateTextNormalized, "MH12AB1234");
  console.log("✔ Test 20: getVideoDetections returns paginated detections on HTTP 200");

  // Test 21: getVideoDetections - propagates ApiError on HTTP 404
  queue = [{ status: 404, body: { error: "NOT_FOUND", message: "Video not found" } }];
  await assert.rejects(
    async () => await getVideoDetections("non-existent-id"),
    (err: any) => err instanceof ApiError && err.status === 404,
    "getVideoDetections must throw ApiError on HTTP 404"
  );
  console.log("✔ Test 21: getVideoDetections propagates ApiError on HTTP 404");

  // =========================================================================
  // Focused API Client Bug-Fix Tests (Production URL, Abort, Path Normalization)
  // =========================================================================

  // Test 22: Path Normalization with Absolute Base URL
  const base8080 = "http://localhost:8080";
  assert.strictEqual(normalizeApiPath("/api", base8080), "http://localhost:8080/api", "normalize /api must produce /api");
  assert.strictEqual(normalizeApiPath("/api/", base8080), "http://localhost:8080/api/", "normalize /api/ must produce /api/");
  assert.strictEqual(normalizeApiPath("/api/videos", base8080), "http://localhost:8080/api/videos", "normalize /api/videos must produce /api/videos");
  assert.strictEqual(normalizeApiPath("/cameras", base8080), "http://localhost:8080/api/cameras", "normalize /cameras must prefix /api");
  assert.strictEqual(normalizeApiPath("/apiary", base8080), "http://localhost:8080/api/apiary", "normalize /apiary must preserve segment without stripping /api");
  assert.strictEqual(normalizeApiPath("/apiv2/videos", base8080), "http://localhost:8080/api/apiv2/videos", "normalize /apiv2/videos must preserve prefix without delimiter loss");
  assert.strictEqual(normalizeApiPath("cameras", base8080), "http://localhost:8080/api/cameras", "normalize cameras without leading slash must add slash");
  assert.strictEqual(normalizeApiPath("/cameras", "http://localhost:8080/"), "http://localhost:8080/api/cameras", "trailing slash on base must be trimmed");
  console.log("✔ Test 22: Path normalization correctly handles /api, /api/, /api/videos, /cameras, /apiary, /apiv2/videos, and cameras with absolute base");

  // Test 23: Path Normalization in Same-Origin / Reverse-Proxy Mode (Base URL = "")
  assert.strictEqual(normalizeApiPath("/api", ""), "/api", "normalize relative /api");
  assert.strictEqual(normalizeApiPath("/api/", ""), "/api/", "normalize relative /api/");
  assert.strictEqual(normalizeApiPath("/api/videos", ""), "/api/videos", "normalize relative /api/videos");
  assert.strictEqual(normalizeApiPath("/cameras", ""), "/api/cameras", "normalize relative /cameras");
  assert.strictEqual(normalizeApiPath("/apiary", ""), "/api/apiary", "normalize relative /apiary");
  assert.strictEqual(normalizeApiPath("/apiv2/videos", ""), "/api/apiv2/videos", "normalize relative /apiv2/videos");
  assert.strictEqual(normalizeApiPath("cameras", ""), "/api/cameras", "normalize relative cameras");
  console.log("✔ Test 23: Path normalization correctly produces clean relative paths when base URL is empty");

  // Save environment and window references
  const origEnvApiUrl = process.env.NEXT_PUBLIC_API_URL;
  const origEnvApiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const origEnvInternalUrl = process.env.INTERNAL_API_URL;
  const origWindow = (global as any).window;

  try {
    // Test 24: Production Browser Behavior (Both environment variables absent)
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;
    (global as any).window = { location: { hostname: "traffic.city.gov.in" } };

    const prodBrowserBase = getApiBaseUrl();
    assert.strictEqual(prodBrowserBase, "", "In deployed browser without env vars, getApiBaseUrl must return empty string (same-origin relative)");

    fetchHistory = [];
    queue = [{ status: 200, body: [] }];
    await getCameras();
    assert.strictEqual(fetchHistory.length, 1);
    assert.strictEqual(fetchHistory[0].url, "/api/cameras", "apiFetch in production browser must target same-origin relative path /api/cameras");
    assert.ok(!fetchHistory[0].url.startsWith("http://localhost:8080"), "must NEVER silently target http://localhost:8080 from deployed browser");
    console.log("✔ Test 24: Deployed browser without env vars targets relative /api/... and never localhost:8080");

    // Test 25: Localhost Browser Development Defaults
    (global as any).window = { location: { hostname: "localhost" } };
    assert.strictEqual(getApiBaseUrl(), "http://localhost:8080", "localhost hostname must default to http://localhost:8080");
    (global as any).window = { location: { hostname: "127.0.0.1" } };
    assert.strictEqual(getApiBaseUrl(), "http://localhost:8080", "127.0.0.1 hostname must default to http://localhost:8080");
    console.log("✔ Test 25: Localhost browser development default preserved as http://localhost:8080");

    // Test 26: Explicit Environment Variable Precedence
    process.env.NEXT_PUBLIC_API_URL = "https://primary-api.city.gov.in/";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://secondary-api.city.gov.in/";
    assert.strictEqual(
      getApiBaseUrl(),
      "https://primary-api.city.gov.in",
      "NEXT_PUBLIC_API_URL must take precedence over NEXT_PUBLIC_API_BASE_URL and trim trailing slash"
    );

    delete process.env.NEXT_PUBLIC_API_URL;
    assert.strictEqual(
      getApiBaseUrl(),
      "https://secondary-api.city.gov.in",
      "NEXT_PUBLIC_API_BASE_URL must be used when NEXT_PUBLIC_API_URL is absent"
    );
    console.log("✔ Test 26: Explicit environment variable precedence and trailing slash trimming verified");

    // Test 27: Deliberate SSR Behavior
    delete (global as any).window;
    delete process.env.NEXT_PUBLIC_API_URL;
    delete process.env.NEXT_PUBLIC_API_BASE_URL;

    process.env.INTERNAL_API_URL = "http://backend-internal:8080/";
    assert.strictEqual(
      getApiBaseUrl(),
      "http://backend-internal:8080",
      "INTERNAL_API_URL must be respected in SSR environment"
    );

    delete process.env.INTERNAL_API_URL;
    assert.strictEqual(
      getApiBaseUrl(),
      "http://localhost:8080",
      "SSR without environment variables must provide absolute URL with authority to prevent Node fetch URL parse failures"
    );
    console.log("✔ Test 27: Deliberate SSR behavior verified with absolute URL authority");
  } finally {
    // Restore environment and window
    if (origEnvApiUrl !== undefined) process.env.NEXT_PUBLIC_API_URL = origEnvApiUrl;
    else delete process.env.NEXT_PUBLIC_API_URL;

    if (origEnvApiBaseUrl !== undefined) process.env.NEXT_PUBLIC_API_BASE_URL = origEnvApiBaseUrl;
    else delete process.env.NEXT_PUBLIC_API_BASE_URL;

    if (origEnvInternalUrl !== undefined) process.env.INTERNAL_API_URL = origEnvInternalUrl;
    else delete process.env.INTERNAL_API_URL;

    if (origWindow !== undefined) (global as any).window = origWindow;
    else delete (global as any).window;
  }

  // Test 28: Cancellation Prevents Fallback GET Requests (predictTrajectory)
  const getController = new AbortController();
  getController.abort(); // Pre-abort signal

  fetchHistory = [];
  queue = []; // No mock responses queued; if a second fetch is attempted, it throws "Unexpected fetch call"
  await assert.rejects(
    async () => await predictTrajectory("GLOBAL-CANCEL-001", { signal: getController.signal }),
    (err: any) => err instanceof Error && err.name === "AbortError",
    "predictTrajectory must reject immediately with AbortError when signal is cancelled"
  );
  assert.strictEqual(fetchHistory.length, 1, "Only initial primary fetch was initiated; AI fallback must NEVER be called");
  assert.ok(fetchHistory[0].signalAborted, "Signal abortion flag was detected on primary fetch");
  console.log("✔ Test 28: Cancellation in predictTrajectory immediately rethrows AbortError and never invokes AI fallback");

  // Test 29: Cancellation Prevents Fallback POST Requests (addWatchlistEntry)
  const postController = new AbortController();
  postController.abort(); // Pre-abort signal

  fetchHistory = [];
  queue = [];
  await assert.rejects(
    async () => await addWatchlistEntry(
      { plateNumber: "MH12AB9999", reason: "STOLEN_PROBE", severity: "HIGH" },
      { signal: postController.signal }
    ),
    (err: any) => err instanceof Error && err.name === "AbortError",
    "addWatchlistEntry must reject immediately with AbortError on cancellation"
  );
  assert.strictEqual(fetchHistory.length, 1, "Cancelled POST must NEVER trigger a second fallback POST");
  assert.ok(fetchHistory[0].signalAborted, "Signal abortion flag was detected on primary POST");
  console.log("✔ Test 29: Cancellation in addWatchlistEntry immediately rethrows AbortError; cancelled POST never triggers second POST");

  // Test 30: Client 4xx Error Does Not Duplicate POST Mutation
  fetchHistory = [];
  queue = [{ status: 400, body: { message: "Invalid plate syntax" } }];
  await assert.rejects(
    async () => await addWatchlistEntry(
      { plateNumber: "INVALID_SYNTAX", reason: "BAD_INPUT", severity: "LOW" }
    ),
    (err: any) => err instanceof ApiError && err.status === 400 && err.message.includes("Invalid plate syntax"),
    "addWatchlistEntry must propagate 400 ApiError without secondary mutation"
  );
  assert.strictEqual(fetchHistory.length, 1, "Client-side 4xx rejection must not duplicate mutation to fallback service");
  console.log("✔ Test 30: Client 4xx error rejects cleanly without duplicating mutation to secondary service");

  console.log("\n==========================================================");
  console.log(" ALL 30 FRONTEND API CONTRACT & CLIENT ACCEPTANCE TESTS PASSED! ");
  console.log("==========================================================");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});

