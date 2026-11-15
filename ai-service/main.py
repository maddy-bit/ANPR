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

from fastapi import FastAPI, HTTPException, Query, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
import os
import uuid
import re
import asyncio
import json
import logging
import time
import inspect
from pathlib import Path
from typing import List, Optional, Dict, Any, cast

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
from services.video_pipeline import VideoPipeline, CameraAgent
from services.multi_camera_orchestrator import MultiCameraOrchestrator
from services.redis_service import redis_service
from services.media_storage import head_s3_object, materialize_video
from services.model_artifact_manifest import model_manifest_required, verify_inference_models_load, verify_model_manifest
from services.manifest_service import (
    StreamingManifestWriter,
    publish_manifest_no_clobber,
    validate_manifest,
    DEFAULT_MANIFEST_ROOT,
)


logger = logging.getLogger("cityai.api")

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(Path(__file__).resolve().parents[1] / "data" / "uploads")))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
VIDEOS_DIR = Path(os.environ.get("VIDEOS_DIR", str(Path(__file__).resolve().parents[1] / "videos")))

_active_jobs: set[str] = set()


class StaleWorkerRunSupersededException(Exception):
    """Raised when worker receives notification that its processing run was superseded or abandoned."""
    pass


def _required_ingestion_credentials() -> tuple[str, str]:
    username = os.environ.get("INGEST_USERNAME")
    password = os.environ.get("INGEST_PASSWORD")
    if not username or not password:
        raise RuntimeError("Backend ingestion credentials are not configured")
    return username, password


def sync_detections_to_backend(events: List[Any], backend_url: Optional[str] = None) -> None:
    """Syncs processed detection events to the Spring Boot backend database."""
    if not events:
        return
    url = backend_url or os.environ.get("BACKEND_URL", "http://localhost:8080")
    ingest_user, ingest_pass = _required_ingestion_credentials()

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
            "idempotencyKey": getattr(d, "idempotency_key", None),
            "processingRunId": getattr(d, "processing_run_id", None),
        })

    max_retries = 3
    last_error: Optional[str] = None
    for attempt in range(1, max_retries + 1):
        try:
            import requests
            resp = requests.post(
                f"{url}/api/detections/ingest/batch",
                json=batch,
                auth=(ingest_user, ingest_pass),
                timeout=15,
            )
            if resp.status_code in (200, 201):
                logger.info(f"Successfully synced {len(batch)} detections to backend (HTTP {resp.status_code}).")
                return
            elif resp.status_code == 409 or (resp.status_code == 400 and "ABANDONED" in resp.text):
                run_id = batch[0].get("processingRunId") if batch else "unknown"
                logger.warning(f"Backend rejected sync (HTTP {resp.status_code}): run {run_id} is superseded/abandoned.")
                raise StaleWorkerRunSupersededException(
                    f"Processing run {run_id} was superseded or abandoned on backend"
                )
            elif resp.status_code in (400, 422):
                logger.error("Backend ingestion rejected detection batch (status=%s)", resp.status_code)
                raise ValueError(
                    f"Backend rejected detection batch with validation status {resp.status_code}"
                )
            else:
                last_error = f"Backend returned HTTP {resp.status_code}: {resp.text}"
                logger.warning(f"Attempt {attempt}/{max_retries}: {last_error}")
        except (StaleWorkerRunSupersededException, ValueError):
            raise
        except Exception as e:
            last_error = type(e).__name__
            logger.warning("Backend sync attempt %s/%s failed (%s)", attempt, max_retries, type(e).__name__)

        if attempt < max_retries:
            time.sleep(0.5 * attempt)

    raise RuntimeError(f"Failed to sync detection batch of {len(batch)} items to backend at {url} after {max_retries} attempts: {last_error}")


_main_event_loop: Optional[asyncio.AbstractEventLoop] = None


def set_main_event_loop(loop: Optional[asyncio.AbstractEventLoop]) -> None:
    global _main_event_loop
    _main_event_loop = loop


