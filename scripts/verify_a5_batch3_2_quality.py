"""
SIH26127 Multi-Camera Vehicle Intelligence Platform
Phase A5 - Batch 3.2: Trajectory Reliability & Evidence Quality Verification Script

Tests live against Spring Boot and Supabase PostgreSQL:
  1. Live ingestion of multi-camera vehicle sightings.
  2. Association and global identity assignment.
  3. Live Trajectory Quality API: GET /api/identities/{id}/trajectory/quality.
  4. Evidence quality dimensions: identity, detection, plate, re-id, spatial-temporal, completeness.
  5. Multi-dimensional quality categories, supporting evidence, warnings, and missing evidence lists.
  6. Error handling: 404 for nonexistent identity, 400 for malformed UUID.
  7. Clean teardown of test records.
"""

import sys
import os
import re
import json
import ssl
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
import pg8000.native

ROOT = Path(__file__).resolve().parents[1]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
INGEST_AUTH = ("ingest", "local-dev-ingest-only-not-for-prod")


def get_db_connection():
    env = {}
    with open(ROOT / ".env") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()

    url = env.get("DB_URL", "")
    m = re.match(r"jdbc:postgresql://([^:/]+)(?::(\d+))?/([^?]+)", url)
    if not m:
        raise ValueError("Could not parse DB_URL from .env")

    host, port, dbname = m.group(1), int(m.group(2) or 5432), m.group(3)
    user, password = env.get("DB_USERNAME"), env.get("DB_PASSWORD")

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    return pg8000.native.Connection(
        user=user,
        password=password,
        host=host,
        port=port,
        database=dbname,
        ssl_context=ctx
    )


