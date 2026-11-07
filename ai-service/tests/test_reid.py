"""
Tests for FastReID Vehicle Re-ID feature extractor and service.

Verifies:
1. Checkpoint hash verification (valid hash, mismatch failure, missing file failure).
2. 2048-dimensional L2-normalized feature extraction.
3. Deterministic inference across multiple runs on identical crops.
4. Model provenance metadata (model_name, model_version, dimension).
5. Strict failure on missing/invalid checkpoint without silent fallback.
6. Rejection of comparisons between incompatible embedding models/versions.
"""

import hashlib
import tempfile
from pathlib import Path
import pytest
import numpy as np
import cv2

from config import cfg
from ai.reid import (
    ReIdService,
    ReIdEmbedding,
    FastReIdExtractor,
    verify_checkpoint_hash,
)

EXPECTED_SHA256 = cfg.models.reid_expected_sha256
CHECKPOINT_PATH = cfg.models.reid_model


def test_checkpoint_hash_verification_success():
    """Verify that the genuine checkpoint matches the expected SHA-256 hash."""
    assert CHECKPOINT_PATH.exists(), f"Checkpoint not found at {CHECKPOINT_PATH}"
    result = verify_checkpoint_hash(CHECKPOINT_PATH, EXPECTED_SHA256)
    assert result is True


def test_checkpoint_hash_verification_missing_file():
    """Verify that a missing checkpoint path raises FileNotFoundError."""
    non_existent = Path("models/does_not_exist.pth")
    with pytest.raises(FileNotFoundError) as exc_info:
        verify_checkpoint_hash(non_existent, EXPECTED_SHA256)
    assert "not found" in str(exc_info.value).lower()


def test_checkpoint_hash_verification_corrupted_file():
    """Verify that an altered/corrupted checkpoint raises ValueError."""
    with tempfile.NamedTemporaryFile(suffix=".pth", delete=False) as tmp:
        tmp.write(b"corrupted checkpoint bytes 1234567890")
        tmp_path = Path(tmp.name)

    try:
        with pytest.raises(ValueError) as exc_info:
            verify_checkpoint_hash(tmp_path, EXPECTED_SHA256)
        assert "mismatch" in str(exc_info.value).lower()
    finally:
        if tmp_path.exists():
            tmp_path.unlink()


def test_fastreid_embedding_dimensions_and_normalization():
    """Verify that FastReID produces 2048-dim float32 L2-normalized embeddings."""
    reid = ReIdService(model_path=CHECKPOINT_PATH, expected_sha256=EXPECTED_SHA256)

    # Synthetic vehicle crop (120x80 BGR)
    crop = np.zeros((120, 80, 3), dtype=np.uint8)
    crop[20:100, 10:70] = [180, 50, 50]  # Blue-ish vehicle body

    emb = reid.embed(crop)
    assert emb is not None
    assert isinstance(emb, ReIdEmbedding)
    assert emb.vector.shape == (2048,)
    assert emb.vector.dtype == np.float32

    # L2 norm must be 1.0 within numerical precision
    norm = float(np.linalg.norm(emb.vector))
    assert abs(norm - 1.0) < 1e-4

    # Provenance metadata
    assert emb.model_name == "fastreid_veri_sbs_r50_ibn"
    assert emb.model_version == "veri-776-v1"
    assert emb.dimension == 2048
    assert emb.is_normalized is True


def test_fastreid_deterministic_inference():
    """Verify that repeated feature extraction on the exact same crop is deterministic."""
    reid = ReIdService(model_path=CHECKPOINT_PATH, expected_sha256=EXPECTED_SHA256)

    crop = np.zeros((100, 100, 3), dtype=np.uint8)
    cv2.rectangle(crop, (15, 15), (85, 85), (200, 200, 200), -1)

    emb1 = reid.embed(crop)
    emb2 = reid.embed(crop)

    assert emb1 is not None and emb2 is not None
    max_diff = float(np.max(np.abs(emb1.vector - emb2.vector)))
    assert max_diff == 0.0, f"Expected deterministic 0.0 difference, got {max_diff}"


def test_no_silent_fallback_on_missing_model():
    """Verify that ReIdService raises an error when checkpoint is missing and fallback is disabled."""
    fake_path = Path("models/missing_checkpoint.pth")
    with pytest.raises(FileNotFoundError):
        ReIdService(model_path=fake_path, allow_fallback=False)


def test_cross_model_comparison_rejection():
    """Verify that comparisons between different model embeddings are strictly rejected."""
    reid = ReIdService(model_path=CHECKPOINT_PATH, expected_sha256=EXPECTED_SHA256)

    # Valid FastReID embedding
    fastreid_vec = np.ones(2048, dtype=np.float32)
    fastreid_vec /= np.linalg.norm(fastreid_vec)
    emb_fastreid = ReIdEmbedding(
        vector=fastreid_vec,
        model_name="fastreid_veri_sbs_r50_ibn",
        model_version="veri-776-v1",
        dimension=2048,
    )

    # Legacy ImageNet embedding (also 2048-dim, but completely different latent space!)
    legacy_vec = np.ones(2048, dtype=np.float32)
    legacy_vec /= np.linalg.norm(legacy_vec)
    emb_legacy_resnet = ReIdEmbedding(
        vector=legacy_vec,
        model_name="resnet50_imagenet",
        model_version="legacy-v0",
        dimension=2048,
    )

    # Legacy HSV embedding (960-dim)
    hsv_vec = np.ones(960, dtype=np.float32)
    hsv_vec /= np.linalg.norm(hsv_vec)
    emb_hsv = ReIdEmbedding(
        vector=hsv_vec,
        model_name="hsv_histogram",
        model_version="legacy-v0",
        dimension=960,
    )

    # Same model should compare successfully
    sim_self = reid.similarity(emb_fastreid, emb_fastreid)
    assert abs(sim_self - 1.0) < 1e-4

    # Different model name must return 0.0
    sim_cross_model = reid.similarity(emb_fastreid, emb_legacy_resnet)
    assert sim_cross_model == 0.0

    # Different dimension must return 0.0
    sim_cross_dim = reid.similarity(emb_fastreid, emb_hsv)
    assert sim_cross_dim == 0.0


def test_invalid_crop_handling():
    """Verify that empty or tiny crops return None rather than raising exceptions."""
    reid = ReIdService(model_path=CHECKPOINT_PATH, expected_sha256=EXPECTED_SHA256)

    assert reid.embed(None) is None
    assert reid.embed(np.array([])) is None
    assert reid.embed(np.zeros((10, 10, 3), dtype=np.uint8)) is None  # below 20x20

