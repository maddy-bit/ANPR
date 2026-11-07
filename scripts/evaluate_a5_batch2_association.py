"""
SIH26127 Multi-Camera Vehicle Intelligence Platform
Phase A5 - Batch 2: Global Vehicle Identity Association Evaluation

Evaluates pairwise association on genuine camera evidence crops across 9 distinct scenarios:
  1. Same physical vehicle across different cameras (True match)
  2. Different vehicles with similar appearance (Hard negative)
  3. Vehicle with matching plates and high visual similarity
  4. Vehicle with conflicting plates (even if visual similarity is high)
  5. Vehicle with missing/occluded plates (Visual similarity alone rule)
  6. Physically impossible transit (Speed/topology violation)
  7. Unknown camera topology / unconfigured coordinates
  8. Duplicate association evaluation (Idempotency)
  9. Association review resolution (CONFIRM_MATCH, REJECT_MATCH, FLAG_CONFLICT)

Computes exact empirical metrics:
  - Precision, Recall, False-Match Rate, and Uncertain-Decision Rate.
"""

import sys
import os
import json
import uuid
from pathlib import Path
from datetime import datetime, timezone, timedelta
import numpy as np
import cv2
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from ai.reid import ReIdService
from config import cfg

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
INGEST_AUTH = ("ingest", "local-dev-ingest-only-not-for-prod")


def ingest_detection(payload: dict) -> dict:
    url = f"{BACKEND_URL}/api/detections/ingest"
    resp = requests.post(url, json=payload, auth=INGEST_AUTH, timeout=10)
    if resp.status_code != 201:
        raise RuntimeError(f"Failed to ingest detection ({resp.status_code}): {resp.text}")
    return resp.json()


def associate_pair(source_id: int, candidate_id: int, auto_assign: bool = True) -> dict:
    url = f"{BACKEND_URL}/api/identities/associate"
    payload = {
        "sourceDetectionId": source_id,
        "candidateDetectionId": candidate_id,
        "autoAssign": auto_assign
    }
    resp = requests.post(url, json=payload, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"Association failed ({resp.status_code}): {resp.text}")
    return resp.json()


def resolve_association(assoc_id: str, action: str, notes: str = "", target_id: str = None) -> dict:
    url = f"{BACKEND_URL}/api/identities/associations/{assoc_id}/resolve"
    payload = {
        "action": action,
        "reviewNotes": notes,
        "targetGlobalIdentityId": target_id
    }
    resp = requests.post(url, json=payload, timeout=10)
    if resp.status_code != 200:
        raise RuntimeError(f"Resolve failed ({resp.status_code}): {resp.text}")
    return resp.json()