def run_quality_verification():
    print("=" * 80)
    print("PHASE A5 - BATCH 3.2: TRAJECTORY RELIABILITY & EVIDENCE QUALITY VERIFICATION")
    print("=" * 80)

    now = datetime.now(timezone.utc)
    t1 = (now - timedelta(minutes=10)).isoformat()
    t2 = (now - timedelta(minutes=8, seconds=30)).isoformat()  # 90s after t1
    t3 = (now - timedelta(minutes=8, seconds=28)).isoformat()  # 2s after t2 (impossible jump to Hadapsar)

    vec = [0.0] * 512
    vec[0] = 0.85
    vec[1] = 0.52

    test_plate = "MH12QL7777"

    # 1. Ingest 3 detections
    print("\n[1/5] Ingesting 3 multi-camera vehicle sightings...")
    d1_payload = {
        "cameraId": "CAM-01",
        "timestamp": t1,
        "latitude": 18.5308,
        "longitude": 73.8474,
        "direction": "SE",
        "speedKmh": 45.0,
        "vehicleClass": "car",
        "detectionConfidence": 0.94,
        "plateConfidence": 0.95,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.92,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/qual_t1.jpg",
        "trackId": 801,
        "frameNumber": 100,
        "bbox": [100.0, 100.0, 200.0, 200.0]
    }

    d2_payload = {
        "cameraId": "CAM-02",
        "timestamp": t2,
        "latitude": 18.5236,
        "longitude": 73.8478,
        "direction": "S",
        "speedKmh": 48.0,
        "vehicleClass": "car",
        "detectionConfidence": 0.92,
        "plateConfidence": 0.93,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.90,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/qual_t2.jpg",
        "trackId": 802,
        "frameNumber": 120,
        "bbox": [110.0, 110.0, 210.0, 210.0]
    }

    d3_payload = {
        "cameraId": "CAM-06",
        "timestamp": t3,
        "latitude": 18.5089,
        "longitude": 73.9260,  # 8.64 km away
        "direction": "E",
        "speedKmh": 50.0,
        "vehicleClass": "car",
        "detectionConfidence": 0.91,
        "plateConfidence": 0.92,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.89,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/qual_t3.jpg",
        "trackId": 803,
        "frameNumber": 150,
        "bbox": [120.0, 120.0, 220.0, 220.0]
    }

    r1 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=d1_payload, auth=INGEST_AUTH, timeout=10)
    assert r1.status_code == 201, f"Ingest 1 failed: {r1.text}"
    id1 = r1.json()["id"]

    r2 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=d2_payload, auth=INGEST_AUTH, timeout=10)
    assert r2.status_code == 201, f"Ingest 2 failed: {r2.text}"
    id2 = r2.json()["id"]

    r3 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=d3_payload, auth=INGEST_AUTH, timeout=10)
    assert r3.status_code == 201, f"Ingest 3 failed: {r3.text}"
    id3 = r3.json()["id"]

    print(f"      Detection 1 (CAM-01): ID={id1}")
    print(f"      Detection 2 (CAM-02): ID={id2}")
    print(f"      Detection 3 (CAM-06): ID={id3}")

    # 2. Establish associations
    print("\n[2/5] Associating detections into Global Vehicle Identity...")
    r_assoc12 = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": id1,
        "candidateDetectionId": id2,
        "autoAssign": True
    }, timeout=10)
    assert r_assoc12.status_code == 200, f"Assoc 1-2 failed: {r_assoc12.text}"
    assoc12 = r_assoc12.json()
    gid_id = assoc12["globalIdentityId"]
    assoc12_id = assoc12["id"]

    r_assoc23 = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": id2,
        "candidateDetectionId": id3,
        "autoAssign": False
    }, timeout=10)
    assert r_assoc23.status_code == 200, f"Assoc 2-3 failed: {r_assoc23.text}"
    assoc23 = r_assoc23.json()
    assoc23_id = assoc23["id"]

    # Manually confirm d3 into the global identity
    r_resolve = requests.post(f"{BACKEND_URL}/api/identities/associations/{assoc23_id}/resolve", json={
        "action": "CONFIRM_MATCH",
        "reviewNotes": "Analyst manual match for trajectory jump test",
        "targetGlobalIdentityId": gid_id
    }, timeout=10)
    assert r_resolve.status_code == 200, f"Resolve failed: {r_resolve.text}"

    conn = get_db_connection()
    conn.run(f"UPDATE vehicle_detections SET global_identity_id = '{gid_id}' WHERE id = {id3}")
    conn.close()

    # 3. Test GET /api/identities/{id}/trajectory/quality
    print("\n[3/5] Testing GET /api/identities/{id}/trajectory/quality...")
    r_qual = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/trajectory/quality", timeout=10)
    assert r_qual.status_code == 200, f"Quality API failed: {r_qual.status_code} - {r_qual.text}"
    qual = r_qual.json()

    print(f"      Identity: {qual['globalIdentityId']} ({qual['label']})")
    print(f"      Overall Quality: {qual['overallQuality']}")
    print(f"      Summary: {qual['summary']}")
    print(f"      Is Cross Camera Confirmed: {qual['isCrossCameraConfirmed']}")
    print(f"      Has Impossible Transitions: {qual['hasImpossibleTransitions']}")
    print(f"      Has Contradictions: {qual['hasContradictions']}")

    # Check overall quality is LOW_CONFIDENCE due to the impossible transition
    assert qual["overallQuality"] == "LOW_CONFIDENCE", f"Expected LOW_CONFIDENCE, got {qual['overallQuality']}"
    assert qual["hasImpossibleTransitions"] is True
    assert qual["hasContradictions"] is True
    assert qual["isCrossCameraConfirmed"] is True

    # Check counts
    counts = qual["counts"]
    print(f"\n      Counts:")
    print(f"        Total Obs: {counts['totalObservations']}, Confirmed: {counts['confirmedObservations']}, Excluded: {counts['excludedObservations']}")
    print(f"        Distinct Cameras: {counts['distinctCameraCount']}")
    print(f"        Total Transitions: {counts['totalTransitions']}, Feasible: {counts['feasibleTransitions']}, Impossible: {counts['impossibleTransitions']}")
    assert counts["confirmedObservations"] == 3
    assert counts["distinctCameraCount"] == 3
    assert counts["totalTransitions"] == 2
    assert counts["impossibleTransitions"] == 1
    assert counts["feasibleTransitions"] == 1

    # Check dimensions
    dims = qual["dimensions"]
    print(f"\n      Dimensions Breakdown:")
    print(f"        Identity Membership: {dims['identityMembership']['status']} ({dims['identityMembership']['summary']})")
    print(f"        Detection Confidence: {dims['detectionConfidence']['status']} (avg={dims['detectionConfidence']['avgConfidence']})")
    print(f"        Plate Consistency: {dims['ocrAndPlateConsistency']['status']} (plates={dims['ocrAndPlateConsistency']['platesSeen']})")
    print(f"        Re-ID Similarity: {dims['reidSimilarity']['status']} (available={dims['reidSimilarity']['isAvailable']}, avg={dims['reidSimilarity']['avgScore']})")
    print(f"        Spatial-Temporal: {dims['spatialTemporalFeasibility']['status']} ({dims['spatialTemporalFeasibility']['summary']})")
    print(f"        Completeness: {dims['evidenceCompleteness']['status']} ({dims['evidenceCompleteness']['summary']})")

    assert dims["identityMembership"]["status"] == "CONFIRMED"
    assert dims["detectionConfidence"]["status"] == "HIGH"
    assert dims["ocrAndPlateConsistency"]["status"] == "CONSISTENT"
    assert dims["reidSimilarity"]["isAvailable"] is True
    assert dims["spatialTemporalFeasibility"]["status"] == "CONTAINS_IMPOSSIBLE_TRANSITIONS"

    # Check evidence lists
    print(f"\n      Supporting Evidence ({len(qual['supportingEvidence'])} items):")
    for s in qual["supportingEvidence"]:
        print(f"        + {s}")
    assert len(qual["supportingEvidence"]) > 0

    print(f"\n      Missing Evidence ({len(qual['missingEvidence'])} items):")
    for m in qual["missingEvidence"]:
        print(f"        - {m}")

    print(f"\n      Warnings & Contradictions ({len(qual['warningsAndContradictions'])} items):")
    for w in qual["warningsAndContradictions"]:
        print(f"        ! {w}")
    assert len(qual["warningsAndContradictions"]) > 0
    assert any("Impossible transition" in w for w in qual["warningsAndContradictions"])

    # 4. Error handling tests
    print("\n[4/5] Testing API error handling...")
    dummy_uuid = "00000000-0000-0000-0000-000000000000"
    r_404 = requests.get(f"{BACKEND_URL}/api/identities/{dummy_uuid}/trajectory/quality")
    assert r_404.status_code == 404, f"Expected 404, got {r_404.status_code}"
    print(f"      Nonexistent UUID returned HTTP 404 NOT_FOUND: {r_404.json()['error']}")

    r_400 = requests.get(f"{BACKEND_URL}/api/identities/invalid-uuid-string/trajectory/quality")
    assert r_400.status_code == 400, f"Expected 400, got {r_400.status_code}"
    print(f"      Invalid UUID string returned HTTP 400 INVALID_REQUEST: {r_400.json()['error']}")

    # 5. Cleanup
    print("\n[5/5] Cleaning up test records from Supabase...")
    conn = get_db_connection()
    conn.run(f"DELETE FROM identity_associations WHERE id IN ('{assoc12_id}', '{assoc23_id}')")
    conn.run(f"UPDATE vehicle_detections SET global_identity_id = NULL WHERE id IN ({id1}, {id2}, {id3})")
    conn.run(f"DELETE FROM global_identities WHERE id = '{gid_id}'")
    conn.run(f"DELETE FROM vehicle_detections WHERE id IN ({id1}, {id2}, {id3})")
    conn.close()
    print("      Test records safely cleaned up.")

    print("\n" + "=" * 80)
    print("ALL BATCH 3.2 TRAJECTORY QUALITY ACCEPTANCE CHECKS PASSED!")
    print("=" * 80)


if __name__ == "__main__":
    run_quality_verification()

