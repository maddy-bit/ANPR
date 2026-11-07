"""
Live End-to-End Verification of Phase A5 Batch 1:
- Real FastReID model embedding generation
- Supabase PostgreSQL persistence of Re-ID provenance metadata
- Spring Boot Candidate Association API (GET /api/detections/{id}/candidates)
- Spatial-temporal filtering (road corridor topology vs PostGIS distance, velocity feasibility)
- Cross-model compatibility enforcement
"""

import sys
import os
from pathlib import Path
import cv2
import requests
import json
from datetime import datetime, timezone, timedelta

# Add ai-service to path
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ai-service"))

from ai.reid import FastReIdExtractor, ReIdService, ReIdEmbedding
from config import ReIDConfig, ModelPaths

BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
AUTH = ("ingest", "local-dev-ingest-only-not-for-prod")


def main():
    print("=" * 80)
    print("PHASE A5 BATCH 1: LIVE END-TO-END CANDIDATE ASSOCIATION VERIFICATION")
    print("=" * 80)

    # Step 1: Initialize FastReID Extractor and verify checkpoint
    print("\n--- 1. Initializing FastReID ReIdService ---")
    reid_service = ReIdService()
    print(f"Service model: {reid_service.model_name}")
    print(f"Model version: {reid_service.model_version}")
    print(f"Vector dimension: {reid_service.dimension}")
    print(f"Device: {reid_service.device_str}")

    # Step 2: Extract real embeddings from genuine crops
    crop1_path = ROOT / "data" / "evidence" / "CAM-01" / "crop_frame75_track1.jpg"
    crop2_path = ROOT / "data" / "evidence" / "CAM-02" / "crop_frame80_track2.jpg"

    assert crop1_path.exists(), f"Missing crop: {crop1_path}"
    assert crop2_path.exists(), f"Missing crop: {crop2_path}"

    img1 = cv2.imread(str(crop1_path))
    img2 = cv2.imread(str(crop2_path))

    emb1 = reid_service.embed(img1)
    emb2 = reid_service.embed(img2)

    import numpy as np
    vec1 = emb1.vector
    vec2 = emb2.vector
    print(f"\nCrop 1: {crop1_path.name} -> norm={np.linalg.norm(vec1):.4f}, dim={len(vec1)}")
    print(f"Crop 2: {crop2_path.name} -> norm={np.linalg.norm(vec2):.4f}, dim={len(vec2)}")
    sim = reid_service.similarity(emb1, emb2)
    print(f"Python-computed FastReID similarity: {sim:.4f}")

    # Base time for test detections
    base_time = datetime(2026, 11, 4, 10, 0, 0, tzinfo=timezone.utc)

    # Ingest Detection A: CAM-01 at t=0s
    req_a = {
        "cameraId": "CAM-01",
        "timestamp": base_time.isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.95,
        "plateTextRaw": "MH 12 AB 1234",
        "plateTextNormalized": "MH12AB1234",
        "plateConfidence": 0.90,
        "trackId": 101,
        "frameNumber": 75,
        "imagePath": "CAM-01/crop_frame75_track1.jpg",
        "reidConfidence": 0.92,
        "reidEmbedding": emb1.to_list(),
        "reidModelName": reid_service.model_name,
        "reidModelVersion": reid_service.model_version,
        "reidDimension": reid_service.dimension,
    }

    # Ingest Detection B (Feasible transition): CAM-02 at t=+90s (corridor distance 1.20 km -> 48 km/h)
    req_b = {
        "cameraId": "CAM-02",
        "timestamp": (base_time + timedelta(seconds=90)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.93,
        "plateTextRaw": "MH 12 AB 1234",
        "plateTextNormalized": "MH12AB1234",
        "plateConfidence": 0.88,
        "trackId": 102,
        "frameNumber": 80,
        "imagePath": "CAM-02/crop_frame80_track2.jpg",
        "reidConfidence": 0.90,
        "reidEmbedding": emb2.to_list(),
        "reidModelName": reid_service.model_name,
        "reidModelVersion": reid_service.model_version,
        "reidDimension": reid_service.dimension,
    }

    # Ingest Detection C (Impossible Speed): CAM-03 at t=+5s (corridor ~2.7km -> speed 1944 km/h)
    req_c = {
        "cameraId": "CAM-03",
        "timestamp": (base_time + timedelta(seconds=5)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.91,
        "plateTextRaw": "MH 12 AB 1234",
        "plateTextNormalized": "MH12AB1234",
        "plateConfidence": 0.85,
        "trackId": 103,
        "frameNumber": 12,
        "imagePath": "CAM-03/crop_frame12_track3.jpg",
        "reidConfidence": 0.89,
        "reidEmbedding": emb2.to_list(),
        "reidModelName": reid_service.model_name,
        "reidModelVersion": reid_service.model_version,
        "reidDimension": reid_service.dimension,
    }

    # Ingest Detection D (Incompatible Re-ID Model Version): CAM-02 at t=+120s
    req_d = {
        "cameraId": "CAM-02",
        "timestamp": (base_time + timedelta(seconds=120)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.90,
        "plateTextRaw": "MH 12 AB 1234",
        "plateTextNormalized": "MH12AB1234",
        "plateConfidence": 0.80,
        "trackId": 104,
        "frameNumber": 95,
        "imagePath": "CAM-02/crop_frame95_track4.jpg",
        "reidConfidence": 0.80,
        "reidEmbedding": [0.01] * 2048,
        "reidModelName": "legacy_imagenet_resnet50",
        "reidModelVersion": "v0.9-deprecated",
        "reidDimension": 2048,
    }

    print("\n--- 2. Ingesting Detections into Supabase PostgreSQL ---")
    resp_a = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=req_a, auth=AUTH)
    assert resp_a.status_code == 201, f"Failed A: {resp_a.text}"
    det_a = resp_a.json()
    id_a = det_a["id"]
    print(f"Ingested Detection A (Source): id={id_a}, camera={det_a['cameraId']}, model={det_a['reidModelName']}")

    resp_b = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=req_b, auth=AUTH)
    assert resp_b.status_code == 201, f"Failed B: {resp_b.text}"
    det_b = resp_b.json()
    id_b = det_b["id"]
    print(f"Ingested Detection B (Feasible): id={id_b}, camera={det_b['cameraId']}, model={det_b['reidModelName']}")

    resp_c = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=req_c, auth=AUTH)
    assert resp_c.status_code == 201, f"Failed C: {resp_c.text}"
    det_c = resp_c.json()
    id_c = det_c["id"]
    print(f"Ingested Detection C (Impossible Speed): id={id_c}, camera={det_c['cameraId']}, model={det_c['reidModelName']}")

    resp_d = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=req_d, auth=AUTH)
    assert resp_d.status_code == 201, f"Failed D: {resp_d.text}"
    det_d = resp_d.json()
    id_d = det_d["id"]
    print(f"Ingested Detection D (Incompatible Model): id={id_d}, camera={det_d['cameraId']}, model={det_d['reidModelName']}")

    # Step 3: Query Candidates API (feasibleOnly=false)
    print("\n--- 3. Querying GET /api/detections/{id}/candidates (feasibleOnly=false) ---")
    url_all = f"{BACKEND_URL}/api/detections/{id_a}/candidates?feasibleOnly=false"
    cand_resp = requests.get(url_all, auth=AUTH)
    assert cand_resp.status_code == 200, f"Query failed: {cand_resp.text}"
    res = cand_resp.json()

    print(f"Source Detection ID: {res['sourceDetectionId']}")
    print(f"Source Camera: {res['sourceCameraId']} ({res['sourceTimestamp']})")
    print(f"Source Model: {res['sourceReidModelName']} {res['sourceReidModelVersion']}")
    print(f"Total Candidates Evaluated: {res['totalCandidatesEvaluated']}")
    print(f"Feasible Candidates Count: {res['feasibleCandidatesCount']}")

    cand_map = {c["detectionId"]: c for c in res["candidates"]}

    # Verify Candidate B (Feasible)
    print("\n[Candidate B Verification]:")
    cb = cand_map[id_b]
    print(f"  Detection ID: {cb['detectionId']}")
    print(f"  Camera ID: {cb['cameraId']}")
    print(f"  Spatial Distance: {cb['spatialDistanceKm']} km (Method: {cb['distanceCalculationMethod']})")
    print(f"  Time Difference: {cb['timeDifferenceSeconds']} s")
    print(f"  Apparent Speed: {cb['apparentSpeedKmh']} km/h")
    print(f"  Feasibility: {cb['feasibility']} ({cb['feasibilityReason']})")
    print(f"  Re-ID Compatibility: {cb['reidModelCompatibility']}")
    print(f"  Visual Similarity: {cb['visualSimilarity']}")

    assert cb["feasibility"] == "FEASIBLE", f"Expected FEASIBLE, got {cb['feasibility']}"
    assert cb["distanceCalculationMethod"] == "ROAD_NETWORK_TOPOLOGY", f"Expected ROAD_NETWORK_TOPOLOGY, got {cb['distanceCalculationMethod']}"
    assert abs(cb["spatialDistanceKm"] - 1.20) < 0.05, f"Expected ~1.20 km, got {cb['spatialDistanceKm']}"
    assert abs(cb["apparentSpeedKmh"] - 48.0) < 1.0, f"Expected ~48.0 km/h, got {cb['apparentSpeedKmh']}"
    assert cb["reidModelCompatibility"] == "COMPATIBLE", f"Expected COMPATIBLE, got {cb['reidModelCompatibility']}"
    assert cb["visualSimilarity"] is not None and cb["visualSimilarity"] > 0.0, "Expected valid cosine similarity"

    # Verify Candidate C (Impossible Speed)
    print("\n[Candidate C Verification]:")
    cc = cand_map[id_c]
    print(f"  Detection ID: {cc['detectionId']}")
    print(f"  Camera ID: {cc['cameraId']}")
    print(f"  Spatial Distance: {cc['spatialDistanceKm']} km (Method: {cc['distanceCalculationMethod']})")
    print(f"  Time Difference: {cc['timeDifferenceSeconds']} s")
    print(f"  Apparent Speed: {cc['apparentSpeedKmh']} km/h")
    print(f"  Feasibility: {cc['feasibility']} ({cc['feasibilityReason']})")

    assert cc["feasibility"] == "IMPOSSIBLE_TRANSITION", f"Expected IMPOSSIBLE_TRANSITION, got {cc['feasibility']}"
    assert cc["apparentSpeedKmh"] > 100.0, f"Expected speed > 100 km/h, got {cc['apparentSpeedKmh']}"

    # Verify Candidate D (Incompatible Re-ID Model)
    print("\n[Candidate D Verification]:")
    cd = cand_map[id_d]
    print(f"  Detection ID: {cd['detectionId']}")
    print(f"  Camera ID: {cd['cameraId']}")
    print(f"  Re-ID Model: {cd['reidModelName']} {cd['reidModelVersion']}")
    print(f"  Re-ID Compatibility: {cd['reidModelCompatibility']}")
    print(f"  Visual Similarity: {cd['visualSimilarity']}")

    assert cd["reidModelCompatibility"] == "INCOMPATIBLE_MODEL_VERSION", f"Expected INCOMPATIBLE_MODEL_VERSION, got {cd['reidModelCompatibility']}"
    assert cd["visualSimilarity"] is None, "Incompatible model must yield null visualSimilarity"

    # Step 4: Query Candidates API with feasibleOnly=true
    print("\n--- 4. Querying GET /api/detections/{id}/candidates?feasibleOnly=true ---")
    url_feas = f"{BACKEND_URL}/api/detections/{id_a}/candidates?feasibleOnly=true"
    feas_resp = requests.get(url_feas, auth=AUTH)
    assert feas_resp.status_code == 200, f"Query failed: {feas_resp.text}"
    res_feas = feas_resp.json()
    print(f"Feasible Filtered Count: {len(res_feas['candidates'])}")
    for fc in res_feas['candidates']:
        print(f"  Candidate: id={fc['detectionId']}, camera={fc['cameraId']}, feasibility={fc['feasibility']}")
        assert fc["feasibility"] == "FEASIBLE", "Non-feasible detection returned when feasibleOnly=true"

    print("\n" + "=" * 80)
    print("ALL LIVE END-TO-END VERIFICATION CHECKS PASSED PERFECTLY!")
    print("=" * 80)


if __name__ == "__main__":
    main()
