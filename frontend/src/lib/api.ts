/**
 * Typed fetch wrapper for the Node.js backend and AI service APIs.
 * Data and empty states are returned from the configured services; failures are surfaced to callers.
 */

export function getApiBaseUrl(): string {
  // Server-side rendering and route handlers must use Docker/service DNS when configured.
  // NEXT_PUBLIC_* values are inlined at build time and point to the browser-facing host.
  if (typeof window === "undefined") {
    if (process.env.INTERNAL_API_URL) {
      return process.env.INTERNAL_API_URL.replace(/\/+$/, "");
    }
    if (process.env.API_URL) {
      return process.env.API_URL.replace(/\/+$/, "");
    }
  }

  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, "");
  }
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL.replace(/\/+$/, "");
  }

  // Browser runtime
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return "http://127.0.0.1:8080";
    }
    // Deployed browser on non-localhost without explicit env vars:
    // Support relative /api/... requests routed through a same-origin reverse proxy.
    // Do not silently target http://localhost:8080 on the client workstation.
    return "";
  }

  // Server-side rendering fallback for local development. Node fetch requires an absolute URL.
  return "http://127.0.0.1:8080";
}

export function getAiServiceBaseUrl(): string {
  // Server-side rendering must reach the AI service over Docker's internal network.
  if (typeof window === "undefined" && process.env.INTERNAL_AI_URL) {
    return process.env.INTERNAL_AI_URL.replace(/\/+$/, "");
  }

  if (process.env.NEXT_PUBLIC_AI_SERVICE_URL) {
    return process.env.NEXT_PUBLIC_AI_SERVICE_URL.replace(/\/+$/, "");
  }
  if (process.env.NEXT_PUBLIC_AI_URL) {
    return process.env.NEXT_PUBLIC_AI_URL.replace(/\/+$/, "");
  }

  // Browser runtime
  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
      return "http://127.0.0.1:8000";
    }
    return "";
  }

  // Server-side rendering local-development fallback.
  return "http://127.0.0.1:8000";
}

export const API_BASE_URL = getApiBaseUrl();
export const AI_SERVICE_BASE_URL = getAiServiceBaseUrl();

export interface HealthResponse {
  status: string;
  service: string;
  version: string;
  timestamp: string;
  redisStatus?: "UP" | "STANDALONE_FALLBACK" | "DOWN" | string;
  redisLatencyMs?: number | null;
}

export interface ReadinessResponse {
  status: "ready" | "not_ready" | string;
  service: string;
  timestamp: string;
  dependencies: {
    database: "UP" | "DOWN" | string;
    redis: "UP" | "DEGRADED" | "DOWN" | string;
  };
}

export async function getReadiness(options?: { signal?: AbortSignal }): Promise<ReadinessResponse> {
  return apiFetch<ReadinessResponse>("/ready", { signal: options?.signal });
}

export interface CameraDto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  direction: string | null;
  status: "ONLINE" | "PROCESSING" | "OFFLINE" | string;
  videoSource?: string | null;
  sourceType?: "PUBLIC_CATALOG" | "GOVERNMENT_API" | "LEGACY" | string | null;
  sourceNetwork?: string | null;
  sourceName?: string | null;
  sourceCameraId?: string | null;
  feedType?: string | null;
  streamUrl?: string | null;
  archiveUrl?: string | null;
  pageUrl?: string | null;
  attribution?: string | null;
  countryCode?: string | null;
  region?: string | null;
  place?: string | null;
  liveVideo?: boolean;
  liveSnapshot?: boolean;
  archiveAvailable?: boolean;
  externalPlayer?: boolean;
  sourceStatus?: string | null;
  sourceLastSeenAt?: string | null;
}

export interface CameraSourceDto {
  id: string;
  sourceKey: string;
  name: string;
  sourceType: "PUBLIC_CATALOG" | "GOVERNMENT_API";
  adapter: "GODSEYE_GEOJSON" | "GEOJSON" | "JSON_API";
  endpointUrl: string;
  countryScope: string;
  attribution: string | null;
  enabled: boolean;
  authType: string;
  hasCredentials: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string;
  lastSyncError: string | null;
  importedCount: number;
  createdAt: string;
  updatedAt: string;
}


export interface VehicleDto {
  plate: string;
  vehicleType: string | null;
  color: string | null;
  make: string | null;
  model: string | null;
}

export interface VehicleSummaryDto {
  vehicle: VehicleDto;
  firstSeen: string | null;
  lastSeen: string | null;
  cameraCount: number;
  camerasVisited: string[];
  detectionCount: number;
}

export interface VehicleDetectionDto {
  id: number;
  cameraId: string;
  cameraName: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  direction: string | null;
  speedKmh: number | null;
  vehicleClass: string | null;
  detectionConfidence: number | null;
  plateTextRaw: string | null;
  plateTextNormalized: string | null;
  plateConfidence: number | null;
  reidConfidence: number | null;
  imagePath: string | null;
  trackId: number | null;
  frameNumber: number | null;
}

export interface TrajectoryPointDto {
  cameraId: string;
  cameraName: string;
  latitude: number;
  longitude: number;
  direction: string | null;
  timestamp: string;
  plateConfidence: number | null;
  detectionConfidence: number | null;
  imagePath: string | null;
  detectionCount: number;
  incomingTransitionConfidence: number | null;
  transitionNote: string | null;
}

export interface TrajectoryResponseDto {
  vehicle: VehicleDto;
  points: TrajectoryPointDto[];
  overallConfidence: number | null;
  estimatedDistanceKm: number;
  estimatedDurationMinutes: number;
  warning: string | null;
}

export interface AnalyticsOverviewDto {
  totalCameras: number;
  camerasOnline: number;
  camerasProcessing: number;
  camerasOffline: number;
  totalVehicles: number;
  totalDetections: number;
  vehicleTypeDistribution: { vehicleType: string; count: number }[];
  detectionsByHour: { hour: number; count: number }[];
  busiestCameras: { cameraId: string; cameraName: string; count: number }[];
  averageTransitionSpeedKmh: number | null;
  averageObservedSpeedKmh?: number | null;
  commonOrigins: { cameraId: string; cameraName: string; count: number }[];
  commonDestinations: { cameraId: string; cameraName: string; count: number }[];
  topRoutes: {
    fromCameraId: string;
    fromCameraName: string;
    toCameraId: string;
    toCameraName: string;
    count: number;
  }[];
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }
}

