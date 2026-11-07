"""
City AI Multi-Camera Vehicle Intelligence AI Microservice (SIH26127 BEL).

Provides REST API endpoints for:
  - Single & Multi-Camera Video Feed Processing (/process-video, /process-multi-camera)
  - Vehicle Journey Trajectory Timelines (/vehicle-journey/{global_id})
  - GIS Map GeoJSON Trajectory Lines (/geojson-trajectories/{global_id})
  - Next-Junction Trajectory Forecasting (/predict-trajectory/{global_id})
  - City-Wide Urban Traffic Analytics (/traffic-analytics)
  - Security Watchlists & Security Alerts (/watchlist, /security-alerts)
  - Health & System Status (/health)
"""

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import re
import asyncio
import logging
import time
from pathlib import Path
from typing import List, Optional, Dict, Any

import cv2
from schemas import (
    ProcessVideoRequest,
    ProcessVideoResponse,
    ProcessVideoUploadRequest,
    MultiCameraFeedRequest,
    MultiCameraProcessingResult,
    VehicleJourney,
    GlobalVehicleRecord,
    TrajectoryPredictionResponse,
    TrafficSummaryResponse,
    WatchlistEntry,
    SecurityAlert,
)
from services.video_pipeline import VideoPipeline
from services.multi_camera_orchestrator import MultiCameraOrchestrator
from services.redis_service import redis_service


logger = logging.getLogger("cityai.api")

UPLOAD_DIR = Path(__file__).resolve().parents[1] / "data" / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR = Path(__file__).resolve().parents[1] / "videos"

_active_jobs: set[str] = set()


def sync_detections_to_backend(events: list[Any], backend_url: Optional[str] = None) -> int:
    """Syncs processed detection events to the Spring Boot backend database."""
    if not events:
        return 0
    url = backend_url or os.environ.get("BACKEND_URL", "http://localhost:8080")
    ingest_user = os.environ.get("INGEST_USERNAME", "ingest")
    ingest_pass = os.environ.get("INGEST_PASSWORD", "local-dev-ingest-only-not-for-prod")

    batch = []
    for d in events:
        batch.append({
            "cameraId": d.camera_id,
            "timestamp": d.timestamp,
            "vehicleClass": d.vehicle_class,
            "detectionConfidence": d.detection_confidence,
            "plateTextRaw": d.plate_text_raw,
            "plateTextNormalized": d.plate_text_normalized,
            "plateConfidence": d.plate_confidence,
            "trackId": d.track_id,
            "frameNumber": d.frame_number,
            "imagePath": d.image_path,
            "reidConfidence": getattr(d, "reid_confidence", None),
            "reidEmbedding": getattr(d, "reid_embedding", None),
            "videoUploadId": getattr(d, "video_upload_id", None),
            "bbox": getattr(d, "bbox", None),
            "reidModelName": getattr(d, "reid_model_name", None),
            "reidModelVersion": getattr(d, "reid_model_version", None),
            "reidDimension": getattr(d, "reid_dimension", None),
        })

    try:
        import requests
        resp = requests.post(
            f"{url}/api/detections/ingest/batch",
            json=batch,
            auth=(ingest_user, ingest_pass),
            timeout=15,
        )
        if resp.status_code == 201:
            logger.info(f"Successfully synced {len(batch)} detections to backend.")
            return len(batch)
        else:
            logger.warning(f"Backend returned HTTP {resp.status_code} during detection sync.")
    except Exception as e:
        logger.warning(f"Could not sync detections to backend ({url}): {e}")
    return 0


