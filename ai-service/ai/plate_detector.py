"""
License plate detection using a YOLOv8n model trained on license plates,
with morphological contour and edge candidate generation fallback.

Two-tier approach:
1. Primary: fine-tuned YOLOv8n (ai-service/models/plate_detector_yolov8n.pt)
   — produced by scripts/train_plate_detector.py
2. Secondary Fallback: Morphological aspect-ratio & horizontal gradient
   candidate extractor for crops where neural detector confidence is borderline.

Interface: detect(vehicle_crop_bgr) -> list[PlateBox]
Input: a vehicle crop (not the full frame)
Output: plate bboxes in vehicle-crop coordinates, sorted by confidence
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from ultralytics import YOLO

from config import cfg

log = logging.getLogger(__name__)


@dataclass
class PlateBox:
    bbox: tuple[int, int, int, int]   # x1, y1, x2, y2 in vehicle-crop pixels
    confidence: float
    # Area as fraction of vehicle crop area (used to filter full-image false labels)
    area_ratio: float = 0.0


def _load_plate_model() -> YOLO | None:
    """
    Load the best available plate detection model.

    Priority:
      1. Fine-tuned model at cfg.models.plate_detector
      2. Pretrained keremberke/yolov8n-license-plate-detection from HF / local
    """
    fine_tuned = Path(cfg.models.plate_detector)
    if fine_tuned.exists():
        log.info(f"Loading fine-tuned plate detector: {fine_tuned}")
        try:
            return YOLO(str(fine_tuned))
        except Exception as e:
            log.warning(f"Failed to load fine-tuned model {fine_tuned}: {e}")

    # Fallback to general yolov8n if available locally
    local_yolo = Path("yolov8n.pt")
    if local_yolo.exists():
        try:
            return YOLO(str(local_yolo))
        except Exception:
            pass

    return None


def _validate_plate_box(
    x: int, y: int, w: int, h: int,
    crop_w: int, crop_h: int,
) -> tuple[bool, float]:
    """
    Validate a detected box is plate-shaped and not a full-image detection.

    Returns (is_valid, area_ratio).
    """
    if w <= 0 or h <= 0:
        return False, 0.0

    area_ratio = (w * h) / max(crop_w * crop_h, 1)

    # Reject if plate covers more than 60% of vehicle crop (false detection)
    if area_ratio > 0.60:
        return False, area_ratio

    # Plates are wider than they are tall (aspect ratio >= 1.2)
    aspect = w / max(h, 1)
    if aspect < 1.1 or aspect > 7.0:
        return False, area_ratio

    # Plate must have a minimum size to be readable
    if w < 24 or h < 8:
        return False, area_ratio

    return True, area_ratio


def _detect_morphological_candidates(vehicle_crop_bgr: np.ndarray) -> list[PlateBox]:
    """
    Fallback: Detect potential license plate bounding boxes using Sobel X-gradient
    and morphological rectangular closing.
    """
    h_img, w_img = vehicle_crop_bgr.shape[:2]
    if h_img < 20 or w_img < 30:
        return []

    # Search primarily in lower 80% of vehicle crop
    roi_y = int(h_img * 0.20)
    roi = vehicle_crop_bgr[roi_y:, :]
    roi_h, roi_w = roi.shape[:2]
    if roi_h < 15 or roi_w < 25:
        return []

    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    sobel = cv2.Sobel(blur, cv2.CV_8U, 1, 0, ksize=3)
    _, thresh = cv2.threshold(sobel, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    element = cv2.getStructuringElement(cv2.MORPH_RECT, (17, 3))
    morph = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, element)
    contours, _ = cv2.findContours(morph, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[PlateBox] = []
    for cnt in contours:
        x, y, w, h = cv2.boundingRect(cnt)
        y_full = y + roi_y
        is_valid, area_ratio = _validate_plate_box(x, y_full, w, h, w_img, h_img)
        if not is_valid:
            continue

        aspect = w / float(max(h, 1))
        # Indian plates typically aspect ratio 2.2 - 5.5
        aspect_score = 1.0 - min(abs(aspect - 3.5) / 3.5, 0.5)
        # Position score: plates usually in bottom 60%
        pos_score = (y_full + h / 2.0) / float(h_img)
        confidence = float(np.clip(0.40 * aspect_score + 0.35 * pos_score + 0.25, 0.30, 0.75))

        candidates.append(
            PlateBox(
                bbox=(x, y_full, x + w, y_full + h),
                confidence=confidence,
                area_ratio=area_ratio,
            )
        )

    candidates.sort(key=lambda p: p.confidence, reverse=True)
    return candidates[:3]


class PlateDetector:
    """
    Detects license plate regions inside vehicle crops using YOLOv8n
    with morphological candidate generation fallback.
    """

    def __init__(self):
        self.model = _load_plate_model()
        self._conf = cfg.detection.plate_confidence_threshold

    def detect(self, vehicle_crop_bgr: np.ndarray) -> list[PlateBox]:
        """
        Detect license plates inside a vehicle crop.

        Args:
            vehicle_crop_bgr: numpy BGR image of a vehicle (output of crop extraction)

        Returns:
            List of PlateBox sorted by confidence (highest first).
            Empty list if no valid plate detected.
        """
        if vehicle_crop_bgr is None or vehicle_crop_bgr.size == 0:
            return []

        crop_h, crop_w = vehicle_crop_bgr.shape[:2]

        # Skip crops that are too small
        if crop_w < cfg.detection.min_vehicle_crop_width or crop_h < cfg.detection.min_vehicle_crop_height:
            return []

        plates: list[PlateBox] = []

        # 1. Primary: YOLO model prediction if available
        if self.model is not None:
            try:
                results = self.model.predict(
                    vehicle_crop_bgr,
                    conf=self._conf,
                    verbose=False,
                )[0]

                if results.boxes is not None and len(results.boxes) > 0:
                    raw_boxes = []
                    raw_scores = []
                    raw_ratios = []

                    for box in results.boxes:
                        x1, y1, x2, y2 = (int(v) for v in box.xyxy[0].tolist())
                        x1 = max(0, min(x1, crop_w - 1))
                        y1 = max(0, min(y1, crop_h - 1))
                        x2 = max(x1 + 1, min(x2, crop_w))
                        y2 = max(y1 + 1, min(y2, crop_h))

                        w, h = x2 - x1, y2 - y1
                        is_valid, area_ratio = _validate_plate_box(x1, y1, w, h, crop_w, crop_h)
                        if not is_valid:
                            continue

                        raw_boxes.append([x1, y1, w, h])
                        raw_scores.append(float(box.conf[0]))
                        raw_ratios.append(area_ratio)

                    if raw_boxes:
                        indices = cv2.dnn.NMSBoxes(
                            raw_boxes,
                            raw_scores,
                            score_threshold=self._conf,
                            nms_threshold=0.35,
                        )
                        for i in indices:
                            idx = i[0] if isinstance(i, (list, tuple, np.ndarray)) else i
                            bx, by, bw, bh = raw_boxes[idx]
                            plates.append(
                                PlateBox(
                                    bbox=(bx, by, bx + bw, by + bh),
                                    confidence=raw_scores[idx],
                                    area_ratio=raw_ratios[idx],
                                )
                            )
            except Exception as exc:
                log.debug(f"YOLO plate detection failed: {exc}")

        # 2. Secondary Fallback: Morphological candidate extraction
        if not plates:
            morph_candidates = _detect_morphological_candidates(vehicle_crop_bgr)
            plates.extend(morph_candidates)

        plates.sort(key=lambda p: p.confidence, reverse=True)
        max_plates = getattr(cfg.detection, "max_plates_per_vehicle", 3)
        return plates[:max_plates]