/**
 * Normalizes an API route path against a base URL:
 * - Strips leading '/api' only when it constitutes a complete path segment ('/api' or '/api/...').
 * - Restores missing leading slashes (e.g. 'cameras' -> '/cameras').
 * - Preserves non-segment prefixes like '/apiary' or '/apiv2/videos'.
 * - Avoids double slashes or duplicated '/api/api' prefixes.
 */
export function normalizeApiPath(path: string, baseUrl: string = getApiBaseUrl()): string {
  const cleanBase = baseUrl ? baseUrl.replace(/\/+$/, "") : "";
  if (!path || path === "/" || path === "/api") {
    return cleanBase ? `${cleanBase}/api` : "/api";
  }
  if (path === "/api/") {
    return cleanBase ? `${cleanBase}/api/` : "/api/";
  }

  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;

  let subPath: string;
  if (withLeadingSlash.startsWith("/api/")) {
    subPath = withLeadingSlash.substring(4); // e.g. "/api/videos" -> "/videos"
  } else {
    subPath = withLeadingSlash; // e.g. "/cameras", "/apiary", "/apiv2/videos"
  }

  return cleanBase ? `${cleanBase}/api${subPath}` : `/api${subPath}`;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = normalizeApiPath(path);

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    throw new ApiError(`Unable to reach backend at ${url}`);
  }

  if (!response.ok) {
    let message = `Request to ${path} failed`;
    try {
      const body = await response.json();
      if (body?.message) message = body.message;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(message, response.status);
  }

  return (await response.json()) as T;
}

export async function getHealth(options?: { signal?: AbortSignal }): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health", { signal: options?.signal });
}

export async function getCameras(options?: {
  signal?: AbortSignal;
  mode?: "all" | "live" | "historic" | "hybrid";
  bbox?: { west: number; south: number; east: number; north: number };
}): Promise<CameraDto[]> {
  const params = new URLSearchParams();
  if (options?.mode && options.mode !== "all") params.set("mode", options.mode);
  if (options?.bbox) {
    const { west, south, east, north } = options.bbox;
    params.set("bbox", [west, south, east, north].join(","));
  }
  const query = params.size ? "?" + params.toString() : "";
  const cams = await apiFetch<CameraDto[]>("/cameras" + query, { signal: options?.signal });
  if (!Array.isArray(cams)) {
    throw new ApiError("Malformed response: cameras must be an array");
  }
  return cams;
}

export interface CreateCameraSourceInput {
  name: string;
  sourceKey?: string;
  sourceType: "PUBLIC_CATALOG" | "GOVERNMENT_API";
  adapter: "GEOJSON" | "JSON_API";
  endpointUrl: string;
  attribution?: string;
  completeSnapshot?: boolean;
  authType?: "NONE" | "BEARER" | "API_KEY_HEADER" | "API_KEY_QUERY";
  authValue?: string;
  authHeaderName?: string;
  authQueryName?: string;
  itemsPath?: string;
  mapping?: {
    id?: string;
    name?: string;
    latitude?: string;
    longitude?: string;
    streamUrl?: string;
    archiveUrl?: string;
    feedType?: string;
    countryCode?: string;
    pageUrl?: string;
  };
}

export interface CameraSourceSyncResult {
  sourceId: string;
  sourceKey: string;
  status: string;
  importedCount: number;
  staleCount: number;
  staleMarking: "APPLIED_COMPLETE_SNAPSHOT" | "SKIPPED_NON_AUTHORITATIVE_SNAPSHOT";
  upstreamRecords: number;
  skipped: Record<string, number>;
  syncedAt: string;
}

export interface QuickCameraSourceImportResult extends CameraSourceSyncResult {
  source: Pick<CameraSourceDto, "id" | "sourceKey" | "name" | "sourceType" | "adapter" | "endpointUrl" | "countryScope" | "enabled" | "lastSyncStatus"> | null;
  alreadyRegistered: boolean;
}

export interface CameraDiscoveryCandidate extends CameraDto {
  geodesicDistanceMeters: number;
  routeRelation: "VERIFIED_ROUTE_NETWORK" | "NEARBY_ALTERNATIVE_UNVERIFIED";
  processingCapability: "FEED_METADATA_ONLY" | "EXTERNAL_PLAYER_ONLY";
  investigationStage: "PRIMARY_VERIFIED_ROUTE" | "FALLBACK_NEARBY";
  estimatedArrivalWindowSeconds: { minimum: number; maximum: number } | null;
  priority: "ROUTE_FIRST" | "FALLBACK_REVIEW";
}

export async function listCameraSources(options?: { signal?: AbortSignal }): Promise<CameraSourceDto[]> {
  return apiFetch<CameraSourceDto[]>("/camera-sources", { signal: options?.signal });
}

export async function quickImportCameraSource(
  endpointUrl: string,
  adminToken?: string
): Promise<QuickCameraSourceImportResult> {
  return apiFetch<QuickCameraSourceImportResult>("/camera-sources/quick-import", {
    method: "POST",
    headers: adminToken ? { "x-admin-token": adminToken } : undefined,
    body: JSON.stringify({ endpointUrl }),
  });
}

export async function createCameraSource(input: CreateCameraSourceInput, adminToken?: string): Promise<CameraSourceDto> {
  return apiFetch<CameraSourceDto>("/camera-sources", {
    method: "POST",
    headers: adminToken ? { "x-admin-token": adminToken } : undefined,
    body: JSON.stringify(input),
  });
}

export async function syncCameraSource(id: string, adminToken?: string): Promise<CameraSourceSyncResult> {
  return apiFetch<CameraSourceSyncResult>("/camera-sources/" + encodeURIComponent(id) + "/sync", {
    method: "POST",
    headers: adminToken ? { "x-admin-token": adminToken } : undefined,
  });
}

export async function setCameraSourceEnabled(id: string, enabled: boolean, adminToken?: string): Promise<{ id: string; enabled: boolean }> {
  return apiFetch<{ id: string; enabled: boolean }>("/camera-sources/" + encodeURIComponent(id), {
    method: "PATCH",
    headers: adminToken ? { "x-admin-token": adminToken } : undefined,
    body: JSON.stringify({ enabled }),
  });
}

