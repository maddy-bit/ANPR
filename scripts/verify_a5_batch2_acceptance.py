"""
SIH26127 Multi-Camera Vehicle Intelligence Platform
Phase A5 - Batch 2: Acceptance Verification Suite

Verifies:
  1. Live Database Persistence against Supabase PostgreSQL (Entities, FKs, Detection Count, Timestamps).
  2. Full REST API Suite across all 5 Global Identity endpoints (Success, 404, 400, Idempotency, Transitions).
  3. Pre-Restart and Post-Restart State Consistency.
"""

import sys
import os
import re
import json
import uuid
import ssl
from pathlib import Path
from datetime import datetime, timezone, timedelta
import requests
import pg8000.native

ROOT = Path(__file__).resolve().parents[1]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
AI_SERVICE_URL = os.environ.get("AI_SERVICE_URL", "http://127.0.0.1:8000")
INGEST_AUTH = ("ingest", "local-dev-ingest-only-not-for-prod")

STATE_FILE = ROOT / "data" / "benchmarks" / "a5_batch2_persistence_state.json"


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


def step_create_test_records():
    print("\n--- STEP 1: Ingesting Test Pair for Persistence Verification ---")
    now = datetime.now(timezone.utc)
    t1 = (now - timedelta(minutes=5)).isoformat()
    t2 = (now - timedelta(minutes=2)).isoformat()

    # Generate a dummy 512-d normalized embedding
    vec = [0.0] * 512
    vec[0] = 0.8
    vec[1] = 0.6

    det1_payload = {
        "cameraId": "CAM-01",
        "timestamp": t1,
        "latitude": 18.52043,
        "longitude": 73.85674,
        "direction": "N",
        "speedKmh": 45.0,
        "vehicleClass": "car",
        "detectionConfidence": 0.95,
        "plateConfidence": 0.92,
        "plateTextRaw": "MH12PS9999",
        "plateTextNormalized": "MH12PS9999",
        "reidConfidence": 0.90,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/test_p1.jpg",
        "trackId": 901,
        "frameNumber": 100,
        "bbox": [100.0, 100.0, 200.0, 200.0]
    }

    det2_payload = {
        "cameraId": "CAM-02",
        "timestamp": t2,
        "latitude": 18.52843,
        "longitude": 73.86474,
        "direction": "N",
        "speedKmh": 48.0,
        "vehicleClass": "car",
        "detectionConfidence": 0.94,
        "plateConfidence": 0.91,
        "plateTextRaw": "MH12PS9999",
        "plateTextNormalized": "MH12PS9999",
        "reidConfidence": 0.89,
        "reidEmbedding": vec,
        "reidModelName": "fastreid-sbs-R50-ibn",
        "reidModelVersion": "veri776-v1.0",
        "reidDimension": 512,
        "imagePath": "/storage/crops/test_p2.jpg",
        "trackId": 902,
        "frameNumber": 120,
        "bbox": [110.0, 110.0, 210.0, 210.0]
    }

    r1 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=det1_payload, auth=INGEST_AUTH, timeout=10)
    assert r1.status_code == 201, f"Ingest det1 failed: {r1.text}"
    det1 = r1.json()
    d1_id = det1["id"]

    r2 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=det2_payload, auth=INGEST_AUTH, timeout=10)
    assert r2.status_code == 201, f"Ingest det2 failed: {r2.text}"
    det2 = r2.json()
    d2_id = det2["id"]
    print(f"  Ingested Detection 1: ID={d1_id}, Plate={det1['plateTextNormalized']}, Camera={det1['cameraId']}")
    print(f"  Ingested Detection 2: ID={d2_id}, Plate={det2['plateTextNormalized']}, Camera={det2['cameraId']}")

    # Associate them
    assoc_payload = {
        "sourceDetectionId": d1_id,
        "candidateDetectionId": d2_id,
        "autoAssign": True
    }
    r_assoc = requests.post(f"{BACKEND_URL}/api/identities/associate", json=assoc_payload, timeout=10)
    assert r_assoc.status_code == 200, f"Association failed: {r_assoc.text}"
    assoc_res = r_assoc.json()

    assoc_id = assoc_res["id"]
    gid_id = assoc_res["globalIdentityId"]
    decision = assoc_res["decision"]
    print(f"  Association Created: ID={assoc_id}, Decision={decision}, GlobalIdentityId={gid_id}")
    assert decision == "MATCH", f"Expected MATCH, got {decision}"
    assert gid_id is not None, "Expected globalIdentityId to be populated"

    # Query directly from Supabase SQL
    conn = get_db_connection()
    gi_rows = conn.run(f"SELECT id, label, primary_plate, vehicle_class, detection_count, review_status, first_seen_timestamp, last_seen_timestamp FROM global_identities WHERE id = '{gid_id}'")
    assert len(gi_rows) == 1, "Global identity row missing from Supabase"
    gi_row = gi_rows[0]
    print(f"  Supabase direct SQL global_identities: id={gi_row[0]}, label={gi_row[1]}, plate={gi_row[2]}, count={gi_row[4]}, status={gi_row[5]}")

    assoc_rows = conn.run(f"SELECT id, source_detection_id, candidate_detection_id, global_identity_id, decision, review_status, overall_score FROM identity_associations WHERE id = '{assoc_id}'")
    assert len(assoc_rows) == 1, "Association row missing from Supabase"
    assoc_row = assoc_rows[0]
    print(f"  Supabase direct SQL identity_associations: id={assoc_row[0]}, d1={assoc_row[1]}, d2={assoc_row[2]}, gid={assoc_row[3]}, dec={assoc_row[4]}")

    det_rows = conn.run(f"SELECT id, global_identity_id FROM vehicle_detections WHERE id IN ({d1_id}, {d2_id})")
    assert len(det_rows) == 2, "Detections missing from Supabase"
    for dr in det_rows:
        print(f"  Supabase direct SQL vehicle_detections: id={dr[0]}, global_identity_id={dr[1]}")
        assert str(dr[1]) == str(gid_id), f"Detection {dr[0]} FK mismatch: {dr[1]} != {gid_id}"

    conn.close()

    # Save state to disk for post-restart verification
    state = {
        "detection_1_id": d1_id,
        "detection_2_id": d2_id,
        "global_identity_id": gid_id,
        "association_id": assoc_id,
        "label": gi_row[1],
        "plate": gi_row[2],
        "count": gi_row[4],
        "review_status": gi_row[5],
        "created_at": str(now)
    }
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(STATE_FILE, "w") as f:
        json.dump(state, f, indent=2)
    print(f"  Saved state to {STATE_FILE}")
    return state


