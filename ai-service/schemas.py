"""
Pydantic data models for the multi-camera vehicle intelligence system (SIH26127).

Hierarchy:
  PlateObservation          — one OCR reading from one frame
  VehicleObservation        — all evidence gathered for one local track
  CameraObservation         — best evidence from one camera for one global vehicle
  GlobalVehicle             — cross-camera consolidated identity
  JourneyEvent / Waypoint   — one step in a vehicle's journey
  TrajectoryPrediction      — next-junction forecasting
  TrafficNodeAnalytics      — junction-level traffic flow & congestion stats
  WatchlistEntry / Alert    — security hotlist & anti-spoofing alerts
"""

from __future__ import annotations
import math
from typing import List, Optional, Dict, Any, Literal
from pydantic import BaseModel, Field, field_validator, model_validator, ConfigDict


# ─── low-level observation records ───────────────────────────────────────────

class PlateObservation(BaseModel):
    """A single plate reading from one frame."""
    raw_text: Optional[str] = None
    text: Optional[str] = None
    normalized_text: Optional[str] = None
    confidence: float = 0.0
    ocr_confidence: Optional[float] = None
    plate_detector_confidence: Optional[float] = None
    plate_bbox: Optional[List[float]] = None
    plate_bbox_frame: Optional[List[float]] = None
    frame_number: Optional[int] = None
    timestamp: float = 0.0
    crop: Optional[object] = None
    sharpness_score: Optional[float] = None
    is_uncertain: bool = False

    def model_post_init(self, __context):
        if self.raw_text and not self.text:
            self.text = self.raw_text
        if self.ocr_confidence is not None and self.confidence == 0.0:
            self.confidence = float(self.ocr_confidence)


class VehicleObservation(BaseModel):
    """
    All evidence gathered for one locally-tracked vehicle in one camera.
    """
    camera_id: str
    track_id: int = 0
    local_track_id: int = 0
    vehicle_class: str = "car"
    vehicle_type: str = "car"
    vehicle_color: Optional[str] = None
    color: str = "Unknown"
    color_confidence: Optional[float] = None
    detection_confidence: float = 0.90
    vehicle_bbox: List[float] = Field(default_factory=lambda: [0, 0, 0, 0])
    first_seen_timestamp: str = ""
    last_seen_timestamp: str = ""
    timestamp_first: float = 0.0
    timestamp_last: float = 0.0
    first_seen_frame: int = 0
    last_seen_frame: int = 0
    total_frames_tracked: int = 0
    license_plate: Optional[str] = None
    plate_confidence: float = 0.0
    crop_path: Optional[str] = None
    plate_history: List[PlateObservation] = Field(default_factory=list)
    best_plate: Optional[PlateObservation] = None
    all_plate_readings: List[PlateObservation] = Field(default_factory=list)
    reid_embedding: Optional[List[float]] = None
    reid_embedding_avg: Optional[List[float]] = None
    reid_model_name: Optional[str] = None
    reid_model_version: Optional[str] = None
    reid_dimension: Optional[int] = None
    evidence_image_path: Optional[str] = None

    def model_post_init(self, __context):
        if self.track_id and not self.local_track_id:
            self.local_track_id = self.track_id
        if self.local_track_id and not self.track_id:
            self.track_id = self.local_track_id
        if self.vehicle_type and self.vehicle_class == "car":
            self.vehicle_class = self.vehicle_type
        if self.color and not self.vehicle_color:
            self.vehicle_color = self.color


# ─── cross-camera identity records ───────────────────────────────────────────

class IdentityMatchDetail(BaseModel):
    """Per-signal breakdown of an identity match decision."""
    plate_score: float = 0.0
    reid_score: float = 0.0
    color_score: float = 0.0
    type_score: float = 0.0
    temporal_score: float = 0.0
    topology_score: float = 0.0
    score: float = 0.0
    total_score: float = 0.0
    is_match: bool = False
    decision: str = "NO_MATCH"
    match_level: str = "UNKNOWN"
    reason: str = ""

    def model_post_init(self, __context):
        if self.score > 0.0 and self.total_score == 0.0:
            self.total_score = self.score


