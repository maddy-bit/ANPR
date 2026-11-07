"""
SIH26127 Multi-Camera Vehicle Intelligence Platform
Phase A5 - Batch 3.1: Core Trajectory Reconstruction Verification Script

Tests live against Spring Boot and Supabase PostgreSQL:
  1. Live ingestion of multi-camera vehicle sightings.
  2. Association and global identity assignment.
  3. Live Trajectory Reconstruction API: GET /api/identities/{id}/trajectory.
  4. Chronological ordering, transition evaluation, impossible transition detection,
     and segment partitioning.
  5. Error cases: 404 for nonexistent identity, 400 for malformed UUID.
  6. Clean teardown of test records.
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


def run_trajectory_verification():
    print("=" * 80)
    print("PHASE A5 - BATCH 3.1: TRAJECTORY RECONSTRUCTION VERIFICATION")
    print("=" * 80)

    now = datetime.now(timezone.utc)
    t1 = (now - timedelta(minutes=10)).isoformat()
    t2 = (now - timedelta(minutes=8, seconds=30)).isoformat()  # 90s after t1
    t3 = (now - timedelta(minutes=8, seconds=28)).isoformat()  # 2s after t2 (impossible jump to Hadapsar)

    vec = [0.0] * 512
    vec[0] = 0.8
    vec[1] = 0.6

    test_plate = "MH12TR9999"

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
        "detectionConfidence": 0.95,
        "plateConfidence": 0.93,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.91,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/traj_t1.jpg",
        "trackId": 701,
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
        "detectionConfidence": 0.94,
        "plateConfidence": 0.92,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.90,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/traj_t2.jpg",
        "trackId": 702,
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
        "detectionConfidence": 0.93,
        "plateConfidence": 0.91,
        "plateTextRaw": test_plate,
        "plateTextNormalized": test_plate,
        "reidConfidence": 0.89,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/traj_t3.jpg",
        "trackId": 703,
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
    print(f"      Assoc 1-2: ID={assoc12_id}, Decision={assoc12['decision']}, GID={gid_id}")

    # For d3, associate with d2 and manually confirm it into the identity to test impossible transition
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
    print(f"      Assoc 2-3 confirmed by user: ID={assoc23_id}, Decision=MATCH")

    # Ensure d3 has global_identity_id set
    conn = get_db_connection()
    conn.run(f"UPDATE vehicle_detections SET global_identity_id = '{gid_id}' WHERE id = {id3}")
    conn.close()

    # 3. Test GET /api/identities/{id}/trajectory
    print("\n[3/5] Testing GET /api/identities/{id}/trajectory...")
    r_traj = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/trajectory", timeout=10)
    assert r_traj.status_code == 200, f"Trajectory API failed: {r_traj.status_code} - {r_traj.text}"
    traj = r_traj.json()

    print(f"      Global Identity: {traj['globalIdentityId']} ({traj['label']})")
    print(f"      Confirmed Observations: {traj['confirmedObservations']}")
    print(f"      Total Transitions: {len(traj['transitions'])}")
    print(f"      Segment Count: {traj['segmentCount']}")
    print(f"      Has Impossible Transitions: {traj['hasImpossibleTransitions']}")

    assert traj["confirmedObservations"] == 3, f"Expected 3 confirmed observations, got {traj['confirmedObservations']}"
    assert len(traj["transitions"]) == 2, f"Expected 2 transitions, got {len(traj['transitions'])}"
    assert traj["hasImpossibleTransitions"] is True, "Expected hasImpossibleTransitions to be True"
    assert traj["segmentCount"] == 2, f"Expected 2 disconnected segments, got {traj['segmentCount']}"

    # Verify transition 1: CAM-01 -> CAM-02 is FEASIBLE
    t1_dto = traj["transitions"][0]
    print(f"\n      Transition 1: {t1_dto['fromCameraId']} -> {t1_dto['toCameraId']}")
    print(f"        Status: {t1_dto['status']} ({t1_dto['reason']})")
    print(f"        Connectivity: {t1_dto.get('connectivity')}, VerifiedTopology: {t1_dto.get('isVerifiedTopology')}")
    print(f"        Distance: {t1_dto['distanceKm']} km, Apparent Speed: {t1_dto['apparentSpeedKmh']} km/h")
    assert t1_dto["status"] == "FEASIBLE"
    assert t1_dto["connectivity"] in ("VERIFIED_ROAD_EDGE", "UNVERIFIED_GEODESIC")
    assert t1_dto["distanceKm"] is not None

    # Verify transition 2: CAM-02 -> CAM-06 is IMPOSSIBLE (speed ~15500 km/h)
    t2_dto = traj["transitions"][1]
    print(f"\n      Transition 2: {t2_dto['fromCameraId']} -> {t2_dto['toCameraId']}")
    print(f"        Status: {t2_dto['status']} ({t2_dto['reason']})")
    print(f"        Connectivity: {t2_dto.get('connectivity')}, VerifiedTopology: {t2_dto.get('isVerifiedTopology')}")
    print(f"        Distance: {t2_dto['distanceKm']} km, Apparent Speed: {t2_dto['apparentSpeedKmh']} km/h")
    assert t2_dto["status"] == "IMPOSSIBLE"
    assert t2_dto["apparentSpeedKmh"] > 1000.0

    # Verify segments
    print(f"\n      Segments Breakdown:")
    for s in traj["segments"]:
        print(f"        Segment {s['segmentIndex']}: Type={s.get('segmentType')}, FullyVerified={s.get('isFullyVerifiedRoadRoute')}, Obs Count={s['observationCount']}, From={s['startObservationId']} To={s['endObservationId']}, Break={s['breakReason']}")
        assert "segmentType" in s
        assert "isFullyVerifiedRoadRoute" in s
    assert traj["segments"][0]["observationCount"] == 2
    assert traj["segments"][1]["observationCount"] == 1
    assert traj["segments"][1]["breakReason"] is not None

    # 4. Error handling tests
    print("\n[4/5] Testing API error handling...")
    dummy_uuid = "00000000-0000-0000-0000-000000000000"
    r_404 = requests.get(f"{BACKEND_URL}/api/identities/{dummy_uuid}/trajectory")
    assert r_404.status_code == 404, f"Expected 404, got {r_404.status_code}"
    print(f"      Nonexistent UUID returned HTTP 404 NOT_FOUND: {r_404.json()['error']}")

    r_400 = requests.get(f"{BACKEND_URL}/api/identities/invalid-uuid-string/trajectory")
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
    print("ALL BATCH 3.1 TRAJECTORY RECONSTRUCTION ACCEPTANCE CHECKS PASSED!")
    print("=" * 80)


if __name__ == "__main__":
    run_trajectory_verification()