export async function discoverCaseCameraCandidates(
  investigationId: string,
  detectionId: number,
  radiusKm: number = 10
): Promise<{
  investigationId: string;
  seedDetectionId: number;
  seedCameraId: string;
  observedAt: string;
  radiusKm: number;
  candidateStages: {
    primary: { name: "PRIMARY_VERIFIED_ROUTE"; candidateCount: number };
    fallback: { name: "FALLBACK_NEARBY"; candidateCount: number };
    expansionPolicy: string;
  };
  candidates: CameraDiscoveryCandidate[];
  warnings: string[];
}> {
  return apiFetch("/investigations/" + encodeURIComponent(investigationId) + "/camera-candidates", {
    method: "POST",
    body: JSON.stringify({ detectionId, radiusKm }),
  });
}

export async function getRecentVehicles(options?: { signal?: AbortSignal }): Promise<VehicleDto[]> {
  const list = await apiFetch<VehicleDto[]>("/vehicles/recent", { signal: options?.signal });
  if (!Array.isArray(list)) {
    throw new ApiError("Malformed response: recent vehicles must be an array");
  }
  return list;
}

export async function getVehicleSummary(plate: string, options?: { signal?: AbortSignal }): Promise<VehicleSummaryDto> {
  return apiFetch<VehicleSummaryDto>(`/vehicles/${encodeURIComponent(plate)}`, { signal: options?.signal });
}

export async function getVehicleDetections(plate: string, options?: { signal?: AbortSignal }): Promise<VehicleDetectionDto[]> {
  return apiFetch<VehicleDetectionDto[]>(`/vehicles/${encodeURIComponent(plate)}/detections`, { signal: options?.signal });
}

export async function getVehicleTrajectory(plate: string, options?: { signal?: AbortSignal }): Promise<TrajectoryResponseDto> {
  return apiFetch<TrajectoryResponseDto>(`/vehicles/${encodeURIComponent(plate)}/trajectory`, { signal: options?.signal });
}

export async function getAnalyticsOverview(options?: { signal?: AbortSignal }): Promise<AnalyticsOverviewDto> {
  return apiFetch<AnalyticsOverviewDto>("/analytics/overview", { signal: options?.signal });
}