def _is_anyio_worker_thread() -> bool:
    try:
        import anyio.from_thread
        tl = getattr(anyio.from_thread, "threadlocals", None)
        if tl is not None:
            return getattr(tl, "current_token", None) is not None
        return False
    except Exception:
        return False


def _run_async(coro_or_fn: Any, *args: Any) -> Any:
    """
    Executes async coroutine or async callable strictly on the owning event loop.
    Guarantees:
    1. Single well-defined execution strategy per calling context; no cascading fallbacks.
    2. Never swallows coroutine execution errors.
    3. Never executes the same operation twice.
    4. Never reuses an already-awaited coroutine object.
    5. Disallows synchronous invocation from an active event loop thread to prevent deadlocks.
    6. Preserves thread-to-loop ownership and shared async connection pools.
    """
    # Check if current thread is already running an event loop
    try:
        curr_loop = asyncio.get_running_loop()
    except RuntimeError:
        curr_loop = None

    if curr_loop is not None and curr_loop.is_running():
        raise RuntimeError(
            "Synchronous _run_async cannot be invoked from an active event loop thread; "
            "await the coroutine directly instead."
        )

    # Calling Context 1: AnyIO worker thread (Starlette/FastAPI background tasks or anyio.to_thread)
    if _is_anyio_worker_thread():
        import anyio.from_thread
        if callable(coro_or_fn):
            async def _call_fn() -> Any:
                res = coro_or_fn(*args)
                if inspect.isawaitable(res):
                    return await res
                return res
            return anyio.from_thread.run(_call_fn)
        else:
            coro_obj = cast(Any, coro_or_fn)
            async def _await_obj() -> Any:
                return await coro_obj
            return anyio.from_thread.run(_await_obj)

    # Calling Context 2: Ordinary Python thread (e.g. threading.Thread), with main loop in another thread
    global _main_event_loop
    if _main_event_loop is not None and _main_event_loop.is_running():
        coro = coro_or_fn(*args) if callable(coro_or_fn) else coro_or_fn
        future = asyncio.run_coroutine_threadsafe(cast(Any, coro), _main_event_loop)
        return future.result()

    # Calling Context 3: Standalone synchronous context without a running event loop (e.g. CLI/unit test)
    coro = coro_or_fn(*args) if callable(coro_or_fn) else coro_or_fn
    return asyncio.run(cast(Any, coro))