IdentityMatchResult = IdentityMatchDetail


class CameraObservation(BaseModel):
    """Best evidence for one global vehicle at one camera."""
    camera_id: str
    video_path: Optional[str] = None
    total_frames: int = 0
    tracks_detected: int = 0
    vehicle_observations: List[VehicleObservation] = Field(default_factory=list)
    first_seen_timestamp: str = ""
    last_seen_timestamp: str = ""
    local_track_id: int = 0
    vehicle_bbox: List[float] = Field(default_factory=lambda: [0, 0, 0, 0])
    plate_text: Optional[str] = None
    plate_confidence: Optional[float] = None
    vehicle_color: Optional[str] = None
    evidence_image_path: Optional[str] = None
    match_detail: Optional[IdentityMatchDetail] = None


class AnomalyAlert(BaseModel):
    anomaly_type: str
    severity: str
    description: str
    timestamp: float
    camera_id: str


class JourneyWaypoint(BaseModel):
    camera_id: str
    timestamp_enter: float
    timestamp_exit: float
    dwell_time_seconds: float = 0.0
    track_id: int = 0
    crop_path: Optional[str] = None
    license_plate_read: Optional[str] = None
    transit_speed_kmh: Optional[float] = None
    transit_distance_km: Optional[float] = None


class VehicleJourney(BaseModel):
    global_id: str
    primary_plate: Optional[str] = None
    color: Optional[str] = None
    vehicle_type: Optional[str] = None
    waypoints: List[JourneyWaypoint] = Field(default_factory=list)
    total_distance_km: float = 0.0
    duration_seconds: float = 0.0
    anomalies: List[AnomalyAlert] = Field(default_factory=list)


class GlobalVehicleRecord(BaseModel):
    global_id: str
    primary_plate: Optional[str] = None
    plate_confidence: float = 0.0
    color: Optional[str] = None
    vehicle_type: Optional[str] = None
    observations: List[VehicleObservation] = Field(default_factory=list)
    reid_embedding: Optional[List[float]] = None
    first_seen_timestamp: float = 0.0
    last_seen_timestamp: float = 0.0
    cameras_visited: List[str] = Field(default_factory=list)


# ─── Predictive Trajectory & Analytics Schemas ────────────────────────────────

class TrajectoryCandidate(BaseModel):
    next_camera_id: str
    next_camera_name: str
    probability: float
    estimated_travel_seconds: float
    estimated_arrival_timestamp: float


class TrajectoryPredictionResponse(BaseModel):
    global_id: str
    primary_plate: Optional[str] = None
    current_camera_id: str
    last_seen_timestamp: float
    candidates: List[TrajectoryCandidate] = Field(default_factory=list)


class TrafficNodeAnalytics(BaseModel):
    camera_id: str
    camera_name: str
    vehicle_count: int = 0
    flow_rate_vpm: float = 0.0          # vehicles per minute
    avg_speed_kmh: float = 0.0
    congestion_status: str = "GREEN"    # GREEN, YELLOW, RED
    modal_split: Dict[str, int] = Field(default_factory=dict)  # {"car": 10, "bus": 2}


class TrafficSummaryResponse(BaseModel):
    total_active_cameras: int = 0
    total_vehicles_observed: int = 0
    city_avg_speed_kmh: float = 0.0
    city_congestion_status: str = "GREEN"
    node_analytics: List[TrafficNodeAnalytics] = Field(default_factory=list)


# ─── Watchlist & Alert Schemas ────────────────────────────────────────────────

class WatchlistEntry(BaseModel):
    plate_number: str
    owner_name: Optional[str] = None
    reason: str = "SUSPICIOUS_VEHICLE"
    severity: str = "HIGH"               # LOW, MEDIUM, HIGH, CRITICAL
    added_timestamp: float = 0.0