def step_verify_api_suite(state):
    print("\n--- STEP 2: Verifying All 5 Global Identity API Endpoints ---")
    gid_id = state["global_identity_id"]
    assoc_id = state["association_id"]
    d1_id = state["detection_1_id"]
    d2_id = state["detection_2_id"]
    dummy_uuid = "00000000-0000-0000-0000-000000000000"

    results = []

    # 1. GET /api/identities/{id}
    # 1.1 Success
    r = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.text}"
    body = r.json()
    assert body["id"] == gid_id
    assert body["detectionCount"] == 2
    results.append(("GET /api/identities/{id} [Valid ID]", 200, "PASS"))

    # 1.2 Nonexistent ID
    r = requests.get(f"{BACKEND_URL}/api/identities/{dummy_uuid}")
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"
    results.append(("GET /api/identities/{id} [Nonexistent ID]", 404, "PASS"))

    # 1.3 Invalid UUID format
    r = requests.get(f"{BACKEND_URL}/api/identities/invalid-uuid-string")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    results.append(("GET /api/identities/{id} [Invalid UUID string]", 400, "PASS"))

    # 2. GET /api/identities/{id}/detections
    # 2.1 Success
    r = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/detections?page=0&size=10")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.json()
    assert body["totalElements"] == 2
    assert len(body["content"]) == 2
    results.append(("GET /api/identities/{id}/detections [Valid ID]", 200, "PASS"))

    # 2.2 Nonexistent ID
    r = requests.get(f"{BACKEND_URL}/api/identities/{dummy_uuid}/detections")
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"
    results.append(("GET /api/identities/{id}/detections [Nonexistent ID]", 404, "PASS"))

    # 2.3 Invalid UUID
    r = requests.get(f"{BACKEND_URL}/api/identities/invalid-uuid-string/detections")
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    results.append(("GET /api/identities/{id}/detections [Invalid UUID string]", 400, "PASS"))

    # 3. GET /api/identities/{id}/associations
    # 3.1 Success
    r = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/associations?page=0&size=10")
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.json()
    assert body["totalElements"] >= 1
    results.append(("GET /api/identities/{id}/associations [Valid ID]", 200, "PASS"))

    # 3.2 Nonexistent ID
    r = requests.get(f"{BACKEND_URL}/api/identities/{dummy_uuid}/associations")
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"
    results.append(("GET /api/identities/{id}/associations [Nonexistent ID]", 404, "PASS"))

    # 4. POST /api/identities/associate
    # 4.1 Success & Idempotency
    r = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": d1_id,
        "candidateDetectionId": d2_id,
        "autoAssign": True
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    body = r.json()
    assert body["id"] == assoc_id, "Expected idempotent return of existing association ID"
    results.append(("POST /api/identities/associate [Duplicate Idempotency]", 200, "PASS"))

    # 4.2 Self-association
    r = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": d1_id,
        "candidateDetectionId": d1_id,
        "autoAssign": True
    })
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    results.append(("POST /api/identities/associate [Self-association error]", 400, "PASS"))

    # 4.3 Nonexistent detection ID
    r = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": 999999999,
        "candidateDetectionId": d2_id,
        "autoAssign": True
    })
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"
    results.append(("POST /api/identities/associate [Nonexistent detection]", 404, "PASS"))

    # 4.4 Malformed payload (missing fields)
    r = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "candidateDetectionId": d2_id
    })
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    results.append(("POST /api/identities/associate [Malformed payload]", 400, "PASS"))

    # 5. POST /api/identities/associations/{id}/resolve
    # 5.1 Invalid action
    r = requests.post(f"{BACKEND_URL}/api/identities/associations/{assoc_id}/resolve", json={
        "action": "INVALID_ACTION_NAME",
        "reviewNotes": "Invalid test action"
    })
    assert r.status_code == 400, f"Expected 400, got {r.status_code}"
    results.append(("POST /api/identities/associations/{id}/resolve [Invalid action]", 400, "PASS"))

    # 5.2 Nonexistent association ID
    r = requests.post(f"{BACKEND_URL}/api/identities/associations/{dummy_uuid}/resolve", json={
        "action": "CONFIRM_MATCH",
        "reviewNotes": "Nonexistent test"
    })
    assert r.status_code == 404, f"Expected 404, got {r.status_code}"
    results.append(("POST /api/identities/associations/{id}/resolve [Nonexistent association ID]", 404, "PASS"))

    # 5.3 Valid review transitions
    # A) CONFIRM_MATCH
    r = requests.post(f"{BACKEND_URL}/api/identities/associations/{assoc_id}/resolve", json={
        "action": "CONFIRM_MATCH",
        "reviewNotes": "Verified by operator in gate suite"
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    assert r.json()["reviewStatus"] == "CONFIRMED_BY_USER"
    results.append(("POST /api/identities/associations/{id}/resolve [CONFIRM_MATCH]", 200, "PASS"))

    # B) FLAGGED_CONFLICT
    r = requests.post(f"{BACKEND_URL}/api/identities/associations/{assoc_id}/resolve", json={
        "action": "FLAG_CONFLICT",
        "reviewNotes": "Flagged for supervisor inspection"
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    assert r.json()["reviewStatus"] == "FLAGGED_CONFLICT"
    results.append(("POST /api/identities/associations/{id}/resolve [FLAG_CONFLICT]", 200, "PASS"))

    # C) REJECT_MATCH
    r = requests.post(f"{BACKEND_URL}/api/identities/associations/{assoc_id}/resolve", json={
        "action": "REJECT_MATCH",
        "reviewNotes": "Rejected by supervisor"
    })
    assert r.status_code == 200, f"Expected 200, got {r.status_code}"
    assert r.json()["reviewStatus"] == "REJECTED_BY_USER"
    results.append(("POST /api/identities/associations/{id}/resolve [REJECT_MATCH]", 200, "PASS"))

    for endpoint, code, status in results:
        print(f"  [{status}] {endpoint} -> HTTP {code}")

    print(f"  All {len(results)} API tests passed successfully!")


def step_verify_post_restart():
    print("\n--- STEP 3: Verifying Persistence and Idempotency Post-Restart ---")
    assert STATE_FILE.exists(), f"State file {STATE_FILE} not found"
    with open(STATE_FILE) as f:
        state = json.load(f)

    gid_id = state["global_identity_id"]
    assoc_id = state["association_id"]
    d1_id = state["detection_1_id"]
    d2_id = state["detection_2_id"]
    expected_plate = state["plate"]
    expected_count = state["count"]

    # 1. Direct Supabase PostgreSQL Query
    print("  [1] Querying Supabase PostgreSQL directly over SSL...")
    conn = get_db_connection()
    gi_rows = conn.run(f"SELECT id, label, primary_plate, detection_count, review_status FROM global_identities WHERE id = '{gid_id}'")
    assert len(gi_rows) == 1, f"Global identity {gid_id} lost after restart!"
    gi_row = gi_rows[0]
    print(f"      Direct SQL global_identities row: id={gi_row[0]}, label={gi_row[1]}, plate={gi_row[2]}, count={gi_row[3]}")
    assert gi_row[2] == expected_plate, f"Plate mismatch: {gi_row[2]} != {expected_plate}"
    assert gi_row[3] == expected_count, f"Detection count changed: {gi_row[3]} != {expected_count}"

    assoc_rows = conn.run(f"SELECT id, source_detection_id, candidate_detection_id, global_identity_id, decision, review_status FROM identity_associations WHERE id = '{assoc_id}'")
    assert len(assoc_rows) == 1, f"Association {assoc_id} lost after restart!"
    assoc_row = assoc_rows[0]
    print(f"      Direct SQL identity_associations row: id={assoc_row[0]}, d1={assoc_row[1]}, d2={assoc_row[2]}, gid={assoc_row[3]}, reviewStatus={assoc_row[5]}")

    det_rows = conn.run(f"SELECT id, global_identity_id FROM vehicle_detections WHERE id IN ({d1_id}, {d2_id})")
    assert len(det_rows) == 2, "Detections lost after restart!"
    for dr in det_rows:
        assert str(dr[1]) == str(gid_id), f"Detection {dr[0]} lost its global identity FK! Found {dr[1]}"
        print(f"      Direct SQL vehicle_detection {dr[0]} FK: global_identity_id={dr[1]}")

    # 2. HTTP API Verification
    print("  [2] Querying REST API after Spring Boot restart...")
    r = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}")
    assert r.status_code == 200, f"API failed to fetch identity: {r.status_code}"
    api_gid = r.json()
    assert api_gid["primaryPlate"] == expected_plate
    assert api_gid["detectionCount"] == expected_count
    print(f"      API GET /api/identities/{gid_id} verified: plate={api_gid['primaryPlate']}, count={api_gid['detectionCount']}")

    r_det = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/detections")
    assert r_det.status_code == 200, f"API failed to fetch detections: {r_det.status_code}"
    assert r_det.json()["totalElements"] == 2
    print(f"      API GET /api/identities/{gid_id}/detections verified: totalElements={r_det.json()['totalElements']}")

    r_assoc = requests.get(f"{BACKEND_URL}/api/identities/{gid_id}/associations")
    assert r_assoc.status_code == 200, f"API failed to fetch associations: {r_assoc.status_code}"
    assert r_assoc.json()["totalElements"] >= 1
    print(f"      API GET /api/identities/{gid_id}/associations verified: totalElements={r_assoc.json()['totalElements']}")

    # 3. Idempotency Test
    print("  [3] Testing duplicate association request post-restart...")
    r_dup = requests.post(f"{BACKEND_URL}/api/identities/associate", json={
        "sourceDetectionId": d1_id,
        "candidateDetectionId": d2_id,
        "autoAssign": True
    })
    assert r_dup.status_code == 200, f"Duplicate associate request failed: {r_dup.status_code}"
    dup_body = r_dup.json()
    assert dup_body["id"] == assoc_id, f"Duplicate request created a new association! {dup_body['id']} != {assoc_id}"
    print(f"      Idempotency confirmed: Returned existing association ID {dup_body['id']}")

    # 4. Clean up test records
    print("  [4] Cleaning up test records from Supabase...")
    conn.run(f"DELETE FROM identity_associations WHERE id = '{assoc_id}'")
    conn.run(f"UPDATE vehicle_detections SET global_identity_id = NULL WHERE id IN ({d1_id}, {d2_id})")
    conn.run(f"DELETE FROM global_identities WHERE id = '{gid_id}'")
    conn.run(f"DELETE FROM vehicle_detections WHERE id IN ({d1_id}, {d2_id})")
    conn.close()
    print("      Test records safely cleaned up.")
    if STATE_FILE.exists():
        STATE_FILE.unlink()
    print("  Post-restart persistence and idempotency verification PASSED!")


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode == "pre":
        state = step_create_test_records()
        step_verify_api_suite(state)
    elif mode == "api":
        with open(STATE_FILE) as f:
            state = json.load(f)
        step_verify_api_suite(state)
    elif mode == "post":
        step_verify_post_restart()
    else:
        state = step_create_test_records()
        step_verify_api_suite(state)
        print("\nPre-restart verification complete. Restart Spring Boot and run with 'post'.")