def _run_video_job(
    job_id: str,
    video_path: str,
    camera_id: str,
    start_time_iso: str,
    frame_stride: int,
    enable_dehaze: bool,
    video_upload_id: Optional[str] = None,
):
    from services.video_pipeline import CameraAgent

    t0 = time.time()
    logger.info(f"Starting video processing job {job_id} for camera {camera_id}: {video_path}")

    def on_progress(frames_done: int, total_frames: int, stats: Dict[str, Any]):
        effective_total = max(int(total_frames / max(frame_stride, 1)), 1)
        pct = min(99.0, round((frames_done / effective_total) * 100, 1))
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        loop.run_until_complete(
            redis_service.set_job_status(
                job_id,
                status="PROCESSING",
                progress=pct,
                details={
                    "camera_id": camera_id,
                    "frames_processed": frames_done,
                    "total_frames": total_frames,
                    "detections_count": stats.get("detections_count", 0),
                    "active_tracks": stats.get("tracks_count", 0),
                    "dcp_applied": stats.get("dcp_applied", False),
                },
            )
        )

    try:
        agent = CameraAgent(camera_id)
        frames_processed, observations, detections = agent.process_feed(
            video_path=video_path,
            start_time_iso=start_time_iso,
            frame_stride=frame_stride,
            enable_dehaze=enable_dehaze,
            progress_callback=on_progress,
            video_upload_id=video_upload_id,
        )

        synced_count = sync_detections_to_backend(detections)
        elapsed = time.time() - t0
        fps = round(frames_processed / max(elapsed, 0.001), 1)

        recognized_plates = [
            d.plate_text_normalized for d in detections if d.plate_text_normalized
        ]

        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        models_exec = ["YOLOv8s-Vehicle", "ByteTrack", "EasyOCR", "ColorClassifier", "ReIdService"]
        if enable_dehaze:
            models_exec.append("DCP-Dehazer")

        loop.run_until_complete(
            redis_service.set_job_status(
                job_id,
                status="COMPLETED",
                progress=100.0,
                details={
                    "camera_id": camera_id,
                    "video_path": video_path,
                    "frames_processed": frames_processed,
                    "detections_count": len(detections),
                    "tracks_count": len(observations),
                    "synced_to_backend": synced_count,
                    "recognized_plates": list(set(recognized_plates)),
                    "dcp_enabled": enable_dehaze,
                    "dcp_applied": enable_dehaze,
                    "models_executed": models_exec,
                    "models_skipped": [] if enable_dehaze else ["DCP-Dehazer"],
                    "duration_seconds": round(elapsed, 2),
                    "fps": fps,
                },
            )
        )
        if video_upload_id:
            try:
                import requests
                backend_url = os.environ.get("BACKEND_URL", "http://localhost:8080")
                ingest_user = os.environ.get("INGEST_USERNAME", "ingest")
                ingest_pass = os.environ.get("INGEST_PASSWORD", "local-dev-ingest-only-not-for-prod")
                requests.post(
                    f"{backend_url}/api/videos/{video_upload_id}/complete",
                    json={
                        "frames_processed": frames_processed,
                        "detections_count": len(detections),
                        "duration_seconds": round(elapsed, 2),
                        "error": None,
                    },
                    auth=(ingest_user, ingest_pass),
                    timeout=10,
                )
            except Exception as e:
                logger.warning(f"Failed to notify backend of video completion: {e}")
        logger.info(f"Video job {job_id} COMPLETED in {elapsed:.1f}s ({frames_processed} frames, {len(detections)} detections)")
    except Exception as exc:
        logger.error(f"Video job {job_id} FAILED: {exc}", exc_info=True)
        try:
            loop = asyncio.get_event_loop()
        except RuntimeError:
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)

        loop.run_until_complete(
            redis_service.set_job_status(
                job_id,
                status="FAILED",
                progress=0.0,
                details={
                    "camera_id": camera_id,
                    "error": str(exc),
                },
            )
        )
        if video_upload_id:
            try:
                import requests
                backend_url = os.environ.get("BACKEND_URL", "http://localhost:8080")
                ingest_user = os.environ.get("INGEST_USERNAME", "ingest")
                ingest_pass = os.environ.get("INGEST_PASSWORD", "local-dev-ingest-only-not-for-prod")
                requests.post(
                    f"{backend_url}/api/videos/{video_upload_id}/complete",
                    json={
                        "frames_processed": 0,
                        "detections_count": 0,
                        "duration_seconds": 0.0,
                        "error": str(exc),
                    },
                    auth=(ingest_user, ingest_pass),
                    timeout=10,
                )
            except Exception as e:
                logger.warning(f"Failed to notify backend of video failure: {e}")
    finally:
        _active_jobs.discard(job_id)

