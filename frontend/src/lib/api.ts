/**
 * Thin fetch wrapper for the Spring Boot backend with built-in
 * smart city fallback data so the City AI interface is always responsive.
 */

export function getApiBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_API_BASE_URL) {
    return process.env.NEXT_PUBLIC_API_BASE_URL;
  }
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "http://localhost:8080";
  }
  return "https://sih-project-62k1.onrender.com";
}

export function getAiServiceBaseUrl(): string {
  if (process.env.NEXT_PUBLIC_AI_SERVICE_URL) {
    return process.env.NEXT_PUBLIC_AI_SERVICE_URL;
  }
  if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
    return "http://localhost:8000";
  }
  return "https://city-ai-engine.onrender.com";
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

export interface CameraDto {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  direction: string;
  status: "ONLINE" | "PROCESSING" | "OFFLINE" | string;
  videoSource?: string;
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

// Fallback seed cameras from data/cameras.json
export const SEED_CAMERAS: CameraDto[] = [
  { id: "CAM-01", name: "Shivajinagar Chowk", latitude: 18.5308, longitude: 73.8474, direction: "SE", status: "ONLINE", videoSource: "videos/cam01.mp4" },
  { id: "CAM-02", name: "FC Road Junction", latitude: 18.5236, longitude: 73.8478, direction: "S", status: "ONLINE", videoSource: "videos/cam02.mp4" },
  { id: "CAM-03", name: "JM Road - Deccan Gymkhana", latitude: 18.5158, longitude: 73.8412, direction: "SW", status: "ONLINE", videoSource: "videos/cam03.mp4" },
  { id: "CAM-04", name: "Karve Road Bridge", latitude: 18.5074, longitude: 73.8258, direction: "W", status: "ONLINE", videoSource: "videos/cam04.mp4" },
  { id: "CAM-05", name: "Swargate Junction", latitude: 18.5008, longitude: 73.8567, direction: "E", status: "ONLINE", videoSource: "videos/cam05.mp4" },
  { id: "CAM-06", name: "Hadapsar Industrial Estate", latitude: 18.5089, longitude: 73.9260, direction: "E", status: "ONLINE", videoSource: "videos/cam06.mp4" },
  { id: "CAM-07", name: "Kothrud Depot", latitude: 18.5074, longitude: 73.8077, direction: "NW", status: "ONLINE", videoSource: "videos/cam07.mp4" },
  { id: "CAM-08", name: "Baner Road", latitude: 18.5642, longitude: 73.7769, direction: "N", status: "ONLINE", videoSource: "videos/cam08.mp4" },
  { id: "CAM-09", name: "Hinjewadi Phase 1", latitude: 18.5908, longitude: 73.7392, direction: "W", status: "PROCESSING", videoSource: "videos/cam09.mp4" },
  { id: "CAM-10", name: "Wakad Bridge", latitude: 18.5993, longitude: 73.7629, direction: "N", status: "ONLINE", videoSource: "videos/cam10.mp4" },
  { id: "CAM-11", name: "Aundh - ITI Road", latitude: 18.5590, longitude: 73.8080, direction: "NE", status: "ONLINE", videoSource: "videos/cam11.mp4" },
  { id: "CAM-12", name: "University Circle", latitude: 18.5529, longitude: 73.8291, direction: "SE", status: "OFFLINE", videoSource: "videos/cam12.mp4" }
];

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}/api${path}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...init?.headers,
      },
    });
  } catch {
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

export async function getHealth(): Promise<HealthResponse> {
  return apiFetch<HealthResponse>("/health");
}

export async function getCameras(): Promise<CameraDto[]> {
  try {
    const cams = await apiFetch<CameraDto[]>("/cameras");
    if (!cams || cams.length === 0) return SEED_CAMERAS;
    return cams;
  } catch {
    return SEED_CAMERAS;
  }
}

export async function getVehicleSummary(plate: string): Promise<VehicleSummaryDto> {
  return apiFetch<VehicleSummaryDto>(`/vehicles/${encodeURIComponent(plate)}`);
}

export async function getVehicleDetections(plate: string): Promise<VehicleDetectionDto[]> {
  return apiFetch<VehicleDetectionDto[]>(`/vehicles/${encodeURIComponent(plate)}/detections`);
}

export async function getVehicleTrajectory(plate: string): Promise<TrajectoryResponseDto> {
  return apiFetch<TrajectoryResponseDto>(`/vehicles/${encodeURIComponent(plate)}/trajectory`);
}

export async function getAnalyticsOverview(): Promise<AnalyticsOverviewDto> {
  return apiFetch<AnalyticsOverviewDto>("/analytics/overview");
}

export function evidenceImageUrl(imagePath: string | null | undefined): string | null {
  if (!imagePath) return null;
  return `${API_BASE_URL}/evidence/${imagePath}`;
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
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  plateNumber: string;
  globalId?: string;
  cameraId: string;
  timestamp: number;
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
  timestamp?: number;
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

export async function predictTrajectory(globalId: string): Promise<TrajectoryCandidateDto[]> {
  try {
    const res = await apiFetch<RawTrajectoryResponse | RawCandidateItem[]>(`/predict-trajectory/${encodeURIComponent(globalId)}`);
    const rawList = Array.isArray(res) ? res : (res?.candidates ?? []);
    if (rawList.length > 0) {
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
  } catch {
    // fallback
  }

  try {
    const res = await fetch(`${AI_SERVICE_BASE_URL}/predict-trajectory/${encodeURIComponent(globalId)}`);
    if (res.ok) {
      const data = (await res.json()) as RawTrajectoryResponse | RawCandidateItem[];
      const rawList = Array.isArray(data) ? data : (data?.candidates ?? []);
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
  } catch {
    // fallback
  }
  return [];
}

export async function getSecurityAlerts(): Promise<SecurityAlertDto[]> {
  try {
    const alerts = await apiFetch<RawSecurityAlertItem[]>("/security-alerts");
    if (Array.isArray(alerts) && alerts.length > 0) {
      return alerts.map((a: RawSecurityAlertItem) => ({
        alertId: a.alertId ?? a.alert_id ?? `ALT-${Date.now()}`,
        alertType: a.alertType ?? a.alert_type ?? "ALERT",
        severity: (a.severity?.toUpperCase() ?? "MEDIUM") as SecurityAlertDto["severity"],
        plateNumber: a.plateNumber ?? a.plate_number ?? "UNKNOWN",
        globalId: a.globalId ?? a.global_id,
        cameraId: a.cameraId ?? a.camera_id ?? "CAM-01",
        timestamp: a.timestamp ?? Date.now() / 1000,
        description: a.description ?? "",
      }));
    }
  } catch {
    // fallback
  }

  try {
    const res = await fetch(`${AI_SERVICE_BASE_URL}/security-alerts`);
    if (res.ok) {
      const data = (await res.json()) as RawSecurityAlertItem[];
      if (Array.isArray(data)) {
        return data.map((a: RawSecurityAlertItem) => ({
          alertId: a.alertId ?? a.alert_id ?? `ALT-${Date.now()}`,
          alertType: a.alertType ?? a.alert_type ?? "ALERT",
          severity: (a.severity?.toUpperCase() ?? "MEDIUM") as SecurityAlertDto["severity"],
          plateNumber: a.plateNumber ?? a.plate_number ?? "UNKNOWN",
          globalId: a.globalId ?? a.global_id,
          cameraId: a.cameraId ?? a.camera_id ?? "CAM-01",
          timestamp: a.timestamp ?? Date.now() / 1000,
          description: a.description ?? "",
        }));
      }
    }
  } catch {
    // fallback
  }

  return [
    {
      alertId: "ALT-DEMO-01",
      alertType: "HOTLIST_MATCH",
      severity: "CRITICAL",
      plateNumber: "MH15TC554",
      cameraId: "CAM-01",
      timestamp: Date.now() / 1000,
      description: "SECURITY ALERT: Watchlisted high-value vehicle 'MH15TC554' spotted on CAM-01!",
    },
  ];
}

export async function getWatchlist(): Promise<{ plateNumber: string; reason: string; severity: string }[]> {
  try {
    const list = await apiFetch<RawWatchlistItem[]>("/watchlist");
    if (Array.isArray(list) && list.length > 0) {
      return list.map((w: RawWatchlistItem) => ({
        plateNumber: w.plateNumber ?? w.plate_number ?? "",
        reason: w.reason ?? "",
        severity: w.severity ?? "HIGH",
      }));
    }
  } catch {
    // fallback
  }

  try {
    const res = await fetch(`${AI_SERVICE_BASE_URL}/watchlist`);
    if (res.ok) {
      const list = (await res.json()) as RawWatchlistItem[];
      if (Array.isArray(list)) {
        return list.map((w: RawWatchlistItem) => ({
          plateNumber: w.plateNumber ?? w.plate_number ?? "",
          reason: w.reason ?? "",
          severity: w.severity ?? "HIGH",
        }));
      }
    }
  } catch {
    // fallback
  }

  return [
    { plateNumber: "MH15TC554", reason: "HIGH_VALUE_STOLEN_VEHICLE", severity: "CRITICAL" },
    { plateNumber: "KL55R2473", reason: "SUSPECT_OF_INTEREST", severity: "HIGH" },
  ];
}

export async function addWatchlistEntry(entry: {
  plateNumber: string;
  reason: string;
  severity: string;
  ownerName?: string;
}): Promise<{ plateNumber: string; reason: string; severity: string }> {
  const payload = {
    plateNumber: entry.plateNumber,
    plate_number: entry.plateNumber,
    reason: entry.reason,
    severity: entry.severity,
    ownerName: entry.ownerName,
    owner_name: entry.ownerName,
  };

  try {
    const res = await apiFetch<RawWatchlistItem>("/watchlist", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return {
      plateNumber: res.plateNumber ?? res.plate_number ?? entry.plateNumber,
      reason: res.reason ?? entry.reason,
      severity: res.severity ?? entry.severity,
    };
  } catch {
    try {
      const res = await fetch(`${AI_SERVICE_BASE_URL}/watchlist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = (await res.json()) as RawWatchlistItem;
        return {
          plateNumber: data.plateNumber ?? data.plate_number ?? entry.plateNumber,
          reason: data.reason ?? entry.reason,
          severity: data.severity ?? entry.severity,
        };
      }
    } catch {
      // fallback
    }
    return entry;
  }
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
  startTime: string = "2026-09-05T12:00:00"
): Promise<{ jobId: string; status: string; message: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("camera_id", cameraId);
  formData.append("enable_dehaze", String(enableDehaze));
  formData.append("start_time", startTime);

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
  const res = await fetch(`${AI_SERVICE_BASE_URL}/jobs/${encodeURIComponent(jobId)}`, {
    cache: "no-store",
  });

  if (!res.ok) {
    throw new ApiError(`Job '${jobId}' not found or error`, res.status);
  }

  return (await res.json()) as IngestionJobStatusDto;
}

export async function processVideoFeed(
  videoPath: string,
  cameraId: string,
): Promise<{ cameraId: string; videoPath: string; framesProcessed: number; detectionsCount: number }> {
  const payload = {
    videoPath,
    video_path: videoPath,
    cameraId,
    camera_id: cameraId,
    startTime: "2026-09-05T12:00:00",
    start_time: "2026-09-05T12:00:00",
  };

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
  } catch {
    const res = await fetch(`${AI_SERVICE_BASE_URL}/process-video`, {
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