class SecurityAlert(BaseModel):
    alert_id: str
    alert_type: str                      # HOTLIST_MATCH, CLONED_PLATE, SPEED_VIOLATION
    severity: str
    plate_number: str
    global_id: Optional[str] = None
    camera_id: str
    timestamp: float
    description: str


# ─── API Request / Response models ───────────────────────────────────────────

class CameraInput(BaseModel):
    camera_id: str
    video_path: str
    # Recording anchor. None = unknown capture time; the pipeline then uses
    # processing time and downstream consumers must treat timestamps as
    # analysis-relative, not capture-true.
    start_time_iso: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    camera_name: Optional[str] = None


class MultiCameraFeedRequest(BaseModel):
    feeds: List[CameraInput]
    frame_stride: int = 5
    parallel: bool = False
    enable_dehaze: bool = True


class MultiCameraProcessingResult(BaseModel):
    total_cameras: int
    total_frames_processed: int
    total_tracks_detected: int
    unique_vehicles_identified: int
    camera_observations: List[CameraObservation]
    vehicle_journeys: List[VehicleJourney]
    anomalies_detected: List[AnomalyAlert]
    security_alerts: List[SecurityAlert] = Field(default_factory=list)


# Legacy compatibility
ProcessMultiCameraRequest = MultiCameraFeedRequest
ProcessMultiCameraResponse = MultiCameraProcessingResult
GlobalVehicle = GlobalVehicleRecord


class DetectionEvent(BaseModel):
    camera_id: str
    frame_number: int
    timestamp: str
    vehicle_class: str
    detection_confidence: float
    bbox: List[float]
    track_id: Optional[int] = None
    plate_text_raw: Optional[str] = None
    plate_text_normalized: Optional[str] = None
    plate_confidence: Optional[float] = None
    image_path: Optional[str] = None
    reid_confidence: Optional[float] = None
    reid_embedding: Optional[List[float]] = None
    reid_model_name: Optional[str] = None
    reid_model_version: Optional[str] = None
    reid_dimension: Optional[int] = None
    video_upload_id: Optional[str] = None
    idempotency_key: Optional[str] = None
    processing_run_id: Optional[str] = None


class ProcessVideoUploadRequest(BaseModel):
    video_upload_id: str
    processing_run_id: Optional[str] = None
    run_number: Optional[int] = None
    storage_provider: Literal["LOCAL", "S3"] = "LOCAL"
    video_path: Optional[str] = None
    storage_bucket: Optional[str] = None
    storage_key: Optional[str] = None
    camera_id: str = Field(..., min_length=1)
    enable_dehaze: bool = False
    frame_stride: int = 5
    # Optional source-provided recording anchor. None means capture time is unknown.
    start_time: Optional[str] = None

    @model_validator(mode="after")
    def validate_media_reference(self):
        if self.storage_provider == "LOCAL" and not self.video_path:
            raise ValueError("video_path is required when storage_provider is LOCAL")
        if self.storage_provider == "S3":
            if self.video_path:
                raise ValueError("video_path must be omitted for S3-backed media")
            if not self.storage_bucket or not self.storage_key:
                raise ValueError("storage_bucket and storage_key are required when storage_provider is S3")
        return self


class ProcessVideoRequest(BaseModel):
    video_path: str
    camera_id: str
    # Recording anchor; None/absent = capture time unknown → processing time used.
    start_time: Optional[str] = None
    frame_stride: int = 5
    plate_sample_stride: int = 3


class ProcessVideoResponse(BaseModel):
    camera_id: str
    video_path: str
    frames_processed: int
    detections: List[DetectionEvent]


# ─── B4.3 Manifest Streaming Protocol Schemas ─────────────────────────────────

