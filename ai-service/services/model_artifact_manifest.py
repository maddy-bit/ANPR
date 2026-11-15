"""Fail-closed validation for immutable production inference model bundles."""

from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path
from typing import Any


REQUIRED_ARTIFACTS = {
    "vehicle_detector": ("yolov8s.pt",),
    "plate_detector": ("plate_detector_yolov8n.pt",),
    "reid": ("veri_sbs_R50-ibn.pth",),
    "ocr_detector": ("easyocr/craft_mlt_25k.pth",),
    "ocr_recognizer": ("easyocr/english_g2.pth",),
}
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$", re.IGNORECASE)


class ModelManifestError(ValueError):
    """Raised when a production model artifact bundle is incomplete or untrusted."""


def model_manifest_required() -> bool:
    return os.environ.get("AI_REQUIRE_MODEL_MANIFEST", "false").lower() == "true"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as model_file:
        for chunk in iter(lambda: model_file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_model_manifest(
    manifest_path: str | Path | None = None,
    model_root: str | Path | None = None,
) -> dict[str, Any]:
    root_value = model_root or os.environ.get("MODEL_CACHE_DIR")
    if not root_value:
        raise ModelManifestError("MODEL_CACHE_DIR must identify the mounted model bundle")
    try:
        root = Path(root_value).resolve(strict=True)
    except OSError:
        raise ModelManifestError("MODEL_CACHE_DIR does not exist or cannot be accessed") from None
    if not root.is_dir():
        raise ModelManifestError("MODEL_CACHE_DIR must be a directory")

    manifest_file = Path(manifest_path or os.environ.get("AI_MODEL_MANIFEST", root / "model-manifest.json"))
    try:
        manifest_file = manifest_file.resolve(strict=True)
        manifest_file.relative_to(root)
    except (OSError, ValueError):
        raise ModelManifestError("AI_MODEL_MANIFEST must be a file inside MODEL_CACHE_DIR") from None

    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        raise ModelManifestError("AI_MODEL_MANIFEST is unreadable or invalid JSON") from None
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != 1:
        raise ModelManifestError("AI_MODEL_MANIFEST schemaVersion must be 1")
    release_id = manifest.get("releaseId")
    entries = manifest.get("artifacts")
    if not isinstance(release_id, str) or not release_id.strip() or not isinstance(entries, list):
        raise ModelManifestError("Manifest requires a releaseId and artifacts array")

    by_name: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get("name"), str):
            raise ModelManifestError("Every model artifact must have a name")
        name = entry["name"]
        if name in by_name:
            raise ModelManifestError(f"Duplicate model artifact: {name}")
        by_name[name] = entry

    verified: list[dict[str, str]] = []
    for name, (relative_path,) in REQUIRED_ARTIFACTS.items():
        entry = by_name.get(name)
        if not entry:
            raise ModelManifestError(f"Required model artifact is missing: {name}")
        version = entry.get("version")
        expected_hash = entry.get("sha256")
        if not isinstance(version, str) or not version.strip() or not isinstance(expected_hash, str) or not SHA256_PATTERN.fullmatch(expected_hash):
            raise ModelManifestError(f"Artifact {name} requires a version and 64-character SHA-256")
        candidate = root / relative_path
        if any(parent.is_symlink() for parent in (candidate, *candidate.parents) if parent != root.parent):
            raise ModelManifestError(f"Artifact path contains a symbolic link: {name}")
        try:
            asset = candidate.resolve(strict=True)
        except OSError:
            raise ModelManifestError(f"Required model artifact is unavailable: {name}") from None
        try:
            asset.relative_to(root)
        except ValueError:
            raise ModelManifestError(f"Artifact path escapes MODEL_CACHE_DIR: {name}") from None
        if not asset.is_file():
            raise ModelManifestError(f"Artifact is not a regular file: {name}")
        if _sha256_file(asset).lower() != expected_hash.lower():
            raise ModelManifestError(f"SHA-256 mismatch for model artifact: {name}")
        if name == "reid":
            from config import cfg
            if expected_hash.lower() != cfg.models.reid_expected_sha256.lower():
                raise ModelManifestError("Re-ID manifest hash differs from the source-verified model checksum")
        if Path(relative_path).as_posix() != Path(entry.get("path", "")).as_posix():
            raise ModelManifestError(f"Manifest path does not match configured artifact: {name}")
        verified.append({"name": name, "version": version, "sha256": expected_hash.lower()})

    return {"releaseId": release_id.strip(), "verifiedArtifacts": verified}


def verify_inference_models_load() -> list[str]:
    """Load model objects once, without opening media or running inference."""
    loaded: list[str] = []

    from ai.tracker import VehicleTracker
    from ai.plate_detector import PlateDetector
    from ai.ocr import OCRService
    from ai.reid import ReIdService

    vehicle_tracker = VehicleTracker("MODEL_READINESS_CHECK")
    loaded.append("vehicle_detector")
    del vehicle_tracker

    plate_detector = PlateDetector()
    if plate_detector.model is None:
        raise ModelManifestError("Plate detector artifact passed checksum but failed to load")
    loaded.append("plate_detector")
    del plate_detector

    ocr_service = OCRService()
    loaded.append("ocr")
    del ocr_service

    reid_service = ReIdService()
    if reid_service.extractor is None:
        raise ModelManifestError("Re-ID artifact passed checksum but failed to load")
    loaded.append("reid")
    del reid_service

    return loaded
