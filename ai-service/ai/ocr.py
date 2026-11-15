"""
OCR service for license plate text extraction.

Pipeline per plate crop:
  1. Enhance via PlatePreprocessor (CLAHE, denoise, sharpen)
  2. EasyOCR text detection + recognition
  3. Prefer plausible Indian plate items before concatenated text to reject watermarks
  4. Sort results left-to-right and concatenate if needed
  5. Apply Indian plate character correction (O/0, I/1, S/5, B/8, Z/2, G/6 confusables)
  6. Validate against standard Indian RTO format and Bharat Series (BH)
  7. Confidence scoring and uncertainty flagging

Multi-frame fusion:
  fuse_readings() takes a list of OcrResult from multiple frames of the
  same tracked vehicle and returns a single best-guess result using
  per-character confidence-weighted majority voting.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import easyocr
import numpy as np

from ai.plate_preprocessor import PlatePreprocessor
from config import cfg
from utils.plate_normalizer import (
    normalize_plate,
    is_plausible_indian_plate,
    INDIAN_STATE_CODES,
)

validate_plate_format = is_plausible_indian_plate

logger = logging.getLogger(__name__)

# ─── Character correction for Indian license plates ──────────────────────────
# Common OCR confusables by position type in Indian embossed fonts:
_DIGIT_TO_CHAR = {
    "0": "O", "1": "I", "2": "Z", "4": "A", "5": "S", "6": "G", "7": "T", "8": "B"
}
_CHAR_TO_DIGIT = {
    "O": "0", "D": "0", "Q": "0", "I": "1", "L": "1", "Z": "2", "A": "4", "S": "5", "G": "6", "T": "7", "B": "8"
}

# Strict standard Indian pattern: SS DD LL(L) DDDD where DD is 2 digits
_STRICT_STD_RE = re.compile(r"^([A-Z]{2})(\d{2})([A-Z]{1,2})(\d{3,4})$")
_DL_STD_RE = re.compile(r"^(DL)(\d{1,2})([A-Z]{1,3})(\d{3,4})$")
# Bharat Series syntax: YY BH #### XX
_BH_SERIES_RE = re.compile(r"^(\d{2})BH(\d{4})([A-Z]{1,2})$")


def _correct_indian_plate(text: str) -> str:
    """
    Apply position-aware OCR character correction for Indian plates.

    Handles:
      1. Bharat Series (BH): YY BH #### XX
      2. Standard Indian plates: SS DD LL(L) DDDD (lengths 8-11)
      3. Confusable disambiguation: O/0, I/1, Z/2, S/5, G/6, B/8
    """
    if not text:
        return text

    normalized = normalize_plate(text)
    n = len(normalized)
    if n < 6:
        return normalized

    # 1. Check if already matching clean standard or BH pattern
    if _BH_SERIES_RE.match(normalized):
        return normalized

    if _STRICT_STD_RE.match(normalized) and normalized[:2] in INDIAN_STATE_CODES:
        return normalized

    if _DL_STD_RE.match(normalized):
        return normalized

    corrected = list(normalized)

    # 2. Check for Bharat Series (BH)
    # Pattern: 2 Digits + "BH" (or misread "8H"/"B#") + 4 Digits + 1-2 Letters
    is_bh_candidate = (
        n in (9, 10)
        and (
            normalized[2:4] in ("BH", "8H", "88", "B#")
            or (normalized[:2].isdigit() and normalized[3:4] == "H")
        )
    )
    if is_bh_candidate:
        # Pos 0-1: Year digits
        for i in range(2):
            if corrected[i] in _CHAR_TO_DIGIT:
                corrected[i] = _CHAR_TO_DIGIT[corrected[i]]
        # Pos 2-3: Letters "BH"
        corrected[2] = "B"
        corrected[3] = "H"
        # Pos 4-7: 4 digits
        for i in range(4, min(8, n)):
            if corrected[i] in _CHAR_TO_DIGIT:
                corrected[i] = _CHAR_TO_DIGIT[corrected[i]]
        # Pos 8-9: Series letters
        for i in range(8, n):
            if corrected[i] in _DIGIT_TO_CHAR:
                corrected[i] = _DIGIT_TO_CHAR[corrected[i]]
        return "".join(corrected)

    # 3. Standard Indian plates (lengths 8 through 11)
    # Pos 0-1: State code (must be letters)
    for i in range(min(2, n)):
        if corrected[i] in _DIGIT_TO_CHAR:
            corrected[i] = _DIGIT_TO_CHAR[corrected[i]]

    # Pos 2: District digit (must be digit)
    if n > 2 and corrected[2] in _CHAR_TO_DIGIT:
        corrected[2] = _CHAR_TO_DIGIT[corrected[2]]

    # Pos 3: District digit (must be digit in 2-digit RTO states outside Delhi)
    state = "".join(corrected[:2])
    if state != "DL" and n >= 8:
        if corrected[3] in _CHAR_TO_DIGIT:
            corrected[3] = _CHAR_TO_DIGIT[corrected[3]]
    elif n >= 9:
        if corrected[4].isalpha() and corrected[3] in _CHAR_TO_DIGIT:
            corrected[3] = _CHAR_TO_DIGIT[corrected[3]]

    # Last 3 to 4 characters: Registration number digits
    num_digits = 4 if n >= 10 else min(4, n - 4)
    start_num = max(n - num_digits, 4)
    for i in range(start_num, n):
        if corrected[i] in _CHAR_TO_DIGIT:
            corrected[i] = _CHAR_TO_DIGIT[corrected[i]]

    # Series letters between district and number
    for i in range(4, start_num):
        if corrected[i] in _DIGIT_TO_CHAR:
            corrected[i] = _DIGIT_TO_CHAR[corrected[i]]

    return "".join(corrected)


# ─── Result types ─────────────────────────────────────────────────────────────

@dataclass
class OcrResult:
    raw_text: str
    corrected_text: str          # after character correction
    normalized_text: str         # after full normalization
    confidence: float
    is_uncertain: bool = False
    is_plausible_indian: bool = False


# ─── OCR service ─────────────────────────────────────────────────────────────

class OCRService:
    """EasyOCR-based plate OCR with preprocessing and character correction."""

    def __init__(self):
        oc = cfg.ocr
        reader_kwargs: dict = {
            "gpu": oc.use_gpu,
            "verbose": False,
        }
        # Wire the bundled weights when present (models/easyocr/craft_mlt_25k.pth +
        # english_g2.pth). EasyOCR otherwise defaults to ~/.EasyOCR and re-downloads
        # on first use. Verify both files before switching so a partial bundle
        # cannot break the reader.
        if oc.model_storage_dir is not None:
            model_dir = Path(oc.model_storage_dir)
            detector_w = model_dir / "craft_mlt_25k.pth"
            recognizer_w = model_dir / "english_g2.pth"
            if detector_w.exists() and recognizer_w.exists():
                reader_kwargs["model_storage_directory"] = str(model_dir)
                reader_kwargs["download_enabled"] = False
                logger.info("EasyOCR using bundled weights from %s", model_dir)
            else:
                logger.warning(
                    "Bundled EasyOCR weights incomplete at %s (detector=%s, recognizer=%s); "
                    "falling back to default EasyOCR storage",
                    model_dir, detector_w.exists(), recognizer_w.exists(),
                )
        self.reader = easyocr.Reader(
            list(oc.languages),
            **reader_kwargs,
        )
        self.preprocessor = PlatePreprocessor()
        self._min_conf = oc.min_confidence
        self._uncertain_threshold = oc.uncertain_threshold
        self._min_plate_w = oc.min_plate_width
        self._min_plate_h = oc.min_plate_height

    def read_plate(self, plate_crop_bgr: np.ndarray) -> OcrResult | None:
        """
        Read text from a single plate crop.

        Applies preprocessing first. Returns None if no text detected or
        confidence too low.
        """
        if plate_crop_bgr is None or plate_crop_bgr.size == 0:
            return None

        h, w = plate_crop_bgr.shape[:2]
        if w < self._min_plate_w or h < self._min_plate_h:
            return None

        # Run OCR: try raw image first, fallback to enhanced
        results: list[Any] = []
        try:
            raw_res: Any = self.reader.readtext(plate_crop_bgr)
            results = list(raw_res) if raw_res else []
        except Exception:
            results = []

        if not results or (results and max((float(r[2]) for r in results), default=0.0) < self._min_conf):
            try:
                enhanced = self.preprocessor.enhance(plate_crop_bgr)
                enh_raw: Any = self.reader.readtext(enhanced)
                enh_results: list[Any] = list(enh_raw) if enh_raw else []
                if enh_results and (not results or max(float(r[2]) for r in enh_results) > max(float(r[2]) for r in results)):
                    results = enh_results
            except Exception:
                pass

        if not results:
            return None

        # Prefer plausible individual plate items (filters out frame watermarks, camera labels, etc.)
        for r in results:
            item_text = r[1].strip()
            item_conf = float(r[2])
            if item_conf >= self._min_conf:
                item_corr = _correct_indian_plate(item_text.upper().replace(" ", ""))
                item_norm = normalize_plate(item_corr)
                if is_plausible_indian_plate(item_norm):
                    return OcrResult(
                        raw_text=item_text,
                        corrected_text=item_corr,
                        normalized_text=item_norm,
                        confidence=item_conf,
                        is_uncertain=item_conf < self._uncertain_threshold,
                        is_plausible_indian=True,
                    )

        # Fallback: Sort by left x coordinate (left-to-right reading order) and concatenate
        results.sort(key=lambda r: float(r[0][0][0]))
        raw_text = " ".join(str(r[1]) for r in results).strip()
        avg_conf = sum(float(r[2]) for r in results) / len(results)

        if not raw_text or avg_conf < self._min_conf:
            return None

        corrected = _correct_indian_plate(raw_text.upper().replace(" ", ""))
        normalized = normalize_plate(corrected)

        return OcrResult(
            raw_text=raw_text,
            corrected_text=corrected,
            normalized_text=normalized,
            confidence=float(avg_conf),
            is_uncertain=float(avg_conf) < self._uncertain_threshold,
            is_plausible_indian=is_plausible_indian_plate(normalized),
        )

    def fuse_readings(self, readings: list[OcrResult]) -> OcrResult | None:
        """
        Fuse multiple OCR readings from different frames of the same tracked
        vehicle into a single best-guess result.

        Strategy:
          1. Filter usable readings with non-empty normalized text.
          2. Check for high-confidence plausible Indian pattern winner.
          3. Position-wise confidence-weighted majority voting across all frames.
          4. Apply syntax correction to the fused consensus.
        """
        if not readings:
            return None

        # Filter to usable readings
        usable = [r for r in readings if r.normalized_text]
        if not usable:
            return None

        # Check for a high-confidence, plausible-format winner
        plausible = [r for r in usable if r.is_plausible_indian and not r.is_uncertain]
        if plausible:
            counts = Counter(r.normalized_text for r in plausible)
            best_text, _ = counts.most_common(1)[0]
            matching = [r for r in plausible if r.normalized_text == best_text]
            best = max(matching, key=lambda r: r.confidence)
            return best

        # Per-character confidence-weighted majority voting
        max_len = max(len(r.normalized_text) for r in usable)
        voted_chars = []
        for i in range(max_len):
            weighted: dict[str, float] = {}
            for r in usable:
                if i < len(r.normalized_text):
                    c = r.normalized_text[i]
                    weighted[c] = weighted.get(c, 0.0) + r.confidence
            if weighted:
                voted_chars.append(max(weighted, key=lambda k: weighted[k]))
            else:
                voted_chars.append("?")

        fused_raw = "".join(voted_chars).replace("?", "")
        if not fused_raw:
            return max(usable, key=lambda r: r.confidence)

        corrected = _correct_indian_plate(fused_raw)
        normalized = normalize_plate(corrected)
        avg_conf = sum(r.confidence for r in usable) / len(usable)

        return OcrResult(
            raw_text=fused_raw,
            corrected_text=corrected,
            normalized_text=normalized,
            confidence=float(avg_conf),
            is_uncertain=float(avg_conf) < self._uncertain_threshold,
            is_plausible_indian=is_plausible_indian_plate(normalized),
        )
