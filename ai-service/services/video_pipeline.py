"""
Camera Agent & Video Processing Pipeline module.

Processes a single video feed for a camera node:
1. Detects & tracks vehicles using YOLOv8s + ByteTrack.
2. Extracts vehicle crops, predicts dominant color & vehicle type.
3. Detects license plates (YOLOv8n LP) & extracts preprocessed OCR text.
4. Computes ResNet50 Re-ID embeddings.
5. Aggregates multi-frame observations per track using MultiFrameFusionService.
"""

from __future__ import annotations
import os
import math
import cv2
import logging
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Set, Optional, Callable, Any

from config import cfg
from schemas import (
    DetectionEvent,
    PlateObservation,
    VehicleObservation,
)
from ai.tracker import VehicleTracker
from ai.plate_detector import PlateDetector
from ai.plate_preprocessor import PlatePreprocessor
from ai.ocr import OCRService
from ai.color_classifier import ColorClassifier
from ai.reid import ReIdService, ReIdEmbedding
from ai.multi_frame_fusion import MultiFrameFusionService
from utils.plate_normalizer import normalize_plate

from ai.dehazer import ImageDehazer

logger = logging.getLogger(__name__)

EVIDENCE_DIR = Path(__file__).resolve().parents[2] / "data" / "evidence"