def main():
    print("=" * 80)
    print("PHASE A5 - BATCH 2: GLOBAL VEHICLE IDENTITY ASSOCIATION EVALUATION")
    print("=" * 80)

    # 1. Initialize FastReID Service
    print("\n[1/6] Initializing FastReID SBS ResNet-50-IBN Service...")
    reid = ReIdService(allow_fallback=False)
    print(f"      Model: {reid.model_name} (version {reid.model_version}, dim={reid.dimension})")

    # 2. Ingest camera with unknown coordinates for topology testing if not present
    cam_unknown_payload = {
        "id": "CAM-UNKNOWN-B2",
        "name": "Unconfigured Junction B2",
        "latitude": 0.0,
        "longitude": 0.0,
        "direction": "N",
        "status": "ONLINE"
    }
    requests.post(f"{BACKEND_URL}/api/cameras", json=cam_unknown_payload, auth=INGEST_AUTH, timeout=5)

    # 3. Load genuine evidence crops
    crop_dir = ROOT / "data" / "benchmarks" / "reid_benchmark_crops"
    assert crop_dir.exists(), f"Benchmark crop dir missing: {crop_dir}"

    crops = {
        "VEH-01_CAM-01": crop_dir / "VEH-01_CAM-01_f75_t1.jpg",
        "VEH-01_CAM-03": crop_dir / "VEH-01_CAM-03_f75_t1.jpg",
        "VEH-01_CAM-07": crop_dir / "VEH-01_CAM-07_f75_t1.jpg",
        "VEH-02_CAM-02": crop_dir / "VEH-02_CAM-02_f80_t2.jpg",
        "VEH-02_CAM-05": crop_dir / "VEH-02_CAM-05_f80_t2.jpg",
        "VEH-03_CAM-04": crop_dir / "VEH-03_CAM-04_f75_t4.jpg",
        "VEH-03_CAM-06": crop_dir / "VEH-03_CAM-06_f75_t4.jpg",
        "VEH-04_CAM-08": crop_dir / "VEH-04_CAM-08_f20_t3.jpg",
    }

    embeddings = {}
    for key, cpath in crops.items():
        assert cpath.exists(), f"Crop missing: {cpath}"
        bgr = cv2.imread(str(cpath))
        emb = reid.embed(bgr)
        vec_list = emb.vector.tolist() if isinstance(emb.vector, np.ndarray) else list(emb.vector)
        embeddings[key] = {
            "list": [float(x) for x in vec_list],
            "emb": emb
        }

    print(f"\n[2/6] Extracted FastReID embeddings for {len(embeddings)} genuine evidence crops.")

    # 4. Ingest Detections for Evaluation Matrix
    print("\n[3/6] Ingesting test detections into PostgreSQL via /api/detections/ingest...")
    base_t = datetime(2026, 11, 4, 15, 0, 0, tzinfo=timezone.utc)

    # D1: VEH-01 at CAM-01 (t=0)
    d1 = ingest_detection({
        "cameraId": "CAM-01",
        "timestamp": base_t.isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.95,
        "plateTextRaw": "MH 12 DE 1001",
        "plateTextNormalized": "MH12DE1001",
        "plateConfidence": 0.92,
        "trackId": 101,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-01_f75_t1.jpg",
        "reidConfidence": 0.94,
        "reidEmbedding": embeddings["VEH-01_CAM-01"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D2: VEH-01 at CAM-03 (t=180s, dist=1.78km, speed=35.6 km/h) -> PLAUSIBLE MATCH
    d2 = ingest_detection({
        "cameraId": "CAM-03",
        "timestamp": (base_t + timedelta(seconds=180)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.94,
        "plateTextRaw": "MH 12 DE 1001",
        "plateTextNormalized": "MH12DE1001",
        "plateConfidence": 0.90,
        "trackId": 103,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-03_f75_t1.jpg",
        "reidConfidence": 0.93,
        "reidEmbedding": embeddings["VEH-01_CAM-03"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D3: VEH-02 at CAM-02 (t=60s, different car, white sedan) -> HARD NEGATIVE
    d3 = ingest_detection({
        "cameraId": "CAM-02",
        "timestamp": (base_t + timedelta(seconds=60)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.93,
        "plateTextRaw": "MH 12 TC 2002",
        "plateTextNormalized": "MH12TC2002",
        "plateConfidence": 0.89,
        "trackId": 102,
        "frameNumber": 80,
        "imagePath": "reid_benchmark_crops/VEH-02_CAM-02_f80_t2.jpg",
        "reidConfidence": 0.91,
        "reidEmbedding": embeddings["VEH-02_CAM-02"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D4: Conflicting plate with high visual similarity to D1 (conflicting plate override)
    d4 = ingest_detection({
        "cameraId": "CAM-03",
        "timestamp": (base_t + timedelta(seconds=200)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.92,
        "plateTextRaw": "DL 01 XY 9999",
        "plateTextNormalized": "DL01XY9999",
        "plateConfidence": 0.94,
        "trackId": 104,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-03_f75_t1.jpg",
        "reidConfidence": 0.93,
        "reidEmbedding": embeddings["VEH-01_CAM-03"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D5: Missing plate with high visual similarity to D1 (visual similarity alone rule -> UNCERTAIN)
    d5 = ingest_detection({
        "cameraId": "CAM-07",
        "timestamp": (base_t + timedelta(seconds=600)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.91,
        "plateTextRaw": None,
        "plateTextNormalized": None,
        "plateConfidence": None,
        "trackId": 105,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-07_f75_t1.jpg",
        "reidConfidence": 0.92,
        "reidEmbedding": embeddings["VEH-01_CAM-07"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D6: Physically impossible transit (CAM-06 Hadapsar is ~8.5km away; dt=2.0s -> speed > 15,000 km/h)
    d6 = ingest_detection({
        "cameraId": "CAM-06",
        "timestamp": (base_t + timedelta(seconds=2)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.95,
        "plateTextRaw": "MH 12 DE 1001",
        "plateTextNormalized": "MH12DE1001",
        "plateConfidence": 0.92,
        "trackId": 106,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-01_f75_t1.jpg",
        "reidConfidence": 0.95,
        "reidEmbedding": embeddings["VEH-01_CAM-01"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D7: Unknown camera topology (unconfigured coordinates 0.0, 0.0)
    d7 = ingest_detection({
        "cameraId": "CAM-UNKNOWN-B2",
        "timestamp": (base_t + timedelta(seconds=120)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.90,
        "plateTextRaw": "MH 12 DE 1001",
        "plateTextNormalized": "MH12DE1001",
        "plateConfidence": 0.90,
        "trackId": 107,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-01_f75_t1.jpg",
        "reidConfidence": 0.92,
        "reidEmbedding": embeddings["VEH-01_CAM-01"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D8: VEH-02 at CAM-05 (t=300s, dist ~2.6km, speed ~31 km/h) -> MATCH for VEH-02
    d8 = ingest_detection({
        "cameraId": "CAM-05",
        "timestamp": (base_t + timedelta(seconds=300)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.92,
        "plateTextRaw": "MH 12 TC 2002",
        "plateTextNormalized": "MH12TC2002",
        "plateConfidence": 0.88,
        "trackId": 108,
        "frameNumber": 80,
        "imagePath": "reid_benchmark_crops/VEH-02_CAM-05_f80_t2.jpg",
        "reidConfidence": 0.90,
        "reidEmbedding": embeddings["VEH-02_CAM-05"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D9: VEH-03 at CAM-04 (t=100s)
    d9 = ingest_detection({
        "cameraId": "CAM-04",
        "timestamp": (base_t + timedelta(seconds=100)).isoformat(),
        "vehicleClass": "motorcycle",
        "detectionConfidence": 0.91,
        "plateTextRaw": "MH 14 KL 3003",
        "plateTextNormalized": "MH14KL3003",
        "plateConfidence": 0.87,
        "trackId": 109,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-03_CAM-04_f75_t4.jpg",
        "reidConfidence": 0.89,
        "reidEmbedding": embeddings["VEH-03_CAM-04"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D10: VEH-03 at CAM-06 (t=1100s, dist ~10km, speed ~36 km/h) -> MATCH for VEH-03
    d10 = ingest_detection({
        "cameraId": "CAM-06",
        "timestamp": (base_t + timedelta(seconds=1100)).isoformat(),
        "vehicleClass": "motorcycle",
        "detectionConfidence": 0.90,
        "plateTextRaw": "MH 14 KL 3003",
        "plateTextNormalized": "MH14KL3003",
        "plateConfidence": 0.85,
        "trackId": 110,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-03_CAM-06_f75_t4.jpg",
        "reidConfidence": 0.88,
        "reidEmbedding": embeddings["VEH-03_CAM-06"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    # D11: Unreadable plate at unknown camera
    d11 = ingest_detection({
        "cameraId": "CAM-UNKNOWN-B2",
        "timestamp": (base_t + timedelta(seconds=150)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.90,
        "plateTextRaw": None,
        "plateTextNormalized": None,
        "plateConfidence": None,
        "trackId": 111,
        "frameNumber": 75,
        "imagePath": "reid_benchmark_crops/VEH-01_CAM-01_f75_t1.jpg",
        "reidConfidence": 0.90,
        "reidEmbedding": embeddings["VEH-01_CAM-01"]["list"],
        "reidModelName": reid.model_name,
        "reidModelVersion": reid.model_version,
        "reidDimension": reid.dimension
    })

    print(f"      Ingested detections D1..D11 with database IDs: {[d['id'] for d in [d1, d2, d3, d4, d5, d6, d7, d8, d9, d10, d11]]}")

    # 5. Evaluate the 8 Core Automated Scenarios
    print("\n[4/6] Evaluating the Core Automated Scenarios 1..8...")
    eval_results = []

    # Scenario 1: Same physical vehicle across different cameras (True match)
    s1 = associate_pair(d1["id"], d2["id"], auto_assign=True)
    print(f"\nScenario 1: Same vehicle across cameras (D1 -> D2):")
    print(f"   Decision:        {s1['decision']} (Expected: MATCH)")
    print(f"   Overall Score:   {s1['overallScore']:.3f}")
    print(f"   Re-ID Score:     {s1['reidScore']:.3f}")
    print(f"   Plate Score:     {s1['plateScore']:.3f}")
    print(f"   Global Identity: {s1['globalIdentityId']}")
    assert s1["decision"] == "MATCH", f"Expected MATCH but got {s1['decision']}"
    assert s1["globalIdentityId"] is not None, "Global identity must be assigned"
    eval_results.append({
        "scenario": 1,
        "name": "Same vehicle cross-camera true match",
        "ground_truth": "MATCH",
        "decision": s1["decision"],
        "overall_score": s1["overallScore"],
        "reid_score": s1["reidScore"],
        "plate_score": s1["plateScore"],
        "pass": s1["decision"] == "MATCH"
    })

    # Scenario 2: Different vehicles with similar appearance (Hard negative)
    s2 = associate_pair(d1["id"], d3["id"], auto_assign=True)
    print(f"\nScenario 2: Different vehicles with similar appearance (D1 vs D3):")
    print(f"   Decision:        {s2['decision']} (Expected: NO_MATCH)")
    print(f"   Overall Score:   {s2['overallScore']:.3f}")
    print(f"   Re-ID Score:     {s2['reidScore']:.3f}")
    print(f"   Reason:          {s2['decisionReason']}")
    assert s2["decision"] == "NO_MATCH", f"Expected NO_MATCH but got {s2['decision']}"
    eval_results.append({
        "scenario": 2,
        "name": "Different vehicles similar appearance (hard negative)",
        "ground_truth": "NO_MATCH",
        "decision": s2["decision"],
        "overall_score": s2["overallScore"],
        "reid_score": s2["reidScore"],
        "plate_score": s2["plateScore"],
        "pass": s2["decision"] == "NO_MATCH"
    })

    # Scenario 3: Vehicle with matching plates and high visual similarity (D3 -> D8)
    s3 = associate_pair(d3["id"], d8["id"], auto_assign=True)
    print(f"\nScenario 3: Matching plates + high visual similarity (D3 -> D8):")
    print(f"   Decision:        {s3['decision']} (Expected: MATCH)")
    print(f"   Overall Score:   {s3['overallScore']:.3f}")
    print(f"   Global Identity: {s3['globalIdentityId']}")
    assert s3["decision"] == "MATCH", f"Expected MATCH but got {s3['decision']}"
    eval_results.append({
        "scenario": 3,
        "name": "Matching plates and high visual similarity",
        "ground_truth": "MATCH",
        "decision": s3["decision"],
        "overall_score": s3["overallScore"],
        "reid_score": s3["reidScore"],
        "plate_score": s3["plateScore"],
        "pass": s3["decision"] == "MATCH"
    })

    # Scenario 4: Vehicle with conflicting plates overrides visual similarity (D1 vs D4)
    s4 = associate_pair(d1["id"], d4["id"], auto_assign=True)
    print(f"\nScenario 4: High visual similarity but conflicting plates (D1 vs D4):")
    print(f"   Decision:        {s4['decision']} (Expected: NO_MATCH)")
    print(f"   Overall Score:   {s4['overallScore']:.3f}")
    print(f"   Re-ID Score:     {s4['reidScore']:.3f}")
    print(f"   Reason:          {s4['decisionReason']}")
    assert s4["decision"] == "NO_MATCH", f"Expected NO_MATCH but got {s4['decision']}"
    assert "plate conflict" in s4["decisionReason"].lower()
    eval_results.append({
        "scenario": 4,
        "name": "High visual similarity but conflicting plates",
        "ground_truth": "NO_MATCH",
        "decision": s4["decision"],
        "overall_score": s4["overallScore"],
        "reid_score": s4["reidScore"],
        "plate_score": s4["plateScore"],
        "pass": s4["decision"] == "NO_MATCH"
    })

    # Scenario 5: Missing plate with high visual similarity (Visual similarity alone rule -> UNCERTAIN)
    s5 = associate_pair(d1["id"], d5["id"], auto_assign=True)
    print(f"\nScenario 5: Missing plate with high visual similarity (D1 vs D5):")
    print(f"   Decision:        {s5['decision']} (Expected: UNCERTAIN)")
    print(f"   Review Status:   {s5['reviewStatus']} (Expected: PENDING_REVIEW)")
    print(f"   Overall Score:   {s5['overallScore']:.3f}")
    print(f"   Reason:          {s5['decisionReason']}")
    assert s5["decision"] == "UNCERTAIN", f"Expected UNCERTAIN but got {s5['decision']}"
    assert s5["reviewStatus"] == "PENDING_REVIEW"
    assert "visual similarity" in s5["decisionReason"].lower()
    eval_results.append({
        "scenario": 5,
        "name": "Missing plate with high visual similarity",
        "ground_truth": "UNCERTAIN",
        "decision": s5["decision"],
        "overall_score": s5["overallScore"],
        "reid_score": s5["reidScore"],
        "plate_score": s5["plateScore"],
        "pass": s5["decision"] == "UNCERTAIN"
    })

    # Scenario 6: Physically impossible transit (Speed violation: 8.5km in 2s -> NO_MATCH)
    s6 = associate_pair(d1["id"], d6["id"], auto_assign=True)
    print(f"\nScenario 6: Physically impossible transit (D1 vs D6):")
    print(f"   Decision:        {s6['decision']} (Expected: NO_MATCH)")
    print(f"   Overall Score:   {s6['overallScore']:.3f} (Expected: 0.0)")
    print(f"   Reason:          {s6['decisionReason']}")
    assert s6["decision"] == "NO_MATCH", f"Expected NO_MATCH but got {s6['decision']}"
    assert s6["overallScore"] == 0.0
    assert "exceeds maximum limit" in s6["decisionReason"].lower()
    eval_results.append({
        "scenario": 6,
        "name": "Physically impossible transit (speed violation)",
        "ground_truth": "NO_MATCH",
        "decision": s6["decision"],
        "overall_score": s6["overallScore"],
        "reid_score": s6["reidScore"],
        "plate_score": s6["plateScore"],
        "pass": s6["decision"] == "NO_MATCH"
    })

    # Scenario 7: Unknown camera topology / unconfigured coordinates (D1 vs D7)
    s7 = associate_pair(d1["id"], d7["id"], auto_assign=True)
    print(f"\nScenario 7: Unknown camera topology / unconfigured coordinates (D1 vs D7):")
    print(f"   Decision:        {s7['decision']} (Expected: UNCERTAIN)")
    print(f"   Review Status:   {s7['reviewStatus']} (Expected: PENDING_REVIEW)")
    print(f"   Reason:          {s7['decisionReason']}")
    assert s7["decision"] == "UNCERTAIN", f"Expected UNCERTAIN but got {s7['decision']}"
    assert "unconfigured" in s7["decisionReason"].lower()
    eval_results.append({
        "scenario": 7,
        "name": "Unknown camera topology / unconfigured coordinates",
        "ground_truth": "UNCERTAIN",
        "decision": s7["decision"],
        "overall_score": s7["overallScore"],
        "reid_score": s7["reidScore"],
        "plate_score": s7["plateScore"],
        "pass": s7["decision"] == "UNCERTAIN"
    })

    # Scenario 8: Duplicate association evaluation (idempotency)
    s8_first = s1
    s8_second = associate_pair(d1["id"], d2["id"], auto_assign=True)
    print(f"\nScenario 8: Duplicate association evaluation (idempotency):")
    print(f"   First UUID:      {s8_first['id']}")
    print(f"   Second UUID:     {s8_second['id']}")
    print(f"   Scores match:    {s8_first['overallScore'] == s8_second['overallScore']}")
    assert s8_first["id"] == s8_second["id"], "Duplicate request must return existing record"
    eval_results.append({
        "scenario": 8,
        "name": "Duplicate evaluation idempotency",
        "ground_truth": "IDEMPOTENT",
        "decision": "IDEMPOTENT_MATCH",
        "overall_score": s8_second["overallScore"],
        "reid_score": s8_second["reidScore"],
        "plate_score": s8_second["plateScore"],
        "pass": s8_first["id"] == s8_second["id"]
    })

    # Associate conflict test pair (D1 vs D11)
    s_conflict = associate_pair(d1["id"], d11["id"], auto_assign=True)

    # 6. Evaluate Pairwise Cross-Camera Matrix on pure automated decisions (prior to manual review)
    print("\n[5/6] Evaluating Pairwise Cross-Camera Matrix for Pure Automated Accuracy Metrics...")
    matrix_pairs = [
        # True Positives:
        {"s": d1["id"], "c": d2["id"], "label": "MATCH"},       # VEH-01 CAM-01 -> CAM-03
        {"s": d3["id"], "c": d8["id"], "label": "MATCH"},       # VEH-02 CAM-02 -> CAM-05
        {"s": d9["id"], "c": d10["id"], "label": "MATCH"},      # VEH-03 CAM-04 -> CAM-06
        # True Negatives (Different vehicles):
        {"s": d1["id"], "c": d3["id"], "label": "NO_MATCH"},    # VEH-01 vs VEH-02
        {"s": d1["id"], "c": d8["id"], "label": "NO_MATCH"},    # VEH-01 vs VEH-02 (CAM-05)
        {"s": d1["id"], "c": d9["id"], "label": "NO_MATCH"},    # VEH-01 (car) vs VEH-03 (bike)
        {"s": d1["id"], "c": d10["id"], "label": "NO_MATCH"},   # VEH-01 (car) vs VEH-03 (bike)
        {"s": d2["id"], "c": d3["id"], "label": "NO_MATCH"},    # VEH-01 vs VEH-02
        {"s": d2["id"], "c": d9["id"], "label": "NO_MATCH"},    # VEH-01 vs VEH-03
        {"s": d3["id"], "c": d9["id"], "label": "NO_MATCH"},    # VEH-02 vs VEH-03
        {"s": d3["id"], "c": d10["id"], "label": "NO_MATCH"},   # VEH-02 vs VEH-03
        {"s": d8["id"], "c": d9["id"], "label": "NO_MATCH"},    # VEH-02 vs VEH-03
        {"s": d8["id"], "c": d10["id"], "label": "NO_MATCH"},   # VEH-02 vs VEH-03
        # Hard Negatives (conflicting plates or impossible transition):
        {"s": d1["id"], "c": d4["id"], "label": "NO_MATCH"},    # VEH-01 vs Conflicting plate
        {"s": d1["id"], "c": d6["id"], "label": "NO_MATCH"},    # VEH-01 vs Impossible transition
        # Ambiguous / Uncertain pairs (Safety tests where automated engine must NOT match):
        {"s": d1["id"], "c": d5["id"], "label": "UNCERTAIN"},   # Missing plate (visual similarity alone rule)
        {"s": d1["id"], "c": d7["id"], "label": "UNCERTAIN"},   # Unknown topology
        {"s": d1["id"], "c": d11["id"], "label": "UNCERTAIN"},  # Missing plate + unknown topology
    ]

    tp = 0
    fp = 0
    tn = 0
    fn = 0
    uncertain_count = 0

    detailed_matrix = []

    for item in matrix_pairs:
        s_id = item["s"]
        c_id = item["c"]
        gt = item["label"]
        res = associate_pair(s_id, c_id, auto_assign=False)
        dec = res["decision"]

        detailed_matrix.append({
            "source_id": s_id,
            "candidate_id": c_id,
            "ground_truth": gt,
            "system_decision": dec,
            "overall_score": res["overallScore"],
            "reid_score": res.get("reidScore"),
            "plate_score": res.get("plateScore"),
            "reason": res.get("decisionReason")
        })

        if dec == "UNCERTAIN":
            uncertain_count += 1
            if gt == "MATCH":
                fn += 1
        elif dec == "MATCH":
            if gt == "MATCH":
                tp += 1
            else:
                fp += 1
        elif dec == "NO_MATCH":
            if gt == "NO_MATCH":
                tn += 1
            else:
                fn += 1

    total_pairs = len(matrix_pairs)
    precision = (tp / (tp + fp)) * 100.0 if (tp + fp) > 0 else 100.0
    recall = (tp / (tp + fn)) * 100.0 if (tp + fn) > 0 else 0.0
    false_match_rate = (fp / (fp + tn)) * 100.0 if (fp + tn) > 0 else 0.0
    uncertain_rate = (uncertain_count / total_pairs) * 100.0

    print("\n[5/6] Pure Automated Empirical Evaluation Metrics Summary:")
    print(f"      Total Evaluated Pairs:   {total_pairs}")
    print(f"      True Positives (TP):     {tp}")
    print(f"      True Negatives (TN):     {tn}")
    print(f"      False Positives (FP):    {fp}")
    print(f"      False Negatives (FN):    {fn}")
    print(f"      Uncertain Decisions (U): {uncertain_count}")
    print(f"      Precision:               {precision:.2f}% (Formula: TP / (TP + FP) = {tp} / {tp + fp})")
    print(f"      Recall (Decided):        {recall:.2f}% (Formula: TP / (TP + FN) = {tp} / {tp + fn})")
    print(f"      False-Match Rate (FMR):  {false_match_rate:.2f}% (Formula: FP / (FP + TN) = {fp} / {fp + tn})")
    print(f"      Uncertain-Decision Rate: {uncertain_rate:.2f}% (Formula: U / Total = {uncertain_count} / {total_pairs})")

    # Scenario 9: Association review resolution workflow tests
    print(f"\nScenario 9: Association review resolution workflow tests:")
    # 9a: CONFIRM_MATCH on uncertain s5
    s9a = resolve_association(s5["id"], "CONFIRM_MATCH", notes="Analyst confirmed bumper sticker match")
    print(f"   9a (CONFIRM_MATCH): decision={s9a['decision']}, reviewStatus={s9a['reviewStatus']}")
    assert s9a["decision"] == "MATCH"
    assert s9a["reviewStatus"] == "CONFIRMED_BY_USER"
    assert s9a["globalIdentityId"] is not None

    # 9b: Create another uncertain pair (D1 vs D7) and REJECT_MATCH
    s9b = resolve_association(s7["id"], "REJECT_MATCH", notes="Rejected: coordinates unknown and cannot verify corridor")
    print(f"   9b (REJECT_MATCH):  decision={s9b['decision']}, reviewStatus={s9b['reviewStatus']}")
    assert s9b["decision"] == "NO_MATCH"
    assert s9b["reviewStatus"] == "REJECTED_BY_USER"

    s9c = resolve_association(s_conflict["id"], "FLAG_CONFLICT", notes="Flagged: potential clone or sensor glitch")
    print(f"   9c (FLAG_CONFLICT): reviewStatus={s9c['reviewStatus']}")
    assert s9c["reviewStatus"] == "FLAGGED_CONFLICT"

    eval_results.append({
        "scenario": 9,
        "name": "Association review resolution (confirm, reject, flag)",
        "ground_truth": "REVIEWABLE",
        "decision": "RESOLVED",
        "pass": True
    })

    # Save benchmark report to JSON
    output_path = ROOT / "data" / "benchmarks" / "a5_batch2_association_evaluation.json"
    report_data = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model": {
            "name": reid.model_name,
            "version": reid.model_version,
            "dimension": reid.dimension
        },
        "scenarios": eval_results,
        "metrics": {
            "total_pairs": total_pairs,
            "true_positives": tp,
            "true_negatives": tn,
            "false_positives": fp,
            "false_negatives": fn,
            "uncertain_count": uncertain_count,
            "precision_pct": precision,
            "recall_pct": recall,
            "false_match_rate_pct": false_match_rate,
            "uncertain_rate_pct": uncertain_rate
        },
        "matrix_details": detailed_matrix
    }

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(report_data, f, indent=2)

    print(f"\nSaved empirical evaluation report to: {output_path}")
    print("=" * 80)
    print("ALL 9 SCENARIOS VERIFIED SUCCESSFULLY.")
    print("=" * 80)


if __name__ == "__main__":
    main()