app = FastAPI(
    title="City AI ANPR Trajectory & Urban Traffic Intelligence Engine (SIH26127 BEL)",
    version="2.0.0",
    description="Bharat Electronics Limited (BEL) City-Wide Multi-Camera ANPR Trajectory & GIS Analytics System.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipeline: Optional[VideoPipeline] = None
_orchestrator: Optional[MultiCameraOrchestrator] = None


@app.on_event("startup")
async def on_startup():
    await redis_service.initialize()


def get_pipeline() -> VideoPipeline:
    global _pipeline
    if _pipeline is None:
        _pipeline = VideoPipeline()
    return _pipeline


def get_orchestrator() -> MultiCameraOrchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = MultiCameraOrchestrator()
    return _orchestrator


@app.get("/health")
async def health() -> dict:
    redis_info = await redis_service.check_health()
    return {
        "status": "ok",
        "service": "city-ai-anpr-trajectory-engine",
        "organization": "Bharat Electronics Limited (BEL)",
        "sih_problem": "SIH26127",
        "version": "2.0.0",
        "redis": redis_info,
    }


@app.get("/jobs/{job_id}")
async def get_job_status(job_id: str) -> dict:
    status = await redis_service.get_job_status(job_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Job '{job_id}' not found")
    return status



@app.post("/process-video-upload")
async def process_video_upload_endpoint(
    request: ProcessVideoUploadRequest,
    background_tasks: BackgroundTasks,
) -> Dict[str, Any]:
    """Processes an already-uploaded video associated with an A3 video_upload_id."""
    video_path = request.video_path
    video_upload_id = request.video_upload_id

    # Validate video can be opened
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise HTTPException(
            status_code=400,
            detail=f"Unable to open video source: '{video_path}'. Ensure file exists or stream is accessible."
        )
    cap.release()

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    _active_jobs.add(job_id)

    await redis_service.set_job_status(
        job_id,
        status="QUEUED",
        progress=0.0,
        details={
            "job_id": job_id,
            "video_upload_id": video_upload_id,
            "camera_id": request.camera_id,
            "video_path": video_path,
            "dcp_enabled": request.enable_dehaze,
        },
    )

    background_tasks.add_task(
        _run_video_job,
        job_id,
        video_path,
        request.camera_id,
        request.start_time,
        request.frame_stride,
        request.enable_dehaze,
        video_upload_id,
    )

    return {
        "job_id": job_id,
        "video_upload_id": video_upload_id,
        "status": "QUEUED",
        "camera_id": request.camera_id,
        "video_path": video_path,
        "message": f"Inference pipeline initiated for video upload '{video_upload_id}'.",
    }


@app.post("/upload-video")
async def upload_video_endpoint(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    camera_id: str = Form("CAM-01"),
    enable_dehaze: bool = Form(False),
    start_time: str = Form("2026-09-05T12:00:00"),
    frame_stride: int = Form(5),
) -> Dict[str, Any]:
    """Uploads a binary video file, creates a job ID, and runs the AI pipeline."""
    filename = file.filename or "video.mp4"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in [".mp4", ".avi", ".mov", ".mkv"]:
        raise HTTPException(status_code=400, detail=f"Unsupported format '{ext}'. Allowed: .mp4, .avi, .mov, .mkv")

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    safe_name = f"{job_id}_{re.sub(r'[^a-zA-Z0-9_.-]', '_', filename)}"
    save_path = UPLOAD_DIR / safe_name

    content_bytes = await file.read()
    if len(content_bytes) == 0:
        raise HTTPException(status_code=400, detail="Empty video file uploaded.")
    if len(content_bytes) > 150 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Video file exceeds 150MB limit.")

    with open(save_path, "wb") as f:
        f.write(content_bytes)

    _active_jobs.add(job_id)
    await redis_service.set_job_status(
        job_id,
        status="QUEUED",
        progress=0.0,
        details={
            "camera_id": camera_id,
            "filename": filename,
            "video_path": str(save_path),
            "size_bytes": len(content_bytes),
            "dcp_enabled": enable_dehaze,
        },
    )

    background_tasks.add_task(
        _run_video_job,
        job_id,
        str(save_path),
        camera_id,
        start_time,
        frame_stride,
        enable_dehaze,
    )

    return {
        "job_id": job_id,
        "status": "QUEUED",
        "camera_id": camera_id,
        "filename": filename,
        "message": f"Video uploaded successfully. Ingestion job '{job_id}' queued.",
    }


@app.post("/ingest-camera/{camera_id}")
async def ingest_camera_endpoint(
    camera_id: str,
    background_tasks: BackgroundTasks,
    enable_dehaze: bool = False,
    start_time: str = "2026-09-05T12:00:00",
    frame_stride: int = 5,
) -> Dict[str, Any]:
    """Triggers the real AI processing pipeline on recorded camera corridor video."""
    video_path = VIDEOS_DIR / f"{camera_id}.mp4"
    if not video_path.exists():
        alt_path = VIDEOS_DIR / f"{camera_id.lower()}.mp4"
        if alt_path.exists():
            video_path = alt_path
        else:
            raise HTTPException(
                status_code=404,
                detail=f"Recorded video footage for camera '{camera_id}' not found in videos/ directory.",
            )

    job_id = f"job-{uuid.uuid4().hex[:12]}"
    _active_jobs.add(job_id)
    await redis_service.set_job_status(
        job_id,
        status="QUEUED",
        progress=0.0,
        details={
            "camera_id": camera_id,
            "video_path": str(video_path),
            "dcp_enabled": enable_dehaze,
        },
    )

    background_tasks.add_task(
        _run_video_job,
        job_id,
        str(video_path),
        camera_id,
        start_time,
        frame_stride,
        enable_dehaze,
    )

    return {
        "job_id": job_id,
        "status": "QUEUED",
        "camera_id": camera_id,
        "video_path": str(video_path),
        "message": f"Recorded camera ingestion started for '{camera_id}'.",
    }

@app.post("/process-video", response_model=ProcessVideoResponse)
def process_video(request: ProcessVideoRequest) -> ProcessVideoResponse:
    """Processes a single camera video feed."""
    try:
        pipeline = get_pipeline()
        frames_processed, detections = pipeline.process(
            video_path=request.video_path,
            camera_id=request.camera_id,
            start_time_iso=request.start_time,
            frame_stride=request.frame_stride,
            plate_sample_stride=request.plate_sample_stride,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Processing failed: {exc}") from exc

    return ProcessVideoResponse(
        camera_id=request.camera_id,
        video_path=request.video_path,
        frames_processed=frames_processed,
        detections=detections,
    )


@app.post("/process-multi-camera", response_model=MultiCameraProcessingResult)
def process_multi_camera(request: MultiCameraFeedRequest) -> MultiCameraProcessingResult:
    """Processes multiple camera video feeds, performs cross-camera tracking & journey reconstruction."""
    try:
        orchestrator = get_orchestrator()
        result = orchestrator.process_multi_camera_feeds(request, parallel=request.parallel)
        return result
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Multi-camera processing failed: {exc}") from exc


@app.get("/vehicle-journey/{global_id}", response_model=VehicleJourney)
def get_vehicle_journey(global_id: str) -> VehicleJourney:
    """Retrieves the reconstructed cross-camera timeline journey and anomaly alerts for a global vehicle ID."""
    orchestrator = get_orchestrator()
    journey = orchestrator.get_vehicle_journey(global_id)
    if not journey:
        raise HTTPException(status_code=404, detail=f"Global vehicle ID '{global_id}' not found.")
    return journey


@app.get("/predict-trajectory/{global_id}", response_model=TrajectoryPredictionResponse)
def predict_next_trajectory(global_id: str) -> TrajectoryPredictionResponse:
    """Forecasts top-3 candidate next camera junctions and ETA for a target vehicle."""
    orchestrator = get_orchestrator()
    prediction = orchestrator.predict_next_trajectory(global_id)
    if not prediction:
        raise HTTPException(status_code=404, detail=f"Global vehicle ID '{global_id}' not found.")
    return prediction


@app.get("/traffic-analytics", response_model=TrafficSummaryResponse)
def get_traffic_analytics() -> TrafficSummaryResponse:
    """Returns city-wide and junction-level traffic flow, speed profiles, and congestion statuses."""
    orchestrator = get_orchestrator()
    return orchestrator.get_traffic_summary()


@app.get("/watchlist", response_model=List[WatchlistEntry])
def get_watchlist() -> List[WatchlistEntry]:
    """Retrieves all registered target plates in the security watchlist."""
    orchestrator = get_orchestrator()
    return orchestrator.watchlist_manager.get_all_watchlist_entries()


@app.post("/watchlist", response_model=WatchlistEntry)
def add_watchlist_entry(entry: WatchlistEntry) -> WatchlistEntry:
    """Adds a new plate to the security watchlist."""
    orchestrator = get_orchestrator()
    return orchestrator.watchlist_manager.add_to_watchlist(
        plate_number=entry.plate_number,
        owner_name=entry.owner_name or "",
        reason=entry.reason,
        severity=entry.severity,
    )


@app.get("/security-alerts", response_model=List[SecurityAlert])
def get_security_alerts() -> List[SecurityAlert]:
    """Returns active security alerts (hotlist matches, cloned plates, speed violations)."""
    orchestrator = get_orchestrator()
    return orchestrator.watchlist_manager.get_all_alerts()


@app.get("/geojson-trajectories/{global_id}")
def get_geojson_trajectory(global_id: str) -> Dict[str, Any]:
    """Generates GeoJSON FeatureCollection format trajectory line for GIS map rendering."""
    orchestrator = get_orchestrator()
    journey = orchestrator.get_vehicle_journey(global_id)
    if not journey:
        raise HTTPException(status_code=404, detail=f"Global vehicle ID '{global_id}' not found.")

    coordinates = []
    for wp in journey.waypoints:
        node = orchestrator.topology_service.nodes.get(wp.camera_id)
        if node:
            coordinates.append([node.longitude, node.latitude])

    geojson = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": coordinates,
                },
                "properties": {
                    "global_id": journey.global_id,
                    "primary_plate": journey.primary_plate or "UNKNOWN",
                    "color": journey.color,
                    "vehicle_type": journey.vehicle_type,
                    "total_distance_km": journey.total_distance_km,
                    "duration_seconds": journey.duration_seconds,
                    "waypoints_count": len(journey.waypoints),
                },
            }
        ],
    }
    return geojson


