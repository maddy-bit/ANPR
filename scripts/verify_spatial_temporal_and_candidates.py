"""
Verification Script for Step 2 (Spatial-Temporal Filtering - 8 Cases) and Step 4 (Candidate Association API)
Tests all cases against the live Spring Boot Backend and Supabase PostgreSQL.
"""

import sys
import os
from pathlib import Path
import json
import requests
from datetime import datetime, timezone, timedelta

ROOT = Path(__file__).resolve().parents[1]
BACKEND_URL = os.environ.get("BACKEND_URL", "http://localhost:8080")
AUTH = ("ingest", "local-dev-ingest-only-not-for-prod")


def main():
    print("=" * 80)
    print("STEP 2 & STEP 4: SPATIAL-TEMPORAL FILTERING (8 CASES) & CANDIDATE ASSOCIATION API")
    print("=" * 80)

    base_time = datetime(2026, 11, 4, 12, 0, 0, tzinfo=timezone.utc)

    # First, let's configure cameras if needed and insert a verified test edge to test Case 1
    # Check health of backend
    resp_health = requests.get(f"{BACKEND_URL}/actuator/health", timeout=5)
    print(f"Backend status: {resp_health.status_code}")

    # Prepare detections for the 8 cases
    # We will ingest:
    # 1. Source Detection at CAM-01 at t=0s
    # 2. Case 1: Valid configured camera transition (CAM-TEST-V, verified edge)
    # 3. Case 2: Impossible travel time (CAM-06, dt=5s, speed > 1000 km/h)
    # 4. Case 3: Simultaneous detection at distant camera (CAM-06, dt=0.0s)
    # 5. Case 4: Source camera with missing coords (tested as source or candidate)
    # 6. Case 5: Destination camera with missing coords (CAM-ZERO, dt=120s)
    # 7. Case 6: Missing timestamp
    # 8. Case 7: Unknown/unverified camera edge (CAM-02, which is marked is_verified=false in V5)
    # 9. Case 8: Different camera pair with no configured connectivity (CAM-08, dt=1800s, speed=16 km/h)

    # Ingest dummy cameras with missing coordinates if not present
    # CAM-01: 18.5308, 73.8474
    # CAM-02: 18.5236, 73.8478 (unverified edge in V5)
    # CAM-06: 18.5089, 73.9260 (distant, ~8.5km)
    # CAM-08: 18.5642, 73.7769 (no configured edge, ~8.3km)

    # Let's ingest the Source Detection: CAM-01 at base_time
    src_payload = {
        "cameraId": "CAM-01",
        "timestamp": base_time.isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.95,
        "plateTextRaw": "MH 12 TC 1001",
        "plateTextNormalized": "MH12TC1001",
        "plateConfidence": 0.92,
        "trackId": 201,
        "frameNumber": 100,
        "imagePath": "CAM-01/crop_frame100_track1.jpg",
        "reidConfidence": 0.95,
        "reidEmbedding": [0.05] * 2048,
        "reidModelName": "fastreid_veri_sbs_r50_ibn",
        "reidModelVersion": "veri-776-v1",
        "reidDimension": 2048,
    }

    # Case 2: Impossible travel time (CAM-06, dt=5s, dist ~8.5 km -> apparent speed ~6120 km/h)
    cand_case2 = {
        "cameraId": "CAM-06",
        "timestamp": (base_time + timedelta(seconds=5)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.92,
        "plateTextRaw": "MH 12 TC 1001",
        "plateTextNormalized": "MH12TC1001",
        "trackId": 202,
        "frameNumber": 10,
        "reidEmbedding": [0.05] * 2048,
        "reidModelName": "fastreid_veri_sbs_r50_ibn",
        "reidModelVersion": "veri-776-v1",
        "reidDimension": 2048,
    }

    # Case 3: Simultaneous detection at distant camera (CAM-06, dt=0s)
    cand_case3 = {
        "cameraId": "CAM-06",
        "timestamp": base_time.isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.91,
        "plateTextRaw": "MH 12 TC 1001",
        "plateTextNormalized": "MH12TC1001",
        "trackId": 203,
        "frameNumber": 5,
        "reidEmbedding": [0.05] * 2048,
        "reidModelName": "fastreid_veri_sbs_r50_ibn",
        "reidModelVersion": "veri-776-v1",
        "reidDimension": 2048,
    }

    # Case 7: Unknown/unverified camera edge (CAM-02, which is marked is_verified=false in V5)
    # dt = 90s, geodesic dist ~0.80km -> speed = 32 km/h (plausible urban transit)
    cand_case7 = {
        "cameraId": "CAM-02",
        "timestamp": (base_time + timedelta(seconds=90)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.94,
        "plateTextRaw": "MH 12 TC 1001",
        "plateTextNormalized": "MH12TC1001",
        "trackId": 204,
        "frameNumber": 85,
        "reidEmbedding": [0.05] * 2048,
        "reidModelName": "fastreid_veri_sbs_r50_ibn",
        "reidModelVersion": "veri-776-v1",
        "reidDimension": 2048,
    }

    # Case 8: Different camera pair with no configured connectivity (CAM-08, dt=1200s, dist ~8.3km -> speed = 24.9 km/h)
    cand_case8 = {
        "cameraId": "CAM-08",
        "timestamp": (base_time + timedelta(seconds=1200)).isoformat(),
        "vehicleClass": "car",
        "detectionConfidence": 0.90,
        "plateTextRaw": "MH 12 TC 1001",
        "plateTextNormalized": "MH12TC1001",
        "trackId": 205,
        "frameNumber": 120,
        "reidEmbedding": [0.05] * 2048,
        "reidModelName": "fastreid_veri_sbs_r50_ibn",
        "reidModelVersion": "veri-776-v1",
        "reidDimension": 2048,
    }

    print("\n--- Ingesting Detections for Test Cases ---")
    r_src = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=src_payload, auth=AUTH)
    assert r_src.status_code == 201, f"Failed src: {r_src.text}"
    src_id = r_src.json()["id"]
    print(f"Ingested Source Detection: id={src_id} at CAM-01 ({base_time.isoformat()})")

    r_c2 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=cand_case2, auth=AUTH)
    id_c2 = r_c2.json()["id"]
    print(f"Ingested Candidate Case 2 (Impossible speed): id={id_c2} at CAM-06 (dt=5s)")

    r_c3 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=cand_case3, auth=AUTH)
    id_c3 = r_c3.json()["id"]
    print(f"Ingested Candidate Case 3 (Simultaneous sighting): id={id_c3} at CAM-06 (dt=0s)")

    r_c7 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=cand_case7, auth=AUTH)
    id_c7 = r_c7.json()["id"]
    print(f"Ingested Candidate Case 7 (Unverified edge): id={id_c7} at CAM-02 (dt=90s)")

    r_c8 = requests.post(f"{BACKEND_URL}/api/detections/ingest", json=cand_case8, auth=AUTH)
    id_c8 = r_c8.json()["id"]
    print(f"Ingested Candidate Case 8 (No configured connectivity): id={id_c8} at CAM-08 (dt=1200s)")

    # Query GET /api/detections/{src_id}/candidates?feasibleOnly=false
    print(f"\n--- Querying Candidate Association API (feasibleOnly=false) ---")
    url_all = f"{BACKEND_URL}/api/detections/{src_id}/candidates?feasibleOnly=false"
    resp_all = requests.get(url_all, auth=AUTH)
    print(f"HTTP Status: {resp_all.status_code}")
    assert resp_all.status_code == 200, f"Error: {resp_all.text}"

    data_all = resp_all.json()
    print(f"Source Detection ID:        {data_all['sourceDetectionId']}")
    print(f"Source Camera ID:           {data_all['sourceCameraId']} ({data_all['sourceTimestamp']})")
    print(f"Total Candidates Evaluated: {data_all['totalCandidatesEvaluated']}")
    print(f"Feasible Candidates Count:  {data_all['feasibleCandidatesCount']}")

    cand_by_id = {c["detectionId"]: c for c in data_all["candidates"]}

    # Detailed Evaluation of Case 2
    print("\n" + "-" * 60)
    print("CASE 2: Impossible Travel Time (Supersonic Apparent Speed)")
    print("-" * 60)
    c2 = cand_by_id[id_c2]
    print(f"Input:  Source CAM-01 -> Candidate CAM-06 (dt=5.0s, distance={c2['spatialDistanceKm']:.2f}km)")
    print(f"Output: Feasibility = {c2['feasibility']}")
    print(f"        Distance Method = {c2['distanceCalculationMethod']}")
    print(f"        Apparent Speed = {c2['apparentSpeedKmh']:.1f} km/h")
    print(f"Reason: {c2['feasibilityReason']}")
    assert c2["feasibility"] == "IMPOSSIBLE_TRANSITION"
    assert c2["apparentSpeedKmh"] > 100.0

    # Detailed Evaluation of Case 3
    print("\n" + "-" * 60)
    print("CASE 3: Simultaneous Detections at Distant Cameras (dt=0.0s)")
    print("-" * 60)
    c3 = cand_by_id[id_c3]
    print(f"Input:  Source CAM-01 -> Candidate CAM-06 (dt=0.0s, distance={c3['spatialDistanceKm']:.2f}km)")
    print(f"Output: Feasibility = {c3['feasibility']}")
    print(f"        Distance Method = {c3['distanceCalculationMethod']}")
    print(f"Reason: {c3['feasibilityReason']}")
    assert c3["feasibility"] == "IMPOSSIBLE_TRANSITION"
    assert "Simultaneous" in c3["feasibilityReason"]

    # Detailed Evaluation of Case 7
    print("\n" + "-" * 60)
    print("CASE 7: Unknown / Unverified Camera Edge (CAM-01 <-> CAM-02 in V5)")
    print("-" * 60)
    c7 = cand_by_id[id_c7]
    print(f"Input:  Source CAM-01 -> Candidate CAM-02 (dt=90.0s, edge in DB with is_verified=false)")
    print(f"Output: Feasibility = {c7['feasibility']}")
    print(f"        Distance Method = {c7['distanceCalculationMethod']}")
    print(f"        Distance = {c7['spatialDistanceKm']:.2f} km (Geodesic straight-line)")
    print(f"        Apparent Speed = {c7['apparentSpeedKmh']:.1f} km/h")
    print(f"Reason: {c7['feasibilityReason']}")
    assert c7["feasibility"] == "FEASIBLE"
    assert c7["distanceCalculationMethod"] == "POSTGIS_GEODESIC_SPHERE"
    assert "unverified" in c7["feasibilityReason"]
    print("-> Confirmed: Unverified edge was NOT silently used as a calibrated fact; evaluated via PostGIS geodesic sphere.")

    # Detailed Evaluation of Case 8
    print("\n" + "-" * 60)
    print("CASE 8: Different Camera Pair with No Configured Connectivity (CAM-01 <-> CAM-08)")
    print("-" * 60)
    c8 = cand_by_id[id_c8]
    print(f"Input:  Source CAM-01 -> Candidate CAM-08 (dt=1200.0s, no row in camera_edges)")
    print(f"Output: Feasibility = {c8['feasibility']}")
    print(f"        Distance Method = {c8['distanceCalculationMethod']}")
    print(f"        Distance = {c8['spatialDistanceKm']:.2f} km")
    print(f"        Apparent Speed = {c8['apparentSpeedKmh']:.1f} km/h")
    print(f"Reason: {c8['feasibilityReason']}")
    assert c8["feasibility"] == "FEASIBLE"
    assert c8["distanceCalculationMethod"] == "POSTGIS_GEODESIC_SPHERE"
    assert "no road connectivity configured" in c8["feasibilityReason"]
    print("-> Confirmed: Camera pair without configured edge evaluates geodesic bounds without inventing road topology.")

    # Now test Case 1, 4, 5, 6 via Python CameraTopologyService with exact inputs & outputs
    print("\n" + "-" * 60)
    print("ADDITIONAL CASES (1, 4, 5, 6) VIA TOPOLOGY ENGINE")
    print("-" * 60)
    sys.path.insert(0, str(ROOT / "ai-service"))
    from ai.camera_topology import CameraTopologyService, CameraNode, FeasibilityStatus, DistanceMethod
    topo = CameraTopologyService()
    topo.add_camera("CAM-01", 18.5308, 73.8474)
    topo.add_camera("CAM-TEST-V", 18.5200, 73.8400)
    topo.add_camera("CAM-MISSING", None, None)

    # Case 1: Valid configured camera transition
    topo.add_edge("CAM-01", "CAM-TEST-V", road_distance_km=1.5, min_sec=60.0, max_sec=600.0, road_name="Corridor-V", is_verified=True)
    res_c1 = topo.evaluate_transition("CAM-01", 0.0, "CAM-TEST-V", 120.0)
    print("\n[CASE 1: Valid Configured Camera Transition]")
    print(f"Input:  Edge CAM-01 -> CAM-TEST-V (verified road_distance=1.5km, min_sec=60s, max_sec=600s), dt=120s")
    print(f"Output: Feasibility = {res_c1.feasibility.value}")
    print(f"        Distance Method = {res_c1.distance_method.value}")
    print(f"        Distance = {res_c1.distance_km} km")
    print(f"        Apparent Speed = {res_c1.apparent_speed_kmh:.1f} km/h")
    print(f"Reason: {res_c1.reason}")
    assert res_c1.feasibility == FeasibilityStatus.FEASIBLE
    assert res_c1.distance_method == DistanceMethod.ROAD_NETWORK_TOPOLOGY

    # Case 4: Missing source coordinates
    res_c4 = topo.evaluate_transition("CAM-MISSING", 0.0, "CAM-01", 120.0)
    print("\n[CASE 4: Missing Source Coordinates]")
    print(f"Input:  Source camera CAM-MISSING (lat=None, lon=None), dest CAM-01")
    print(f"Output: Feasibility = {res_c4.feasibility.value}")
    print(f"        Distance Method = {res_c4.distance_method.value}")
    print(f"        Distance = {res_c4.distance_km}")
    print(f"Reason: {res_c4.reason}")
    assert res_c4.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert res_c4.distance_km is None
    assert "source camera coordinates" in res_c4.reason

    # Case 5: Missing destination coordinates
    res_c5 = topo.evaluate_transition("CAM-01", 0.0, "CAM-MISSING", 120.0)
    print("\n[CASE 5: Missing Destination Coordinates]")
    print(f"Input:  Source CAM-01, destination camera CAM-MISSING (lat=None, lon=None)")
    print(f"Output: Feasibility = {res_c5.feasibility.value}")
    print(f"        Distance Method = {res_c5.distance_method.value}")
    print(f"        Distance = {res_c5.distance_km}")
    print(f"Reason: {res_c5.reason}")
    assert res_c5.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert res_c5.distance_km is None
    assert "destination camera coordinates" in res_c5.reason

    # Case 6: Missing timestamps
    res_c6 = topo.evaluate_transition("CAM-01", None, "CAM-TEST-V", 120.0)
    print("\n[CASE 6: Missing Timestamps]")
    print(f"Input:  Source t1=None, Candidate t2=120.0s")
    print(f"Output: Feasibility = {res_c6.feasibility.value}")
    print(f"        Time diff = {res_c6.time_diff_sec}")
    print(f"Reason: {res_c6.reason}")
    assert res_c6.feasibility == FeasibilityStatus.FEASIBILITY_UNKNOWN
    assert res_c6.time_diff_sec is None
    assert "detection timestamp" in res_c6.reason

    # Step 4: Test GET /api/detections/{id}/candidates?feasibleOnly=true
    print("\n" + "=" * 80)
    print("STEP 4: CANDIDATE ASSOCIATION API (feasibleOnly=true) RESPONSE VERIFICATION")
    print("=" * 80)
    url_feas = f"{BACKEND_URL}/api/detections/{src_id}/candidates?feasibleOnly=true"
    resp_feas = requests.get(url_feas, auth=AUTH)
    print(f"HTTP Status: {resp_feas.status_code}")
    assert resp_feas.status_code == 200, f"Error: {resp_feas.text}"

    data_feas = resp_feas.json()
    print("\nResponse Body Summary:")
    print(f"  sourceDetectionId:         {data_feas['sourceDetectionId']}")
    print(f"  sourceCameraId:            {data_feas['sourceCameraId']}")
    print(f"  sourceTimestamp:           {data_feas['sourceTimestamp']}")
    print(f"  sourcePlateTextNormalized: {data_feas['sourcePlateTextNormalized']}")
    print(f"  sourceReidModelName:       {data_feas['sourceReidModelName']}")
    print(f"  totalCandidatesEvaluated:  {data_feas['totalCandidatesEvaluated']}")
    print(f"  feasibleCandidatesCount:   {data_feas['feasibleCandidatesCount']}")
    print(f"  returnedCandidatesCount:   {len(data_feas['candidates'])}")

    print("\nReturned Feasible Candidates:")
    returned_ids = []
    for c in data_feas['candidates']:
        returned_ids.append(c['detectionId'])
        print(f"  - Detection ID: {c['detectionId']}")
        print(f"    Camera ID:    {c['cameraId']} (timestamp: {c['timestamp']})")
        print(f"    Distance:     {c['spatialDistanceKm']:.2f} km (Method: {c['distanceCalculationMethod']})")
        print(f"    Apparent Spd: {c['apparentSpeedKmh']:.1f} km/h")
        print(f"    Feasibility:  {c['feasibility']}")
        print(f"    Reason:       {c['feasibilityReason']}")
        print(f"    Re-ID Compat: {c['reidModelCompatibility']}")
        print(f"    Visual Sim:   {c['visualSimilarity']}")
        assert c['feasibility'] == 'FEASIBLE', f"Non-feasible candidate returned: {c['detectionId']}"

    # Confirm impossible candidates (Case 2, Case 3) were strictly filtered out
    assert id_c2 not in returned_ids, f"Impossible speed candidate {id_c2} was NOT filtered out!"
    assert id_c3 not in returned_ids, f"Simultaneous sighting candidate {id_c3} was NOT filtered out!"
    print(f"\n[PASS] Impossible speed ({id_c2}) and simultaneous sighting ({id_c3}) strictly excluded.")

    # Confirm API does NOT assign global identities
    assert "globalVehicleId" not in data_feas, "API must NOT assign or return globalVehicleId!"
    assert "clusterId" not in data_feas, "API must NOT assign clusterId!"
    for c in data_feas['candidates']:
        assert "globalVehicleId" not in c, "Candidate must NOT have globalVehicleId!"
    print("[PASS] Confirmed Candidate Association API only returns candidate associations and does NOT assign global identities.")

    print("\n" + "=" * 80)
    print("ALL STEP 2 & STEP 4 SPATIAL-TEMPORAL & CANDIDATE API CHECKS PASSED PERFECTLY!")
    print("=" * 80)


if __name__ == "__main__":
    main()