export function evidenceImageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}/evidence/${imagePath}` : `/evidence/${imagePath}`;
}

export function cameraVideoUrl(cameraId: string | null | undefined): string | null {
  if (!cameraId) return null;
  const normalized = cameraId.toUpperCase().trim();
  return `/videos/${normalized}.mp4`;
}

export interface TrajectoryCandidateDto {
  nextCameraId: string;
  nextCameraName: string;
  probability: number;
  estimatedTravelSeconds: number;
  estimatedArrivalIso?: string;
}

export interface SecurityAlertDto {
  alertId: string;
  alertType: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" | "UNKNOWN";
  plateNumber: string;
  globalId?: string;
  cameraId: string;
  timestamp: number | null;
  description: string;
}

interface RawCandidateItem {
  nextCameraId?: string;
  next_camera_id?: string;
  nextCameraName?: string;
  next_camera_name?: string;
  probability?: number;
  estimatedTravelSeconds?: number;
  estimated_travel_seconds?: number;
  estimatedArrivalIso?: string;
  estimated_arrival_timestamp?: number;
}

interface RawTrajectoryResponse {
  candidates?: RawCandidateItem[];
}

interface RawSecurityAlertItem {
  alertId?: string;
  alert_id?: string;
  alertType?: string;
  alert_type?: string;
  severity?: string;
  plateNumber?: string;
  plate_number?: string;
  globalId?: string;
  global_id?: string;
  cameraId?: string;
  camera_id?: string;
  timestamp?: number | string | null;
  description?: string;
}

interface RawWatchlistItem {
  plateNumber?: string;
  plate_number?: string;
  reason?: string;
  severity?: string;
}

interface RawProcessVideoResponse {
  framesProcessed?: number;
  frames_processed?: number;
  detectionsCount?: number;
  detections?: unknown[];
}

export async function predictTrajectory(
  globalId: string,
  options?: { signal?: AbortSignal }
): Promise<TrajectoryCandidateDto[]> {
  let rawList: RawCandidateItem[] | null = null;
  let lastError: Error | null = null;

  try {
    const res = await apiFetch<RawTrajectoryResponse | RawCandidateItem[]>(
      `/predict-trajectory/${encodeURIComponent(globalId)}`,
      { signal: options?.signal }
    );
    rawList = Array.isArray(res) ? res : (res?.candidates ?? []);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    lastError = err instanceof Error ? err : new Error(String(err));
    try {
      const aiBase = getAiServiceBaseUrl();
      const aiUrl = aiBase
        ? `${aiBase}/predict-trajectory/${encodeURIComponent(globalId)}`
        : `/predict-trajectory/${encodeURIComponent(globalId)}`;
      const res = await fetch(aiUrl, {
        signal: options?.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as RawTrajectoryResponse | RawCandidateItem[];
        rawList = Array.isArray(data) ? data : (data?.candidates ?? []);
      } else {
        throw new ApiError(`AI predict-trajectory failed with HTTP ${res.status}`, res.status);
      }
    } catch (aiErr) {
      if (aiErr instanceof Error && aiErr.name === "AbortError") {
        throw aiErr;
      }
      throw aiErr instanceof ApiError
        ? aiErr
        : (lastError instanceof ApiError ? lastError : new ApiError("Trajectory prediction service unavailable"));
    }
  }

  if (rawList === null || !Array.isArray(rawList)) {
    throw new ApiError("Malformed response from trajectory prediction service");
  }

  return rawList.map((c: RawCandidateItem) => ({
    nextCameraId: c.nextCameraId ?? c.next_camera_id ?? "CAM-UNKNOWN",
    nextCameraName: c.nextCameraName ?? c.next_camera_name ?? "Next Junction",
    probability: c.probability ?? 0,
    estimatedTravelSeconds: c.estimatedTravelSeconds ?? c.estimated_travel_seconds ?? 0,
    estimatedArrivalIso:
      c.estimatedArrivalIso ??
      (c.estimated_arrival_timestamp
        ? new Date(c.estimated_arrival_timestamp * 1000).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })
        : undefined),
  }));
}

export async function getSecurityAlerts(options?: { signal?: AbortSignal }): Promise<SecurityAlertDto[]> {
  let rawList: RawSecurityAlertItem[] | null = null;
  let lastError: Error | null = null;

  try {
    const alerts = await apiFetch<RawSecurityAlertItem[]>("/security-alerts", {
      signal: options?.signal,
    });
    if (Array.isArray(alerts)) {
      rawList = alerts;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    lastError = err instanceof Error ? err : new Error(String(err));
    try {
      const aiBase = getAiServiceBaseUrl();
      const aiUrl = aiBase ? `${aiBase}/security-alerts` : `/security-alerts`;
      const res = await fetch(aiUrl, {
        signal: options?.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as RawSecurityAlertItem[];
        if (Array.isArray(data)) {
          rawList = data;
        }
      } else {
        throw new ApiError(`AI security-alerts failed with HTTP ${res.status}`, res.status);
      }
    } catch (aiErr) {
      if (aiErr instanceof Error && aiErr.name === "AbortError") {
        throw aiErr;
      }
      throw aiErr instanceof ApiError
        ? aiErr
        : (lastError instanceof ApiError ? lastError : new ApiError("Security alerts service unavailable"));
    }
  }

  if (rawList === null || !Array.isArray(rawList)) {
    throw new ApiError("Malformed response: security alerts must be an array");
  }

  return rawList.map((a: RawSecurityAlertItem, index: number) => {
    const rawTimestamp = a.timestamp;
    const parsedTimestamp = typeof rawTimestamp === "number"
      ? (Number.isFinite(rawTimestamp) ? rawTimestamp : null)
      : typeof rawTimestamp === "string" && rawTimestamp.trim() && Number.isFinite(Date.parse(rawTimestamp))
        ? Date.parse(rawTimestamp) / 1000
        : null;
    return {
      // This is a presentation key only; it is not a persisted alert ID.
      alertId: a.alertId ?? a.alert_id ?? `UNIDENTIFIED-${index + 1}`,
      alertType: a.alertType ?? a.alert_type ?? "UNKNOWN",
      severity: (a.severity?.toUpperCase() ?? "UNKNOWN") as SecurityAlertDto["severity"],
      plateNumber: a.plateNumber ?? a.plate_number ?? "UNKNOWN",
      globalId: a.globalId ?? a.global_id,
      cameraId: a.cameraId ?? a.camera_id ?? "UNKNOWN",
      timestamp: parsedTimestamp,
      description: a.description ?? "",
    };
  });
}

export async function getWatchlist(options?: { signal?: AbortSignal }): Promise<{ plateNumber: string; reason: string; severity: string }[]> {
  let rawList: RawWatchlistItem[] | null = null;
  let lastError: Error | null = null;

  try {
    const list = await apiFetch<RawWatchlistItem[]>("/watchlist", {
      signal: options?.signal,
    });
    if (Array.isArray(list)) {
      rawList = list;
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    lastError = err instanceof Error ? err : new Error(String(err));
    try {
      const aiBase = getAiServiceBaseUrl();
      const aiUrl = aiBase ? `${aiBase}/watchlist` : `/watchlist`;
      const res = await fetch(aiUrl, {
        signal: options?.signal,
      });
      if (res.ok) {
        const data = (await res.json()) as RawWatchlistItem[];
        if (Array.isArray(data)) {
          rawList = data;
        }
      } else {
        throw new ApiError(`AI watchlist failed with HTTP ${res.status}`, res.status);
      }
    } catch (aiErr) {
      if (aiErr instanceof Error && aiErr.name === "AbortError") {
        throw aiErr;
      }
      throw aiErr instanceof ApiError
        ? aiErr
        : (lastError instanceof ApiError ? lastError : new ApiError("Watchlist service unavailable"));
    }
  }

  if (rawList === null || !Array.isArray(rawList)) {
    throw new ApiError("Malformed response: watchlist must be an array");
  }

  return rawList.map((w: RawWatchlistItem) => ({
    plateNumber: w.plateNumber ?? w.plate_number ?? "",
    reason: w.reason ?? "",
    severity: w.severity ?? "UNKNOWN",
  }));
}

export async function addWatchlistEntry(
  entry: {
    plateNumber: string;
    reason: string;
    severity: string;
    ownerName?: string;
  },
  options?: { signal?: AbortSignal }
): Promise<{ plateNumber: string; reason: string; severity: string }> {
  const payload = {
    plateNumber: entry.plateNumber,
    plate_number: entry.plateNumber,
    reason: entry.reason,
    severity: entry.severity,
    ownerName: entry.ownerName,
    owner_name: entry.ownerName,
  };

  const res = await apiFetch<RawWatchlistItem>("/watchlist", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: options?.signal,
  });
  return {
    plateNumber: res.plateNumber ?? res.plate_number ?? entry.plateNumber,
    reason: res.reason ?? entry.reason,
    severity: res.severity ?? entry.severity,
  };
}

export interface IngestionJobStatusDto {
  job_id: string;
  status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED";
  progress: number;
  updated_at?: number;
  details?: {
    camera_id?: string;
    video_path?: string;
    frames_processed?: number;
    total_frames?: number;
    detections_count?: number;
    tracks_count?: number;
    active_tracks?: number;
    recognized_plates?: string[];
    synced_to_backend?: number;
    dcp_enabled?: boolean;
    dcp_applied?: boolean;
    models_executed?: string[];
    models_skipped?: string[];
    duration_seconds?: number;
    fps?: number;
    error?: string;
  };
}

export async function uploadVideoFile(
  file: File,
  cameraId: string,
  enableDehaze: boolean = false,
  startTime?: string
): Promise<{ jobId: string; status: string; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("camera_id", cameraId);
  formData.append("enable_dehaze", String(enableDehaze));
  // A file's last-modified time is not proof of capture time. Send an anchor
  // only when the caller has an authoritative capture timestamp.
  if (startTime) {
    formData.append("start_time", startTime);
  }

  const res = await fetch(`${AI_SERVICE_BASE_URL}/upload-video`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new ApiError(errData.detail || `Upload failed with HTTP ${res.status}`, res.status);
  }

  const data = await res.json();
  return {
    jobId: data.job_id,
    status: data.status,
    message: data.message,
  };
}

export async function ingestCameraFootage(
  cameraId: string,
  enableDehaze: boolean = false
): Promise<{ jobId: string; status: string; message: string }> {
  const res = await fetch(
    `${AI_SERVICE_BASE_URL}/ingest-camera/${encodeURIComponent(cameraId)}?enable_dehaze=${enableDehaze}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }
  );

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new ApiError(errData.detail || `Camera ingestion failed with HTTP ${res.status}`, res.status);
  }

  const data = await res.json();
  return {
    jobId: data.job_id,
    status: data.status,
    message: data.message,
  };
}