# Real-time ML License Plate & Vehicle Tracking Endpoint
import base64
import cv2
import numpy as np
from ai.plate_detector import PlateDetector
from ai.tracker import VehicleTracker
from ai.ocr import OCRService

_plate_detector_instance: Optional[PlateDetector] = None
_vehicle_tracker_instance: Optional[VehicleTracker] = None
_ocr_instance: Optional[OCRService] = None


def get_plate_detector() -> PlateDetector:
    global _plate_detector_instance
    if _plate_detector_instance is None:
        _plate_detector_instance = PlateDetector()
    return _plate_detector_instance


def get_vehicle_tracker() -> VehicleTracker:
    global _vehicle_tracker_instance
    if _vehicle_tracker_instance is None:
        _vehicle_tracker_instance = VehicleTracker("CAM-01")
    return _vehicle_tracker_instance


def get_ocr_service() -> OCRService:
    global _ocr_instance
    if _ocr_instance is None:
        _ocr_instance = OCRService()
    return _ocr_instance


@app.post("/detect-plate")
async def detect_plate_endpoint(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Real-time ML license plate and vehicle detector endpoint.
    Accepts base64 frame from client video feed, runs YOLO plate detection
    and OCR text extraction, and returns detected plate bounding box in frame percentages.
    Never echoes target plate and never synthesizes heuristic plate bounding boxes.
    """
    image_b64 = data.get("image")

    if not image_b64:
        return {"success": False, "detected": False, "message": "No frame image provided"}

    try:
        if "," in image_b64:
            image_b64 = image_b64.split(",", 1)[1]
        img_bytes = base64.b64decode(image_b64)
        nparr = np.frombuffer(img_bytes, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None or frame.size == 0:
            return {"success": False, "detected": False, "message": "Corrupted image frame"}

        h, w = frame.shape[:2]
        p_detector = get_plate_detector()
        v_tracker = get_vehicle_tracker()

        # 1. First attempt: Direct YOLO plate detector on frame
        try:
            p_res = p_detector.model.predict(frame, conf=0.15, verbose=False)[0]
            if p_res.boxes is not None and len(p_res.boxes) > 0:
                best_box = max(p_res.boxes, key=lambda b: float(b.conf[0]))
                x1, y1, x2, y2 = (float(val) for val in best_box.xyxy[0].tolist())
                conf = float(best_box.conf[0])

                # Extract plate crop and run genuine OCR
                plate_crop = frame[max(0, int(y1)):min(h, int(y2)), max(0, int(x1)):min(w, int(x2))]
                detected_plate = None
                ocr_conf = None
                if plate_crop.size > 0:
                    try:
                        ocr_res = get_ocr_service().read_plate(plate_crop)
                        if ocr_res and ocr_res.normalized_text:
                            detected_plate = ocr_res.normalized_text
                            ocr_conf = round(ocr_res.confidence, 3)
                    except Exception:
                        pass

                return {
                    "success": True,
                    "detected": True,
                    "plate": detected_plate,
                    "confidence": round(conf, 3),
                    "ocr_confidence": ocr_conf,
                    "model": "YOLOv8n-LP",
                    "box": {
                        "left": round((x1 / w) * 100, 2),
                        "top": round((y1 / h) * 100, 2),
                        "width": round(((x2 - x1) / w) * 100, 2),
                        "height": round(((y2 - y1) / h) * 100, 2),
                    },
                }
        except Exception:
            pass

        # 2. Second attempt: YOLO vehicle detector + plate detection on vehicle crop
        try:
            v_res = v_tracker.model.predict(frame, classes=[2, 3, 5, 7], conf=0.20, verbose=False)[0]
            if v_res.boxes is not None and len(v_res.boxes) > 0:
                best_v = max(v_res.boxes, key=lambda b: float(b.conf[0]))
                vx1, vy1, vx2, vy2 = (int(val) for val in best_v.xyxy[0].tolist())

                crop = frame[max(0, vy1):min(h, vy2), max(0, vx1):min(w, vx2)]
                if crop.size > 0:
                    plates = p_detector.detect(crop)
                    if plates:
                        p = plates[0]
                        px1, py1, px2, py2 = p.bbox
                        plate_crop = crop[max(0, py1):min(crop.shape[0], py2), max(0, px1):min(crop.shape[1], px2)]
                        detected_plate = None
                        ocr_conf = None
                        if plate_crop.size > 0:
                            try:
                                ocr_res = get_ocr_service().read_plate(plate_crop)
                                if ocr_res and ocr_res.normalized_text:
                                    detected_plate = ocr_res.normalized_text
                                    ocr_conf = round(ocr_res.confidence, 3)
                            except Exception:
                                pass

                        return {
                            "success": True,
                            "detected": True,
                            "plate": detected_plate,
                            "confidence": round(p.confidence, 3),
                            "ocr_confidence": ocr_conf,
                            "model": "YOLOv8s+YOLOv8n-LP",
                            "box": {
                                "left": round(((vx1 + px1) / w) * 100, 2),
                                "top": round(((vy1 + py1) / h) * 100, 2),
                                "width": round(((px2 - px1) / w) * 100, 2),
                                "height": round(((py2 - py1) / h) * 100, 2),
                            },
                        }
        except Exception:
            pass

        return {"success": True, "detected": False, "plate": None, "message": "No vehicle or plate in frame"}

    except Exception as e:
        return {"success": False, "detected": False, "error": str(e)}

