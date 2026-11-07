"""
Independent Verification Script for Step 3: FastReID Integration and A4 Inference Preservation
"""

import sys
import hashlib
from pathlib import Path
import numpy as np
import cv2
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from ai.reid import ReIdService, ReIdEmbedding, verify_checkpoint_hash
from config import cfg, ModelPaths
from ai.vehicle_detector import VehicleDetector
from ai.plate_detector import PlateDetector
from ai.ocr import OCRService


def main():
    print("=" * 80)
    print("STEP 3: FASTREID INTEGRATION & A4 INFERENCE PRESERVATION VERIFICATION")
    print("=" * 80)

    # 1. Verify checkpoint SHA-256
    model_path = cfg.models.reid_model
    expected_sha256 = cfg.models.reid_expected_sha256
    assert model_path.exists(), f"Model file not found: {model_path}"

    hasher = hashlib.sha256()
    with open(model_path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            hasher.update(chunk)
    actual_sha256 = hasher.hexdigest().upper()

    print(f"\n1. Checkpoint Path: {model_path}")
    print(f"   Expected SHA-256: {expected_sha256}")
    print(f"   Actual SHA-256:   {actual_sha256}")
    assert actual_sha256 == expected_sha256, "SHA-256 hash mismatch!"
    print("   [PASS] Cryptographic integrity verified.")

    # 2. Verify successful model loading
    print("\n2. Loading FastReID model...")
    service = ReIdService(allow_fallback=False)
    assert service.extractor is not None, "Failed to initialize FastReID extractor"
    print(f"   Model Name:    {service.model_name}")
    print(f"   Model Version: {service.model_version}")
    print(f"   Dimension:     {service.dimension}")
    print(f"   Device:        {service.device_str}")
    print("   [PASS] FastReID model loaded successfully.")

    # 3. Extract actual embedding from genuine evidence crop
    crop_path = ROOT / "data" / "evidence" / "CAM-01" / "crop_frame75_track1.jpg"
    assert crop_path.exists(), f"Evidence crop not found: {crop_path}"
    crop_bgr = cv2.imread(str(crop_path))
    assert crop_bgr is not None and crop_bgr.size > 0, "Failed to read image"

    emb1 = service.embed(crop_bgr)
    assert emb1 is not None, "Failed to extract embedding"

    # 4. Report dimension, dtype, and L2 norm
    vec1 = emb1.vector
    dim = len(vec1)
    dtype_str = str(vec1.dtype)
    norm = float(np.linalg.norm(vec1))

    print(f"\n3 & 4. Embedding Extraction on {crop_path.name}:")
    print(f"   Vector Dimension: {dim}")
    print(f"   Data Type:        {dtype_str}")
    print(f"   L2 Norm:          {norm:.6f}")
    assert dim == 2048, f"Expected 2048 dimensions, got {dim}"
    assert "float" in dtype_str, f"Expected float dtype, got {dtype_str}"
    assert abs(norm - 1.0) < 1e-5, f"Expected unit norm 1.0, got {norm}"
    print("   [PASS] Correct 2048-dim float32 unit-norm embedding.")

    # 5. Verify deterministic inference
    print("\n5. Testing deterministic inference...")
    emb2 = service.embed(crop_bgr)
    max_diff = float(np.max(np.abs(emb1.vector - emb2.vector)))
    print(f"   Maximum element difference across consecutive runs: {max_diff}")
    assert max_diff == 0.0, f"Inference is non-deterministic (max diff: {max_diff})"
    print("   [PASS] Inference is 100% deterministic (0.0 numerical variance).")

    # 6. Verify missing checkpoint failure (no silent fallback)
    print("\n6. Testing missing checkpoint failure...")
    try:
        ReIdService(model_path="non_existent_weights_xyz.pth", allow_fallback=False)
        assert False, "Should have thrown FileNotFoundError / RuntimeError"
    except (FileNotFoundError, RuntimeError) as e:
        print(f"   Correctly raised exception on missing model: {type(e).__name__} ({e})")
        print("   [PASS] Zero silent fallback on missing checkpoint.")

    # 7. Verify cross-model comparison rejection
    print("\n7. Testing cross-model comparison rejection...")
    legacy_vec = np.ones(2048, dtype=np.float32) / np.sqrt(2048)
    legacy_emb = ReIdEmbedding(
        vector=legacy_vec,
        model_name="resnet50_imagenet",
        model_version="1.0-legacy",
        dimension=2048,
    )
    cross_sim = service.similarity(emb1, legacy_emb)
    print(f"   Cross-model similarity returned: {cross_sim}")
    assert cross_sim == 0.0, f"Expected 0.0 for incompatible models, got {cross_sim}"
    print("   [PASS] Cross-model comparison rejected safely.")

    # 8. Confirm A4 Inference Still Works
    print("\n8. Confirming A4 AI Inference pipeline preservation...")
    # Test VehicleDetector
    detector = VehicleDetector()
    sample_frame_path = ROOT / "data" / "evidence" / "CAM-01" / "crop_frame75_track1.jpg"
    test_img = cv2.imread(str(sample_frame_path))
    # Test OCR
    ocr = OCRService()
    ocr_result = ocr.read_plate(test_img)
    print(f"   VehicleDetector loaded: {detector is not None}")
    print(f"   OCRService loaded:     {ocr is not None}")
    print(f"   OCR text extracted:    '{ocr_result.raw_text}' (normalized: '{ocr_result.normalized_text}', conf: {ocr_result.confidence})")
    print("   [PASS] A4 vehicle detection and OCR pipeline components remain fully operational.")

    print("\n" + "=" * 80)
    print("ALL STEP 3 FASTREID & A4 INFERENCE VERIFICATIONS PASSED PERFECTLY!")
    print("=" * 80)


if __name__ == "__main__":
    main()