class ManifestHeader(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["HEADER"] = "HEADER"
    version: Literal["1.0"] = Field(...)
    video_upload_id: str = Field(..., min_length=1)
    processing_run_id: str = Field(..., min_length=1)
    camera_id: str = Field(..., min_length=1)
    started_at: str = Field(..., min_length=1)


class ManifestEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["EVENT"] = "EVENT"
    seq: int = Field(..., ge=0)
    idempotency_key: str = Field(..., min_length=1)
    frame_number: int = Field(..., ge=0)
    timestamp: str = Field(..., min_length=1)
    camera_id: str = Field(..., min_length=1)
    vehicle_class: str = Field(..., min_length=1)
    detection_confidence: float = Field(..., ge=0.0, le=1.0)
    plate_text_raw: Optional[str] = None
    plate_text_normalized: Optional[str] = None
    plate_confidence: Optional[float] = Field(None, ge=0.0, le=1.0)
    track_id: Optional[int] = None
    bbox: List[float] = Field(..., min_length=4, max_length=4)
    reid_embedding: Optional[List[float]] = None
    reid_model_name: Optional[str] = None
    reid_model_version: Optional[str] = None
    reid_dimension: Optional[int] = None

    @field_validator("detection_confidence", "plate_confidence")
    @classmethod
    def validate_finite_confidence(cls, v: Optional[float]) -> Optional[float]:
        if v is not None and not math.isfinite(v):
            raise ValueError(f"Confidence value must be finite, got {v}")
        return v

    @field_validator("bbox")
    @classmethod
    def validate_finite_bbox(cls, v: List[float]) -> List[float]:
        for idx, coord in enumerate(v):
            if not math.isfinite(coord):
                raise ValueError(f"Bounding box coordinate at index {idx} must be finite, got {coord}")
        return v

    @field_validator("reid_embedding")
    @classmethod
    def validate_reid_embedding(cls, v: Optional[List[float]]) -> Optional[List[float]]:
        if v is not None:
            if len(v) != 2048:
                raise ValueError(f"FastReID embedding must have exactly 2048 dimensions, got {len(v)}")
            for idx, val in enumerate(v):
                if not math.isfinite(val):
                    raise ValueError(f"FastReID embedding contains non-finite value at index {idx}: {val}")
        return v

    @model_validator(mode="after")
    def validate_reid_provenance(self) -> ManifestEvent:
        if self.reid_embedding is not None:
            if self.reid_model_name != "FastReID-SBS-R50-IBN":
                raise ValueError(f"Invalid reid_model_name: expected 'FastReID-SBS-R50-IBN', got '{self.reid_model_name}'")
            if self.reid_model_version != "veri-776-sbs-ibn-v2":
                raise ValueError(f"Invalid reid_model_version: expected 'veri-776-sbs-ibn-v2', got '{self.reid_model_version}'")
            if self.reid_dimension != 2048:
                raise ValueError(f"Invalid reid_dimension: expected 2048, got {self.reid_dimension}")
        else:
            if any(x is not None for x in (self.reid_model_name, self.reid_model_version, self.reid_dimension)):
                raise ValueError("Re-ID provenance fields must not be present when reid_embedding is None")
        return self


class ManifestTrailer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["TRAILER"] = "TRAILER"
    event_count: int = Field(..., ge=0)
    frames_sampled: int = Field(..., ge=0)
    payload_sha256: str = Field(..., min_length=64, max_length=64)
    sealed_at: str = Field(..., min_length=1)

    @field_validator("payload_sha256")
    @classmethod
    def validate_sha256_hex(cls, v: str) -> str:
        if len(v) != 64 or not all(c in "0123456789abcdefABCDEF" for c in v):
            raise ValueError(f"payload_sha256 must be a 64-character hex string, got '{v}'")
        return v.lower()


class ManifestValidationResult(BaseModel):
    is_valid: bool
    event_count: int = 0
    frames_sampled: int = 0
    payload_sha256: Optional[str] = None
    header: Optional[ManifestHeader] = None
    error: Optional[str] = None