export async function getIngestionJobStatus(jobId: string): Promise<IngestionJobStatusDto> {
  const baseUrl = AI_SERVICE_BASE_URL;
  if (baseUrl) {
    try {
      const res = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      if (res.ok) {
        return (await res.json()) as IngestionJobStatusDto;
      }
    } catch {
      // Fallback to backend proxy
    }
  }
  return apiFetch<IngestionJobStatusDto>(`/api/jobs/${encodeURIComponent(jobId)}`);
}

export async function processVideoFeed(
  videoPath: string,
  cameraId: string,
  startTime?: string,
): Promise<{ cameraId: string; videoPath: string; framesProcessed: number; detectionsCount: number }> {
  // The recording anchor is only sent when actually known. Fabricating a fixed
  // start_time here would bake false capture timestamps into persisted detections.
  const payload: Record<string, unknown> = {
    videoPath,
    video_path: videoPath,
    cameraId,
    camera_id: cameraId,
  };
  if (startTime) {
    payload.startTime = startTime;
    payload.start_time = startTime;
  }

  try {
    const res = await apiFetch<RawProcessVideoResponse>("/process-video", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      cameraId,
      videoPath,
      framesProcessed: res.framesProcessed ?? res.frames_processed ?? 0,
      detectionsCount: res.detectionsCount ?? (Array.isArray(res.detections) ? res.detections.length : 0),
    };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw err;
    }
    const aiBase = getAiServiceBaseUrl();
    const aiUrl = aiBase ? `${aiBase}/process-video` : `/process-video`;
    const res = await fetch(aiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) {
      const data = (await res.json()) as RawProcessVideoResponse;
      return {
        cameraId,
        videoPath,
        framesProcessed: data.frames_processed ?? data.framesProcessed ?? 0,
        detectionsCount: Array.isArray(data.detections) ? data.detections.length : 0,
      };
    }
    throw new ApiError(`Video processing microservice failed with HTTP ${res.status}`, res.status);
  }
}

export interface VideoUploadRecord {
  id: string;
  originalFilename: string;
  storageKey: string;
  storageProvider: string;
  mimeType: string;
  fileSize: number;
  status: "UPLOADING" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED" | string;
  cameraId?: string | null;
  createdAt: string;
  updatedAt: string;
  failureReason?: string | null;
  sha256Hash?: string | null;
  framesProcessed?: number | null;
  detectionsCount?: number | null;
  processingDurationSec?: number | null;
}

export interface VideoUploadPage {
  content: VideoUploadRecord[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

/**
 * Uploads a recorded video file to the persistent backend storage pipeline.
 * Uses XMLHttpRequest to provide real, measured byte transfer progress.
 */
export function uploadVideoToStorage(
  file: File,
  cameraId?: string,
  onProgress?: (percent: number, loaded: number, total: number) => void
): Promise<VideoUploadRecord> {
  return new Promise((resolve, reject) => {
    if (!file || file.size === 0) {
      return reject(new ApiError("Selected video file is empty (0 bytes).", 400));
    }
    const maxBytes = 500 * 1024 * 1024; // 500MB
    if (file.size > maxBytes) {
      return reject(
        new ApiError(
          `File size (${(file.size / (1024 * 1024)).toFixed(1)} MB) exceeds the maximum allowed 500 MB limit.`,
          413
        )
      );
    }

    const baseUrl = getApiBaseUrl();
    const xhr = new XMLHttpRequest();
    const url = normalizeApiPath("/videos/upload", baseUrl);
    xhr.open("POST", url, true);

    if (onProgress) {
      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable && event.total > 0) {
          const percent = Math.min(100, Math.round((event.loaded / event.total) * 100));
          onProgress(percent, event.loaded, event.total);
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const parsed = JSON.parse(xhr.responseText) as VideoUploadRecord;
          resolve(parsed);
        } catch {
          reject(new ApiError("Invalid JSON received from storage backend.", 500));
        }
      } else {
        try {
          const errData = JSON.parse(xhr.responseText);
          reject(new ApiError(errData.message || `Upload failed with HTTP ${xhr.status}`, xhr.status));
        } catch {
          reject(new ApiError(`Upload failed with HTTP ${xhr.status}: ${xhr.statusText}`, xhr.status));
        }
      }
    };

    xhr.onerror = () => {
      reject(new ApiError(`Network error: Unable to connect to backend upload service at ${url}`, 0));
    };

    xhr.ontimeout = () => {
      reject(new ApiError("Upload request timed out.", 408));
    };

    const formData = new FormData();
    formData.append("file", file);
    if (cameraId && cameraId.trim().length > 0) {
      formData.append("camera_id", cameraId.trim());
    }

    xhr.send(formData);
  });
}

/**
 * Retrieves paginated upload records from the persistent backend database.
 */
export async function getVideoUploads(
  page: number = 0,
  size: number = 10,
  status?: string,
  cameraId?: string
): Promise<VideoUploadPage> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });
  if (status && status.trim().length > 0) {
    params.set("status", status.trim().toUpperCase());
  }
  if (cameraId && cameraId.trim().length > 0) {
    params.set("camera_id", cameraId.trim());
  }

  return apiFetch<VideoUploadPage>(`/api/videos?${params.toString()}`);
}

/**
 * Retrieves metadata for a specific uploaded video.
 */
export async function getVideoUpload(id: string): Promise<VideoUploadRecord> {
  return apiFetch<VideoUploadRecord>(`/api/videos/${encodeURIComponent(id)}`);
}