def _run_video_job(
    job_id: str,
    video_path: str,
    camera_id: str,
    start_time_iso: Optional[str],
    frame_stride: int,
    enable_dehaze: bool,
    video_upload_id: Optional[str] = None,
    processing_run_id: Optional[str] = None,
    run_number: Optional[int] = None,
    stream_msg_id: Optional[str] = None,
    consumer_id: Optional[str] = None,
):
    t0 = time.time()
    logger.info(f"Starting video processing job {job_id} (run {processing_run_id}) for camera {camera_id}: {video_path}")

    # Start independent background heartbeat for dispatch lock lease renewal
    heartbeat = redis_service.create_lock_heartbeat(
        job_id=job_id,
        interval_seconds=20.0,
        ttl_seconds=120,
        sync_runner=_run_async,
        stream_msg_id=stream_msg_id,
        consumer_id=consumer_id,
    )
    heartbeat.start()

    writer = None
    manifest_final_path = None
    manifest_sha256 = None
    if video_upload_id and processing_run_id:
        try:
            staging_dir = DEFAULT_MANIFEST_ROOT / "staging"
            staging_dir.mkdir(parents=True, exist_ok=True)
            staging_path = staging_dir / f"run_{processing_run_id}.ndjson.tmp"
            writer = StreamingManifestWriter(
                staging_path=staging_path,
                video_upload_id=video_upload_id,
                processing_run_id=processing_run_id,
                camera_id=camera_id,
            )
        except Exception as e:
            logger.warning(f"Could not initialize StreamingManifestWriter for run {processing_run_id}: {e}")

    def on_progress(frames_done: int, total_frames: int, stats: Dict[str, Any]):
        if heartbeat.is_lock_lost():
            raise StaleWorkerRunSupersededException(
                f"Heartbeat detected dispatch lock for {job_id} was lost, expired, or superseded."
            )
        effective_total = max(int(total_frames / max(frame_stride, 1)), 1)
        pct = min(99.0, round((frames_done / effective_total) * 100, 1))
        _run_async(
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
        def safe_batch_sync(events: List[Any], b_url: Optional[str] = None):
            if heartbeat and heartbeat.is_lock_lost():
                raise StaleWorkerRunSupersededException(
                    f"Heartbeat detected dispatch lock for {job_id} was lost, expired, or superseded; aborting batch sync."
                )
            sync_detections_to_backend(events, b_url)

        frames_processed, observations, detections = agent.process_feed(
            video_path=video_path,
            start_time_iso=start_time_iso,
            frame_stride=frame_stride,
            enable_dehaze=enable_dehaze,
            progress_callback=on_progress,
            video_upload_id=video_upload_id,
            processing_run_id=processing_run_id,
            writer=writer,
            batch_sync_callback=safe_batch_sync,
        )

        if heartbeat and heartbeat.is_lock_lost():
            raise StaleWorkerRunSupersededException(
                f"Heartbeat detected dispatch lock for {job_id} was lost, expired, or superseded; aborting manifest publication."
            )

        if writer:
            try:
                sealed_path = writer.close_and_seal()
                final_dir = DEFAULT_MANIFEST_ROOT / "final"
                final_dir.mkdir(parents=True, exist_ok=True)
                final_path = final_dir / f"manifest_{processing_run_id}.ndjson"
                published_path = publish_manifest_no_clobber(
                    staging_path=sealed_path,
                    final_path=final_path,
                    expected_run_id=str(processing_run_id),
                    trusted_root=DEFAULT_MANIFEST_ROOT,
                )
                manifest_final_path = str(published_path)
                val_res = validate_manifest(published_path, expected_run_id=str(processing_run_id))
                if not val_res.is_valid:
                    raise RuntimeError(f"Published manifest failed cryptographic validation: {val_res.error}")
                if val_res.event_count != len(detections):
                    raise RuntimeError(f"Manifest event count ({val_res.event_count}) does not match detection count ({len(detections)})")
                manifest_sha256 = val_res.payload_sha256
                logger.info(f"Manifest sealed and published to {manifest_final_path} (sha256: {manifest_sha256}, events: {val_res.event_count})")
            except Exception as e:
                logger.error(f"Manifest sealing/publication error for run {processing_run_id}: {e}", exc_info=True)
                raise

        if heartbeat and heartbeat.is_lock_lost():
            raise StaleWorkerRunSupersededException(
                f"Heartbeat detected dispatch lock for {job_id} was lost, expired, or superseded; aborting backend completion."
            )

        elapsed = time.time() - t0
        fps = round(frames_processed / max(elapsed, 0.001), 1)

        # Backend notification of completion MUST occur and succeed BEFORE acknowledging job
        if video_upload_id:
            import requests
            backend_url = os.environ.get("BACKEND_URL", "http://localhost:8080")
            ingest_user, ingest_pass = _required_ingestion_credentials()
            comp_success = False
            last_comp_err = None
            for comp_attempt in range(1, 4):
                try:
                    comp_resp = requests.post(
                        f"{backend_url}/api/videos/{video_upload_id}/complete",
                        json={
                            "processing_run_id": processing_run_id,
                            "frames_processed": frames_processed,
                            "detections_count": len(detections),
                            "duration_seconds": round(elapsed, 2),
                            "manifest_path": manifest_final_path,
                            "manifest_sha256": manifest_sha256,
                            "error": None,
                        },
                        auth=(ingest_user, ingest_pass),
                        timeout=10,
                    )
                    if comp_resp.ok:
                        comp_success = True
                        break
                    elif comp_resp.status_code == 409 or (comp_resp.status_code == 400 and "ABANDONED" in comp_resp.text):
                        raise StaleWorkerRunSupersededException(
                            f"Backend rejected completion (HTTP {comp_resp.status_code}): run {processing_run_id} is superseded/abandoned: {comp_resp.text}"
                        )
                    else:
                        last_comp_err = f"HTTP {comp_resp.status_code}: {comp_resp.text}"
                        logger.warning(f"Attempt {comp_attempt}/3: Backend completion callback returned {last_comp_err}")
                except StaleWorkerRunSupersededException:
                    raise
                except Exception as comp_err:
                    last_comp_err = str(comp_err)
                    logger.warning(f"Attempt {comp_attempt}/3: Failed to notify backend of video completion for run {processing_run_id}: {comp_err}")
                if comp_attempt < 3:
                    time.sleep(0.5 * comp_attempt)

            if not comp_success:
                raise RuntimeError(f"Backend completion callback failed after 3 attempts for run {processing_run_id}: {last_comp_err}")

        models_exec = ["YOLOv8s-Vehicle", "ByteTrack", "EasyOCR", "ColorClassifier", "ReIdService"]
        if enable_dehaze:
            models_exec.append("DCP-Dehazer")

        # Safe Acknowledgement: Called ONLY after processing AND backend synchronization succeed
        _run_async(
            redis_service.acknowledge_job(
                job_id,
                success=True,
                stream_msg_id=stream_msg_id,
                details={
                    "camera_id": camera_id,
                    "video_path": video_path,
                    "frames_processed": frames_processed,
                    "detections_count": len(detections),
                    "tracks_count": len(observations),
                    "synced_to_backend": len(detections),
                    "dcp_enabled": enable_dehaze,
                    "dcp_applied": enable_dehaze,
                    "models_executed": models_exec,
                    "models_skipped": [] if enable_dehaze else ["DCP-Dehazer"],
                    "duration_seconds": round(elapsed, 2),
                    "fps": fps,
                },
            )
        )
        logger.info(f"Video job {job_id} COMPLETED and acknowledged in {elapsed:.1f}s ({frames_processed} frames, {len(detections)} detections)")
    except StaleWorkerRunSupersededException as e:
        logger.info(f"Video job {job_id} aborted cleanly: {e}")
        _run_async(
            redis_service.acknowledge_job(
                job_id,
                success=False,
                stream_msg_id=stream_msg_id,
                details={
                    "camera_id": camera_id,
                    "status": "CANCELLED_SUPERSEDED",
                    "reason": str(e),
                    "aborted_at": time.time(),
                },
            )
        )
        return
    except Exception as exc:
        logger.error(f"Video job {job_id} FAILED: {exc}", exc_info=True)
        if video_upload_id:
            try:
                import requests
                backend_url = os.environ.get("BACKEND_URL", "http://localhost:8080")
                ingest_user, ingest_pass = _required_ingestion_credentials()
                requests.post(
                    f"{backend_url}/api/videos/{video_upload_id}/complete",
                    json={
                        "processing_run_id": processing_run_id,
                        "frames_processed": 0,
                        "detections_count": 0,
                        "duration_seconds": 0.0,
                        "manifest_path": None,
                        "manifest_sha256": None,
                        "error": str(exc),
                    },
                    auth=(ingest_user, ingest_pass),
                    timeout=10,
                )
            except Exception as e:
                logger.warning(f"Failed to notify backend of video failure: {e}")

        _run_async(
            redis_service.acknowledge_job(
                job_id,
                success=False,
                stream_msg_id=stream_msg_id,
                details={
                    "camera_id": camera_id,
                    "error": str(exc),
                },
            )
        )
    finally:
        heartbeat.stop()
        _active_jobs.discard(job_id)
        try:
            _run_async(redis_service.release_dispatch_lock(job_id))
        except Exception:
            pass

def _run_claimed_video_job(job_id: str, fields: Dict[str, Any], stream_msg_id: Optional[str], consumer_id: str) -> None:
    with materialize_video(
        storage_provider=str(fields.get("storage_provider") or "LOCAL"),
        video_path=fields.get("video_path"),
        storage_bucket=fields.get("storage_bucket"),
        storage_key=fields.get("storage_key"),
    ) as video_path:
        _run_video_job(
            job_id,
            video_path,
            str(fields["camera_id"]),
            fields.get("start_time") or None,
            int(fields.get("frame_stride") or 5),
            str(fields.get("enable_dehaze", "false")).lower() == "true",
            fields.get("video_upload_id") or None,
            fields.get("processing_run_id") or None,
            int(fields["run_number"]) if fields.get("run_number") else None,
            stream_msg_id,
            consumer_id,
        )


app = FastAPI(
    title="City AI ANPR Trajectory & Urban Traffic Intelligence Engine (SIH26127 BEL)",
    version="2.0.0",
    description="Bharat Electronics Limited (BEL) City-Wide Multi-Camera ANPR Trajectory & GIS Analytics System.",
)

# CORS: restrict to the actual browser client origins instead of "*".
# The frontend calls this service directly from the browser, so its origin
# must be allowed; everything else is denied. Override with
# FRONTEND_CORS_ORIGINS (comma-separated) for other deployments.
_allowed_origins = [
    o.strip() for o in os.environ.get(
        "FRONTEND_CORS_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000",
    ).split(",") if o.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_pipeline: Optional[VideoPipeline] = None
_orchestrator: Optional[MultiCameraOrchestrator] = None
_model_artifact_status: Dict[str, Any] = {"status": "NOT_REQUIRED"}
_queue_worker_tasks: List[asyncio.Task] = []
_worker_heartbeat_task: Optional[asyncio.Task] = None
_queue_worker_stop = asyncio.Event()
_worker_instance_id = f"{os.environ.get('HOSTNAME', 'ai-worker')}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def _configured_queue_worker_count() -> int:
    try:
        count = int(os.environ.get("AI_QUEUE_WORKER_CONCURRENCY", "1"))
    except ValueError as exc:
        raise RuntimeError("AI_QUEUE_WORKER_CONCURRENCY must be a positive integer") from exc
    if count < 1 or count > 32:
        raise RuntimeError("AI_QUEUE_WORKER_CONCURRENCY must be between 1 and 32")
    return count


def _queue_workers_enabled() -> bool:
    return os.environ.get("AI_ENABLE_QUEUE_WORKERS", "true").strip().lower() in {"true", "1", "yes"}


async def run_queue_workers() -> None:
    """Run the configured consumer pool until shutdown is requested."""
    global _queue_worker_tasks, _worker_heartbeat_task
    _queue_worker_stop.clear()
    _queue_worker_tasks = [
        asyncio.create_task(_consume_video_jobs(index + 1), name=f"video-job-consumer-{index + 1}")
        for index in range(_configured_queue_worker_count())
    ]
    _worker_heartbeat_task = asyncio.create_task(_publish_worker_heartbeat(), name="ai-worker-heartbeat")
    try:
        await asyncio.gather(*_queue_worker_tasks)
    finally:
        _queue_worker_stop.set()
        if _worker_heartbeat_task:
            await asyncio.gather(_worker_heartbeat_task, return_exceptions=True)
            _worker_heartbeat_task = None
        _queue_worker_tasks.clear()


async def _publish_worker_heartbeat() -> None:
    """Keep a Redis TTL key alive so API readiness can detect a missing worker service."""
    while not _queue_worker_stop.is_set():
        try:
            await redis_service.publish_worker_heartbeat(
                _worker_instance_id,
                {"consumer_count": len(_queue_worker_tasks), "model_artifacts": _model_artifact_status.get("status")},
                ttl_seconds=30,
            )
        except Exception as exc:
            logger.warning("Unable to publish AI worker heartbeat (%s)", type(exc).__name__)
        try:
            await asyncio.wait_for(_queue_worker_stop.wait(), timeout=10)
        except asyncio.TimeoutError:
            pass
    try:
        await redis_service.clear_worker_heartbeat(_worker_instance_id)
    except Exception as exc:
        logger.warning("Unable to clear AI worker heartbeat during shutdown (%s)", type(exc).__name__)


def stop_queue_workers() -> None:
    _queue_worker_stop.set()


def verify_worker_model_runtime() -> Dict[str, Any]:
    global _model_artifact_status
    if not model_manifest_required():
        _model_artifact_status = {"status": "NOT_REQUIRED"}
        return _model_artifact_status
    manifest_status = verify_model_manifest()
    loaded_models = verify_inference_models_load()
    expected = {"vehicle_detector", "plate_detector", "ocr", "reid"}
    if set(loaded_models) != expected:
        raise RuntimeError("The production model bundle did not initialize every required inference model")
    _model_artifact_status = {"status": "VERIFIED", **manifest_status, "runtimeModelsLoaded": loaded_models}
    return _model_artifact_status


async def _consume_video_jobs(worker_number: int) -> None:
    """Claim durable video jobs and run inference away from the ASGI event loop."""
    consumer_id = f"{os.environ.get('HOSTNAME', 'ai-worker')}:{os.getpid()}:{worker_number}"
    logger.info("Starting Redis video-job consumer %s", consumer_id)
    while not _queue_worker_stop.is_set():
        try:
            claimed = await redis_service.claim_job(consumer_id=consumer_id)
            if not claimed:
                await asyncio.sleep(0.1)
                continue

            fields = claimed.get("fields") or {}
            try:
                envelope = json.loads(fields.get("payload_json") or "{}")
            except (TypeError, json.JSONDecodeError):
                envelope = {}
            details = envelope.get("details") if isinstance(envelope, dict) else None
            if isinstance(details, dict):
                fields = {**fields, **details}
            job_id = str(claimed["job_id"])
            video_path = fields.get("video_path")
            camera_id = fields.get("camera_id")
            storage_provider = str(fields.get("storage_provider") or "LOCAL").upper()
            has_local_media = storage_provider == "LOCAL" and bool(video_path)
            has_s3_media = storage_provider == "S3" and bool(fields.get("storage_bucket")) and bool(fields.get("storage_key"))
            if not camera_id or not (has_local_media or has_s3_media):
                await redis_service.acknowledge_job(
                    job_id,
                    success=False,
                    stream_msg_id=claimed.get("stream_msg_id"),
                    details={"error": "Queued job is missing a valid media reference or camera_id"},
                )
                continue

            _active_jobs.add(job_id)
            try:
                await asyncio.to_thread(
                    _run_claimed_video_job,
                    job_id,
                    fields,
                    claimed.get("stream_msg_id"),
                    consumer_id,
                )
            finally:
                _active_jobs.discard(job_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Video-job consumer %s encountered an error", consumer_id)
            await asyncio.sleep(1.0)


@app.on_event("startup")
async def on_startup():
    global _model_artifact_status, _queue_worker_tasks, _worker_heartbeat_task
    _queue_worker_stop.clear()
    set_main_event_loop(asyncio.get_running_loop())
    await redis_service.initialize()
    _model_artifact_status = verify_worker_model_runtime()
    if _queue_workers_enabled():
        _queue_worker_stop.clear()
        _queue_worker_tasks = [
            asyncio.create_task(_consume_video_jobs(index + 1), name=f"video-job-consumer-{index + 1}")
            for index in range(_configured_queue_worker_count())
        ]
        _worker_heartbeat_task = asyncio.create_task(_publish_worker_heartbeat(), name="ai-worker-heartbeat")


@app.on_event("shutdown")
async def on_shutdown():
    global _worker_heartbeat_task
    stop_queue_workers()
    tasks = list(_queue_worker_tasks)
    _queue_worker_tasks.clear()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    if _worker_heartbeat_task:
        await asyncio.gather(_worker_heartbeat_task, return_exceptions=True)
        _worker_heartbeat_task = None


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
        "model_artifacts": _model_artifact_status,
    }


@app.get("/ready")
async def readiness() -> dict:
    redis_info = await redis_service.check_health()
    expected_runtime_models = {"vehicle_detector", "plate_detector", "ocr", "reid"}
    assets_ready = not model_manifest_required() or (
        _model_artifact_status.get("status") == "VERIFIED"
        and set(_model_artifact_status.get("runtimeModelsLoaded", [])) == expected_runtime_models
    )
    redis_ready = redis_info.get("status") == "UP"
    production = os.environ.get("NODE_ENV", "development").lower() == "production"
    worker_count = 0
    try:
        worker_count = len(await redis_service.get_active_worker_heartbeats())
    except Exception:
        logger.warning("Unable to read AI worker heartbeats during readiness check")
    workers_ready = not production or worker_count > 0
    storage_ready = True
    if os.environ.get("STORAGE_PROVIDER", "LOCAL").upper() == "S3":
        try:
            from services.media_storage import validate_s3_reference
            bucket, _ = validate_s3_reference(os.environ.get("S3_BUCKET"), "readiness-check")
            storage_ready = bool(bucket and os.environ.get("AWS_REGION"))
        except (RuntimeError, ValueError):
            storage_ready = False
    if production:
        redis_ready = redis_ready and redis_info.get("durable") is True
    ready = redis_ready and assets_ready and storage_ready and workers_ready
    return {
        "status": "ready" if ready else "not_ready",
        "service": "city-ai-anpr-trajectory-engine",
        "dependencies": {
            "redis": redis_info.get("status", "UNKNOWN"),
            "redisDurable": redis_info.get("durable", False),
            "objectStorage": "CONFIGURED" if storage_ready else "NOT_CONFIGURED",
            "inferenceWorkers": worker_count,
        },
        "modelArtifacts": _model_artifact_status.get("status", "UNKNOWN"),
        "runtimeModels": _model_artifact_status.get("runtimeModelsLoaded", []),
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
) -> Dict[str, Any]:
    """Processes an already-uploaded video associated with an authoritative video_upload_id and processing_run_id."""
    video_path = request.video_path
    video_upload_id = request.video_upload_id
    processing_run_id = request.processing_run_id

    if request.storage_provider == "S3":
        try:
            stored_object = head_s3_object(request.storage_bucket, request.storage_key)
        except (RuntimeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            logger.warning("Unable to verify S3 upload object (%s)", type(exc).__name__)
            raise HTTPException(status_code=503, detail="Unable to verify private media object") from exc
        max_bytes = int(os.environ.get("STORAGE_MAX_FILE_SIZE_MB", "500")) * 1024 * 1024
        if int(stored_object.get("ContentLength") or 0) <= 0 or int(stored_object["ContentLength"]) > max_bytes:
            raise HTTPException(status_code=413, detail="Stored video is empty or exceeds the configured size limit")
    else:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            raise HTTPException(
                status_code=400,
                detail="Unable to open the local recorded video source"
            )
        cap.release()

    job_id = f"job-{processing_run_id}" if processing_run_id else f"job-{uuid.uuid4().hex[:12]}"

    # Job Deduplication: If already active (QUEUED or PROCESSING), return existing job status
    if await redis_service.is_job_active(job_id):
        existing_job = await redis_service.get_job_status(job_id)
        existing_status = existing_job.get("status", "QUEUED") if existing_job else "QUEUED"
        logger.info(
            f"Duplicate dispatch intercepted: job '{job_id}' is already {existing_status}. "
            "Returning active job without starting duplicate worker."
        )
        return {
            "job_id": job_id,
            "video_upload_id": video_upload_id,
            "processing_run_id": processing_run_id,
            "status": existing_status,
            "duplicate_dispatch_prevented": True,
            "camera_id": request.camera_id,
            "video_path": video_path,
            "message": f"Inference pipeline already active for job '{job_id}'. Duplicate dispatch prevented.",
        }

    try:
        enqueued = await redis_service.enqueue_job(
            job_id,
            details={
                "job_id": job_id,
                "video_upload_id": video_upload_id,
                "processing_run_id": processing_run_id,
                "run_number": request.run_number,
                "camera_id": request.camera_id,
                "video_path": video_path,
                "storage_provider": request.storage_provider,
                "storage_bucket": request.storage_bucket,
                "storage_key": request.storage_key,
                "dcp_enabled": request.enable_dehaze,
                "enable_dehaze": request.enable_dehaze,
                "start_time": request.start_time,
                "frame_stride": request.frame_stride,
            },
        )
        if enqueued.get("duplicate_dispatch_prevented"):
            logger.info(
                f"Cross-process duplicate dispatch intercepted for job '{job_id}'. "
                "Returning active job without starting duplicate worker."
            )
            return {
                "job_id": job_id,
                "video_upload_id": video_upload_id,
                "processing_run_id": processing_run_id,
                "status": enqueued.get("status", "QUEUED"),
                "duplicate_dispatch_prevented": True,
                "camera_id": request.camera_id,
                "video_path": video_path,
                "message": f"Cross-process lock active for job '{job_id}'. Duplicate dispatch prevented.",
            }
    except RuntimeError as re:
        logger.error(f"Queue durability violation for job {job_id}: {re}")
        raise HTTPException(
            status_code=503,
            detail=str(re),
        )

    return {
        "job_id": job_id,
        "video_upload_id": video_upload_id,
        "processing_run_id": processing_run_id,
        "status": "QUEUED",
        "camera_id": request.camera_id,
        "video_path": video_path,
        "storage_provider": request.storage_provider,
        "message": f"Video upload '{video_upload_id}' queued for inference.",
    }


@app.post("/upload-video")
async def upload_video_endpoint(
    file: UploadFile = File(...),
    camera_id: str = Form(...),
    enable_dehaze: bool = Form(False),
    start_time: Optional[str] = Form(None),
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
    max_upload_mb = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "500"))
    if len(content_bytes) > max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Video file exceeds {max_upload_mb}MB limit.")

    with open(save_path, "wb") as f:
        f.write(content_bytes)

    try:
        await redis_service.enqueue_job(
            job_id,
            details={
                "camera_id": camera_id,
                "filename": filename,
                "video_path": str(save_path),
                "size_bytes": len(content_bytes),
                "dcp_enabled": enable_dehaze,
                "enable_dehaze": enable_dehaze,
                "start_time": start_time,
                "frame_stride": frame_stride,
            },
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

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
    enable_dehaze: bool = False,
    start_time: Optional[str] = None,
    frame_stride: int = 5,
) -> Dict[str, Any]:
    """Queues recorded demo footage for processing by the Redis worker pool."""
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
    try:
        await redis_service.enqueue_job(
            job_id,
            details={
                "camera_id": camera_id,
                "video_path": str(video_path),
                "dcp_enabled": enable_dehaze,
                "enable_dehaze": enable_dehaze,
                "start_time": start_time,
                "frame_stride": frame_stride,
            },
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    return {
        "job_id": job_id,
        "status": "QUEUED",
        "camera_id": camera_id,
        "video_path": str(video_path),
        "message": f"Recorded demo video for '{camera_id}' queued for processing.",
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
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
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


def _public_detection_plate_fields(detected_plate: Optional[str]) -> Dict[str, Any]:
    """Avoid returning OCR text from the public image-detection endpoint."""
    return {"plate_text": None, "plate_detected": bool(detected_plate)}
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
            if p_detector.model is not None:
                p_out: Any = p_detector.model.predict(frame, conf=0.15, verbose=False)
                if p_out and len(p_out) > 0:
                    p_res: Any = p_out[0]
                    if getattr(p_res, "boxes", None) is not None and len(p_res.boxes) > 0:
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
                            "plate": None,
                            "plate_detected": bool(detected_plate),
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
            if v_tracker.model is not None:
                v_out: Any = v_tracker.model.predict(frame, classes=[2, 3, 5, 7], conf=0.20, verbose=False)
                if v_out and len(v_out) > 0:
                    v_res: Any = v_out[0]
                    if getattr(v_res, "boxes", None) is not None and len(v_res.boxes) > 0:
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
                                    "plate": None,
                                    "plate_detected": bool(detected_plate),
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