def normalize_start_time(start_time_iso: Optional[str]) -> datetime:
    """Return a timezone-aware UTC start time; never silently parse local/invalid timestamps."""
    if not start_time_iso:
        # Capture time is unknown. This is a processing-time anchor, not camera-origin time.
        return datetime.now(timezone.utc)

    value = start_time_iso.strip()
    if value.endswith(("Z", "z")):
        value = value[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise ValueError("start_time must be a valid ISO-8601 timestamp") from exc

    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("start_time must include an explicit UTC offset or Z timezone marker")

    return parsed.astimezone(timezone.utc)


class CameraAgent:
    """
    Per-camera processing agent. Isolates state & tracking for a single camera feed.
    """

    def __init__(self, camera_id: str):
        self.camera_id = camera_id
        self.tracker = VehicleTracker(camera_id)
        self.plate_detector = PlateDetector()
        self.plate_preprocessor = PlatePreprocessor()
        self.ocr = OCRService()
        self.color_classifier = ColorClassifier()
        self.reid_service = ReIdService()
        self.fusion_service = MultiFrameFusionService()
        self.dehazer = ImageDehazer()

        self.evidence_dir = EVIDENCE_DIR / camera_id
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

    def process_feed(
        self,
        video_path: str,
        start_time_iso: Optional[str] = None,
        frame_stride: int = int(cfg.FRAME_STRIDE),
        plate_sample_stride: int = int(cfg.PLATE_SAMPLE_STRIDE),
        enable_dehaze: bool = False,
        progress_callback: Optional[Callable[[int, int, Dict[str, Any]], None]] = None,
        video_upload_id: Optional[str] = None,
        processing_run_id: Optional[str] = None,
        writer: Optional[Any] = None,
        batch_sync_callback: Optional[Callable[[List[Any]], Any]] = None,
        max_frames: Optional[int] = None,
    ) -> tuple[int, list[VehicleObservation], list[DetectionEvent]]:
        """
        Process an entire video feed.

        Returns:
            (total_frames_processed, list_of_vehicle_observations, list_of_detection_events)
        """
        if not os.path.isfile(video_path):
            logger.error("Recorded video file not found or not a regular file: %s", video_path)
            raise FileNotFoundError(f"Recorded video file not found: {video_path}")

        cap = cv2.VideoCapture(video_path)
        try:
            if not cap.isOpened():
                raise ValueError(f"Unable to open recorded video file: {video_path}")

            fps = float(cap.get(cv2.CAP_PROP_FPS))
            total_video_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            if not math.isfinite(fps) or fps <= 0:
                raise ValueError(
                    f"Video FPS metadata is missing or invalid for '{video_path}'; "
                    "refusing to invent frame timestamps."
                )
            if total_video_frames <= 0:
                raise ValueError(
                    f"Video frame count is unavailable for '{video_path}'; "
                    "refusing to report a potentially empty/partial analysis."
                )
        finally:
            cap.release()

        start_time = normalize_start_time(start_time_iso)

        # Track accumulators
        track_plates: Dict[int, List[PlateObservation]] = {}
        track_colors: Dict[int, List[str]] = {}
        track_types: Dict[int, List[str]] = {}
        track_reids: Dict[int, List[ReIdEmbedding]] = {}
        track_timestamps: Dict[int, List[float]] = {}
        track_crops: Dict[int, List[str]] = {}
        track_frame_counts: Dict[int, int] = {}

        detection_events: List[DetectionEvent] = []
        pending_sync_batch: List[DetectionEvent] = []
        frames_processed = 0

        logger.info(f"[{self.camera_id}] Starting feed processing: {video_path}")

        for tracked_frame, frame_img in self.tracker.track_video(video_path, frame_stride=frame_stride):
            frames_processed += 1
            if max_frames is not None and frames_processed > max_frames:
                break
            rel_sec = tracked_frame.frame_number / fps

            # Apply Dark Channel Prior (DCP) dehazing if enabled
            if enable_dehaze:
                frame_img = self.dehazer.dehaze(frame_img)
            abs_time = start_time + timedelta(seconds=rel_sec)
            timestamp_sec = rel_sec  # Relative timestamp in video timeline
            abs_time_iso = abs_time.isoformat().replace("+00:00", "Z")

            frame_proposals: List[Dict[str, Any]] = []
            frame_events_meta: List[Dict[str, Any]] = []

            for vehicle in tracked_frame.vehicles:
                tid = vehicle.track_id

                # Initialize track accumulators if new
                if tid not in track_plates:
                    track_plates[tid] = []
                    track_colors[tid] = []
                    track_types[tid] = []
                    track_reids[tid] = []
                    track_timestamps[tid] = []
                    track_crops[tid] = []
                    track_frame_counts[tid] = 0

                count = track_frame_counts[tid]
                track_frame_counts[tid] = count + 1
                track_timestamps[tid].append(timestamp_sec)
                track_types[tid].append(vehicle.vehicle_class)

                # Extract vehicle crop
                x1, y1, x2, y2 = [int(v) for v in vehicle.bbox]
                h_img, w_img = frame_img.shape[:2]
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(w_img, max(x1 + 1, x2)), min(h_img, max(y1 + 1, y2))
                crop = frame_img[y1:y2, x1:x2]

                if crop.size == 0:
                    continue

                # Sample evidence attributes periodically
                if count % plate_sample_stride == 0 or count == 0:
                    # 1. Color Classification
                    color_res = self.color_classifier.classify(crop)
                    color_str = color_res.color if hasattr(color_res, "color") else str(color_res)
                    track_colors[tid].append(color_str)

                    # 2. Re-ID Embedding
                    emb = self.reid_service.embed(crop)
                    if emb:
                        track_reids[tid].append(emb)

                    # 3. License Plate Detection & OCR
                    plates = self.plate_detector.detect(crop)
                    plate_text_raw = None
                    plate_text_norm = None
                    plate_conf = None

                    ocr_res = None
                    plate_crop = None
                    if plates:
                        best_plate = plates[0]
                        px1, py1, px2, py2 = best_plate.bbox
                        plate_crop = crop[py1:py2, px1:px2]
                        ocr_res = self.ocr.read_plate(plate_crop)

                    # Direct crop fallback if no plate box found or reading too low
                    if not ocr_res or ocr_res.confidence < 0.20:
                        direct_ocr = self.ocr.read_plate(crop)
                        if direct_ocr and direct_ocr.confidence >= 0.20:
                            ocr_res = direct_ocr

                    if ocr_res and ocr_res.confidence >= 0.20:
                        plate_text_raw = ocr_res.raw_text
                        plate_text_norm = normalize_plate(ocr_res.raw_text)
                        plate_conf = float(ocr_res.confidence)

                        track_plates[tid].append(
                            PlateObservation(
                                text=ocr_res.raw_text,
                                confidence=plate_conf,
                                frame_number=tracked_frame.frame_number,
                                timestamp=timestamp_sec,
                                crop=plate_crop if count < 2 else None,
                            )
                        )

                    # Save evidence frame
                    crop_filename = f"crop_frame{tracked_frame.frame_number}_track{tid}.jpg"
                    crop_full_path = self.evidence_dir / crop_filename
                    cv2.imwrite(str(crop_full_path), crop)
                    rel_crop_path = f"{self.camera_id}/{crop_filename}"
                    track_crops[tid].append(rel_crop_path)

                    reid_list = emb.vector.tolist() if (emb and hasattr(emb.vector, 'tolist')) else (list(emb.vector) if emb else None)
                    proposal = {
                        "track_id": tid,
                        "bbox": [float(c) for c in vehicle.bbox],
                        "detection_confidence": float(vehicle.confidence),
                        "vehicle_class": str(vehicle.vehicle_class),
                        "plate_text_raw": plate_text_raw,
                        "plate_text_normalized": plate_text_norm,
                        "plate_confidence": plate_conf,
                        "reid_embedding": reid_list,
                        "reid_model_name": emb.model_name if emb else None,
                        "reid_model_version": emb.model_version if emb else None,
                        "reid_dimension": emb.dimension if emb else None,
                        "raw_proposal_index": len(frame_proposals),
                    }
                    frame_proposals.append(proposal)
                    frame_events_meta.append({
                        "tid": tid,
                        "vehicle": vehicle,
                        "plate_text_raw": plate_text_raw,
                        "plate_text_normalized": plate_text_norm,
                        "plate_conf": plate_conf,
                        "rel_crop_path": rel_crop_path,
                        "emb": emb,
                        "reid_list": reid_list,
                    })

            # Stream proposals to manifest writer if active
            if writer is not None:
                start_seq = writer.seq
                writer.append_frame_events(tracked_frame.frame_number, frame_proposals, abs_time_iso)
                for idx, meta in enumerate(frame_events_meta):
                    v = meta["vehicle"]
                    e = meta["emb"]
                    seq_num = start_seq + idx
                    idempotency_key = f"vid:{video_upload_id}:run:{processing_run_id}:seq:{seq_num}" if (video_upload_id and processing_run_id) else None
                    event = DetectionEvent(
                        camera_id=self.camera_id,
                        frame_number=tracked_frame.frame_number,
                        timestamp=abs_time_iso,
                        vehicle_class=v.vehicle_class,
                        detection_confidence=v.confidence,
                        bbox=list(v.bbox),
                        track_id=meta["tid"],
                        plate_text_raw=meta["plate_text_raw"],
                        plate_text_normalized=meta["plate_text_normalized"],
                        plate_confidence=meta["plate_conf"],
                        image_path=meta["rel_crop_path"],
                        # The FastReID extractor emits a normalized embedding but no
                        # per-crop model confidence, so the honest value is None.
                        # A fabricated constant (e.g. 0.85) would invent precision.
                        reid_confidence=None,
                        reid_embedding=meta["reid_list"],
                        reid_model_name=e.model_name if e else None,
                        reid_model_version=e.model_version if e else None,
                        reid_dimension=e.dimension if e else None,
                        video_upload_id=video_upload_id,
                        idempotency_key=idempotency_key,
                        processing_run_id=processing_run_id,
                    )
                    detection_events.append(event)
                    pending_sync_batch.append(event)
            else:
                for meta in frame_events_meta:
                    v = meta["vehicle"]
                    e = meta["emb"]
                    event = DetectionEvent(
                        camera_id=self.camera_id,
                        frame_number=tracked_frame.frame_number,
                        timestamp=abs_time_iso,
                        vehicle_class=v.vehicle_class,
                        detection_confidence=v.confidence,
                        bbox=list(v.bbox),
                        track_id=meta["tid"],
                        plate_text_raw=meta["plate_text_raw"],
                        plate_text_normalized=meta["plate_text_normalized"],
                        plate_confidence=meta["plate_conf"],
                        image_path=meta["rel_crop_path"],
                        # See comment above: no real per-crop ReID confidence exists.
                        reid_confidence=None,
                        reid_embedding=meta["reid_list"],
                        reid_model_name=e.model_name if e else None,
                        reid_model_version=e.model_version if e else None,
                        reid_dimension=e.dimension if e else None,
                        video_upload_id=video_upload_id,
                    )
                    detection_events.append(event)
                    pending_sync_batch.append(event)

            # Progressive batch sync (every 50 events)
            if batch_sync_callback and len(pending_sync_batch) >= 50:
                batch_sync_callback(pending_sync_batch)
                pending_sync_batch = []

            if progress_callback:
                progress_callback(
                    frames_processed,
                    total_video_frames,
                    {
                        "current_frame": tracked_frame.frame_number,
                        "detections_count": len(detection_events),
                        "tracks_count": len(track_timestamps),
                        "dcp_applied": enable_dehaze,
                    }
                )

        # Flush remaining pending detections to backend
        if batch_sync_callback and pending_sync_batch:
            batch_sync_callback(pending_sync_batch)
            pending_sync_batch = []

        # Aggregate tracks into VehicleObservation objects
        vehicle_observations: List[VehicleObservation] = []
        for tid in track_timestamps.keys():
            if not track_timestamps[tid]:
                continue
            obs = self.fusion_service.aggregate_vehicle_observation(
                camera_id=self.camera_id,
                track_id=tid,
                plate_observations=track_plates[tid],
                color_predictions=track_colors[tid],
                type_predictions=track_types[tid],
                reid_embeddings=track_reids[tid],
                timestamps=track_timestamps[tid],
                crop_paths=track_crops[tid],
            )
            vehicle_observations.append(obs)

        logger.info(
            f"[{self.camera_id}] Finished feed processing. Processed {frames_processed} frames, "
            f"aggregated {len(vehicle_observations)} vehicle tracks."
        )

        return frames_processed, vehicle_observations, detection_events


# Backward compatibility wrapper
class VideoPipeline:
    def __init__(self):
        pass

    def process(
        self,
        video_path: str,
        camera_id: str,
        start_time_iso: Optional[str] = None,
        frame_stride: int = int(cfg.FRAME_STRIDE),
        plate_sample_stride: int = int(cfg.PLATE_SAMPLE_STRIDE),
    ) -> tuple[int, list[DetectionEvent]]:
        agent = CameraAgent(camera_id)
        frames, _, events = agent.process_feed(
            video_path, start_time_iso, frame_stride, plate_sample_stride
        )
        return frames, events