/**
 * Deletes an uploaded video and its associated storage file.
 */
export async function deleteVideoUpload(id: string): Promise<void> {
  await apiFetch<void>(`/api/videos/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export interface ProcessVideoUploadResponse {
  video_upload_id: string;
  processing_run_id?: string;
  run_id?: string;
  run_number?: number;
  generation?: number;
  status: string;
  job_id: string;
  camera_id?: string;
  is_created?: boolean;
  idempotent?: boolean;
  message: string;
}

// ----------------------------------------------------------------------------
// Stable Client Attempt Token Management (Priority 1)
// ----------------------------------------------------------------------------

interface AttemptTokenState {
  token: string;
  configKey: string;
  createdAt: number;
}

const activeAttemptTokens = new Map<string, AttemptTokenState>();

function computeAttemptConfigKey(options?: { enableDehaze?: boolean; frameStride?: number }): string {
  const dehaze = options?.enableDehaze ?? false;
  const stride = options?.frameStride ?? 5;
  return `dehaze=${dehaze};stride=${stride}`;
}

/**
 * Returns a stable clientRunToken for a video processing attempt.
 * - Reuses the exact same token for retries of the same attempt with identical config.
 * - Generates a new token only for a new intentional attempt (e.g. config changed or reprocess=true).
 */
export function getOrCreateClientRunToken(
  uploadId: string,
  options?: {
    enableDehaze?: boolean;
    frameStride?: number;
    reprocess?: boolean;
  }
): string {
  if (!uploadId) {
    return `ui_attempt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
  const configKey = computeAttemptConfigKey(options);
  const isReprocess = options?.reprocess ?? false;
  const existing = activeAttemptTokens.get(uploadId);

  if (!existing || isReprocess || existing.configKey !== configKey) {
    const newToken = `ui_${uploadId}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    activeAttemptTokens.set(uploadId, {
      token: newToken,
      configKey,
      createdAt: Date.now(),
    });
    return newToken;
  }

  return existing.token;
}

export function clearClientRunToken(uploadId: string): void {
  activeAttemptTokens.delete(uploadId);
}

export function resetAllClientRunTokens(): void {
  activeAttemptTokens.clear();
}

export interface DetectionRecord {
  id: number;
  cameraId: string;
  cameraName: string;
  timestamp: string;
  latitude: number;
  longitude: number;
  direction: string;
  speedKmh?: number | null;
  vehicleClass: string;
  detectionConfidence: number;
  plateTextRaw?: string | null;
  plateTextNormalized?: string | null;
  plateConfidence?: number | null;
  reidConfidence?: number | null;
  imagePath?: string | null;
  trackId?: number | null;
  frameNumber?: number | null;
  reidEmbedding?: string | null;
  videoUploadId?: string | null;
  bbox?: string | null;
}

export interface DetectionPage {
  content: DetectionRecord[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

/**
 * Triggers the real AI video inference pipeline on a previously uploaded video.
 */
export async function processVideoUpload(
  id: string,
  options?: {
    enableDehaze?: boolean;
    frameStride?: number;
    clientRunToken?: string;
    reprocess?: boolean;
  }
): Promise<ProcessVideoUploadResponse> {
  return apiFetch<ProcessVideoUploadResponse>(`/api/videos/${encodeURIComponent(id)}/process`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      enable_dehaze: options?.enableDehaze ?? false,
      frame_stride: options?.frameStride ?? 5,
      client_run_token: options?.clientRunToken,
      reprocess: options?.reprocess ?? false,
    }),
  });
}

/**
 * Retrieves paginated real detection records persisted for a specific video upload.
 */
export async function getVideoDetections(
  id: string,
  page: number = 0,
  size: number = 20
): Promise<DetectionPage> {
  const params = new URLSearchParams({
    page: String(page),
    size: String(size),
  });
  return apiFetch<DetectionPage>(`/api/videos/${encodeURIComponent(id)}/detections?${params.toString()}`);
}

// ============================================================================
// Phase A5: Global Vehicle Identity, Trajectory & Quality Types & APIs
// ============================================================================

export interface GlobalIdentityDto {
  id: string;
  label: string;
  primaryPlate: string | null;
  plateConfidence: number | null;
  vehicleClass: string | null;
  color: string | null;
  make: string | null;
  model: string | null;
  reviewStatus: string;
  reviewNotes: string | null;
  firstSeenTimestamp: string | null;
  lastSeenTimestamp: string | null;
  detectionCount: number;
  reidModelName: string | null;
  reidModelVersion: string | null;
  reidDimension: number | null;
}

export interface GlobalIdentityPage {
  content: GlobalIdentityDto[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
}

export interface ObservationProvenanceDto {
  associationId: string | null;
  associationDecision: string;
  associationReviewStatus: string;
  reidScore: number | null;
  plateScore: number | null;
  isSeedObservation: boolean;
}

export interface TrajectoryObservationDto {
  detectionId: number;
  globalIdentityId: string;
  cameraId: string;
  cameraName: string;
  timestamp: string | null;
  latitude: number | null;
  longitude: number | null;
  hasCoordinates: boolean;
  direction: string | null;
  speedKmh: number | null;
  vehicleClass: string | null;
  detectionConfidence: number | null;
  plateText: string | null;
  plateConfidence: number | null;
  reidConfidence: number | null;
  imagePath: string | null;
  trackId: number | null;
  frameNumber: number | null;
  provenance: ObservationProvenanceDto | null;
}

export interface TrajectoryTransitionDto {
  fromDetectionId: number;
  toDetectionId: number;
  fromCameraId: string;
  toCameraId: string;
  fromTimestamp: string | null;
  toTimestamp: string | null;
  deltaSeconds: number | null;
  distanceKm: number | null;
  distanceMethod: string;
  connectivity: "VERIFIED_ROAD_EDGE" | "UNVERIFIED_GEODESIC" | "SAME_CAMERA" | "UNKNOWN" | string;
  isVerifiedTopology: boolean;
  apparentSpeedKmh: number | null;
  status: "FEASIBLE" | "IMPOSSIBLE" | "FEASIBILITY_UNKNOWN" | string;
  reason: string;
}

export interface TrajectorySegmentDto {
  segmentIndex: number;
  segmentType: "VERIFIED_ROAD_CONNECTED_PATH" | "PLAUSIBLE_CHRONOLOGICAL_SEQUENCE" | string;
  isFullyVerifiedRoadRoute: boolean;
  observationCount: number;
  startObservationId: number;
  endObservationId: number;
  startTime: string | null;
  endTime: string | null;
  durationSeconds: number | null;
  totalDistanceKm: number | null;
  observations: TrajectoryObservationDto[];
  breakReason: string | null;
}

export interface GlobalTrajectoryDto {
  globalIdentityId: string;
  label: string;
  primaryPlate: string | null;
  vehicleClass: string | null;
  reviewStatus: string;
  totalObservations: number;
  confirmedObservations: number;
  excludedObservations: number;
  segmentCount: number;
  hasImpossibleTransitions: boolean;
  hasUnknownFeasibility: boolean;
  totalFeasibleDistanceKm: number | null;
  totalDurationSeconds: number | null;
  firstSeenTimestamp: string | null;
  lastSeenTimestamp: string | null;
  observations: TrajectoryObservationDto[];
  transitions: TrajectoryTransitionDto[];
  segments: TrajectorySegmentDto[];
}

export interface TrajectoryQualityCountsDto {
  totalObservations: number;
  confirmedObservations: number;
  uncertainObservations: number;
  excludedObservations: number;
  distinctCameraCount: number;
  totalTransitions: number;
  feasibleTransitions: number;
  impossibleTransitions: number;
  unknownFeasibilityTransitions: number;
  verifiedRoadTransitions: number;
  unverifiedGeodesicTransitions: number;
  sameCameraTransitions: number;
}

export interface IdentityQualityDimensionDto {
  status: "CONFIRMED" | "UNCONFIRMED" | "HAS_EXCLUSIONS" | "CONFLICTED" | "INSUFFICIENT_DATA" | string;
  confirmedCount: number;
  excludedCount: number;
  reviewStatusesSeen: string[];
  summary: string;
}

export interface DetectionQualityDimensionDto {
  status: "HIGH" | "ACCEPTABLE" | "LOW" | "INSUFFICIENT_DATA" | string;
  minConfidence: number | null;
  avgConfidence: number | null;
  maxConfidence: number | null;
  lowConfidenceCount: number;
  summary: string;
}

export interface PlateQualityDimensionDto {
  status: "CONSISTENT" | "CONTRADICTORY" | "SINGLE_READING" | "NO_READINGS" | string;
  platesSeen: string[];
  minPlateConfidence: number | null;
  avgPlateConfidence: number | null;
  summary: string;
}

export interface ReidQualityDimensionDto {
  status: "HIGH_SIMILARITY" | "MODERATE_SIMILARITY" | "LOW_SIMILARITY" | "MISSING_EVIDENCE" | string;
  isAvailable: boolean;
  minScore: number | null;
  avgScore: number | null;
  maxScore: number | null;
  modelName: string | null;
  summary: string;
}

export interface SpatialTemporalQualityDimensionDto {
  status: "VERIFIED_ROAD_NETWORK" | "PLAUSIBLE_GEODESIC" | "CONTAINS_IMPOSSIBLE_TRANSITIONS" | "FEASIBILITY_UNKNOWN" | "SINGLE_POINT_OR_SAME_CAMERA" | "EMPTY" | string;
  distinctCameras: number;
  verifiedRoadEdges: number;
  unverifiedGeodesics: number;
  sameCameraTransitions: number;
  impossibleTransitions: number;
  unknownTransitions: number;
  summary: string;
}

export interface CompletenessQualityDimensionDto {
  status: "COMPLETE" | "PARTIAL" | "INSUFFICIENT" | string;
  missingTimestampsCount: number;
  missingCoordinatesCount: number;
  missingReidCount: number;
  missingPlateCount: number;
  summary: string;
}

export interface TrajectoryDimensionsDto {
  identityMembership: IdentityQualityDimensionDto;
  detectionConfidence: DetectionQualityDimensionDto;
  ocrAndPlateConsistency: PlateQualityDimensionDto;
  reidSimilarity: ReidQualityDimensionDto;
  spatialTemporalFeasibility: SpatialTemporalQualityDimensionDto;
  evidenceCompleteness: CompletenessQualityDimensionDto;
}

export interface TrajectoryQualityDto {
  globalIdentityId: string;
  label: string;
  overallQuality: "HIGH_CONFIDENCE" | "MEDIUM_CONFIDENCE" | "LOW_CONFIDENCE" | "INSUFFICIENT_EVIDENCE" | string;
  summary: string;
  isCrossCameraConfirmed: boolean;
  hasImpossibleTransitions: boolean;
  hasContradictions: boolean;
  counts: TrajectoryQualityCountsDto;
  dimensions: TrajectoryDimensionsDto;
  supportingEvidence: string[];
  missingEvidence: string[];
  warningsAndContradictions: string[];
}

/**
 * Reconstructs the chronologically ordered, geographically grounded multi-camera trajectory.
 */
export async function getGlobalTrajectory(
  identityId: string,
  options?: { signal?: AbortSignal }
): Promise<GlobalTrajectoryDto> {
  return apiFetch<GlobalTrajectoryDto>(`/identities/${encodeURIComponent(identityId)}/trajectory`, {
    signal: options?.signal,
  });
}

/**
 * Assesses the multidimensional evidence reliability and quality of a vehicle trajectory.
 */
export async function getGlobalTrajectoryQuality(
  identityId: string,
  options?: { signal?: AbortSignal }
): Promise<TrajectoryQualityDto> {
  return apiFetch<TrajectoryQualityDto>(`/identities/${encodeURIComponent(identityId)}/trajectory/quality`, {
    signal: options?.signal,
  });
}

/**
 * Retrieves paginated list of global vehicle identities.
 */
export async function listGlobalIdentities(
  page: number = 0,
  size: number = 20,
  options?: { signal?: AbortSignal }
): Promise<GlobalIdentityPage> {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  return apiFetch<GlobalIdentityPage>(`/identities?${params.toString()}`, {
    signal: options?.signal,
  });
}

/**
 * Searches for a global vehicle identity by UUID, label, or primary plate.
 */
export async function searchGlobalIdentity(
  query: string,
  options?: { signal?: AbortSignal }
): Promise<GlobalIdentityDto> {
  const params = new URLSearchParams({ query });
  return apiFetch<GlobalIdentityDto>(`/identities/search?${params.toString()}`, {
    signal: options?.signal,
  });
}

// ==========================================
// AI Investigation Agent & Advanced Features
// ==========================================

export interface AgentStructuredRow {
  timestamp?: string | number | null;
  cameraName?: string | null;
  cameraId?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  plateText?: string | null;
  vehicleType?: string | null;
  vehicleClass?: string | null;
  confidence?: number | null;
}

export interface AgentPlanStep {
  tool: string;
  params: Record<string, unknown>;
}

export interface AgentPlan {
  valid: boolean;
  needsClarification?: boolean;
  intent?: string;
  steps: AgentPlanStep[];
  targetPlate?: string;
}

export interface AgentStructuredData {
  type: string;
  [key: string]: unknown;
}

export interface AgentChatMessage {
  sender: 'user' | 'agent';
  text: string;
  intent?: string;
  mode?: 'HISTORIC' | 'LIVE' | 'HYBRID' | string;
  plan?: AgentPlan | null;
  structuredData?: AgentStructuredData | null;
  followUps?: string[];
  timestamp: string;
}

export interface AgentChatResponse {
  conversationId: string | null;
  reply: string;
  intent?: string;
  mode?: 'HISTORIC' | 'LIVE' | 'HYBRID' | string;
  plan?: AgentPlan | null;
  structuredData?: AgentStructuredData | null;
}

export async function sendAgentMessage(
  message: string,
  conversationId?: string,
  activePlate?: string,
  activeCaseId?: string,
  options?: { signal?: AbortSignal }
): Promise<AgentChatResponse> {
  return apiFetch<AgentChatResponse>('/agent/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversationId, activePlate, caseId: activeCaseId }),
    signal: options?.signal,
  });
}

export interface InvestigationSightingDto {
  id: number;
  cameraId: string;
  cameraName: string | null;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
  confidence: number | null;
  plateText: string | null;
  plateConfidence: number | null;
  vehicleType: string | null;
  vehicleColor: string | null;
  evidencePath: string | null;
  trackId: number | null;
  videoUploadId: string | null;
}

export interface InvestigationDto {
  id: string;
  caseNumber: string;
  title: string;
  description: string | null;
  targetPlate: string | null;
  status: 'OPEN' | 'ACTIVE' | 'CLOSED' | 'ARCHIVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  assignedOfficer: string | null;
  notes: { timestamp: string; officer: string; note: string }[];
  createdAt: string;
  updatedAt: string;
  searchCenterLat?: number | null;
  searchCenterLon?: number | null;
  searchRadiusKm?: number | null;
  searchStartAt?: string | null;
  searchEndAt?: string | null;
  sightings?: InvestigationSightingDto[];
}

export async function listInvestigations(
  status?: string,
  options?: { signal?: AbortSignal }
): Promise<InvestigationDto[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  return apiFetch<InvestigationDto[]>(`/investigations${query}`, { signal: options?.signal });
}

export async function getInvestigation(id: string, options?: { signal?: AbortSignal }): Promise<InvestigationDto> {
  return apiFetch<InvestigationDto>(`/investigations/${encodeURIComponent(id)}`, { signal: options?.signal });
}

export async function createInvestigation(
  data: Partial<InvestigationDto>,
  options?: { signal?: AbortSignal }
): Promise<InvestigationDto> {
  return apiFetch<InvestigationDto>('/investigations', {
    method: 'POST',
    body: JSON.stringify(data),
    signal: options?.signal,
  });
}

export async function updateInvestigation(
  id: string,
  updates: Partial<InvestigationDto>,
  options?: { signal?: AbortSignal }
): Promise<InvestigationDto> {
  return apiFetch<InvestigationDto>(`/investigations/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
    signal: options?.signal,
  });
}

export async function addInvestigationNote(
  id: string,
  note: { officer: string; note: string },
  options?: { signal?: AbortSignal }
): Promise<InvestigationDto> {
  return apiFetch<InvestigationDto>(`/investigations/${encodeURIComponent(id)}/notes`, {
    method: 'POST',
    body: JSON.stringify(note),
    signal: options?.signal,
  });
}

export interface EvidenceItemDto {
  id: number;
  detectionId: number;
  cameraId: string;
  cameraName: string;
  plateText: string | null;
  vehicleClass: string | null;
  confidence: number | null;
  timestamp: string;
  imagePath: string | null;
  evidenceHash: string;
  verified?: boolean;
}

export async function listEvidence(
  limit: number = 20,
  offset: number = 0,
  options?: { signal?: AbortSignal }
): Promise<{ evidence: EvidenceItemDto[]; total: number }> {
  return apiFetch<{ evidence: EvidenceItemDto[]; total: number }>(
    `/evidence-vault?limit=${limit}&offset=${offset}`,
    { signal: options?.signal }
  );
}

export async function verifyEvidenceIntegrity(
  id: string | number,
  options?: { signal?: AbortSignal }
): Promise<{ verified: boolean; storedHash: string; calculatedHash?: string; message: string }> {
  return apiFetch<{ verified: boolean; storedHash: string; calculatedHash?: string; message: string }>(
    `/evidence-vault/verify/${encodeURIComponent(String(id))}`,
    {
      method: 'POST',
      signal: options?.signal,
    }
  );
}

export interface SystemDetailedHealthDto {
  status: string;
  timestamp: string;
  uptimeSeconds: number;
  memory: {
    rssMb: number;
    heapTotalMb: number;
    heapUsedMb: number;
  };
  database: {
    ok: boolean;
    latencyMs?: number;
    error?: string;
  };
  redis: {
    status: string;
  };
  aiService: {
    status: string;
    url: string;
  };
  processingRuns: {
    queued: number;
    running: number;
    completed: number;
    failed: number;
  };
}

export async function getDetailedSystemHealth(
  options?: { signal?: AbortSignal }
): Promise<SystemDetailedHealthDto> {
  return apiFetch<SystemDetailedHealthDto>('/system/health/detailed', { signal: options?.signal });
}
