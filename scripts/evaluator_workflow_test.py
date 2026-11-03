import requests
import time
import sys
import json

backend_url = "http://localhost:8080"

print("==========================================================")
print("   EVALUATOR WORKFLOW TEST — DUAL-CAMERA REAL VIDEO RUN   ")
print("==========================================================")

# 1. Ingest CAM-01
print("\n[Step 1] Uploading videos/CAM-01.mp4 (binary multipart) to Spring Boot...")
with open("videos/CAM-01.mp4", "rb") as f:
    files = {"file": ("CAM-01.mp4", f, "video/mp4")}
    data = {"camera_id": "CAM-01", "enable_dehaze": "false", "frame_stride": "3"}
    resp1 = requests.post(f"{backend_url}/api/upload-video", files=files, data=data, timeout=30)

assert resp1.status_code == 200, f"Upload 1 failed: {resp1.text}"
job1 = resp1.json()["job_id"]
print(f"-> Job 1 created: {job1}")

for i in range(30):
    time.sleep(1)
    st = requests.get(f"{backend_url}/api/jobs/{job1}", timeout=10).json()
    status = st.get("status")
    prog = st.get("progress")
    print(f"   Poll {i+1}: status={status}, progress={prog}%")
    if status in ["COMPLETED", "FAILED"]:
        details = st.get("details", {})
        print(f"-> Job 1 finished: status={status}, frames={details.get('frames_processed')}, synced={details.get('synced_to_backend')}, plates={details.get('recognized_plates')}")
        break

# 2. Ingest CAM-02 (with slightly shifted timestamp so it represents chronological progression)
print("\n[Step 2] Uploading videos/CAM-02.mp4 (binary multipart) to Spring Boot...")
with open("videos/CAM-02.mp4", "rb") as f:
    files = {"file": ("CAM-02.mp4", f, "video/mp4")}
    data = {"camera_id": "CAM-02", "enable_dehaze": "false", "frame_stride": "3", "start_time": "2026-09-05T12:05:00"}
    resp2 = requests.post(f"{backend_url}/api/upload-video", files=files, data=data, timeout=30)

assert resp2.status_code == 200, f"Upload 2 failed: {resp2.text}"
job2 = resp2.json()["job_id"]
print(f"-> Job 2 created: {job2}")

for i in range(30):
    time.sleep(1)
    st = requests.get(f"{backend_url}/api/jobs/{job2}", timeout=10).json()
    status = st.get("status")
    prog = st.get("progress")
    print(f"   Poll {i+1}: status={status}, progress={prog}%")
    if status in ["COMPLETED", "FAILED"]:
        details = st.get("details", {})
        print(f"-> Job 2 finished: status={status}, frames={details.get('frames_processed')}, synced={details.get('synced_to_backend')}, plates={details.get('recognized_plates')}")
        break

# 3. Verify Database Records
print("\n[Step 3] Querying Vehicle Records for MH12AB12...")
v_resp = requests.get(f"{backend_url}/api/vehicles/MH12AB12", timeout=10)
print(f"-> HTTP {v_resp.status_code}: {v_resp.text}")

# 4. Verify Trajectory
print("\n[Step 4] Querying Trajectory for MH12AB12...")
t_resp = requests.get(f"{backend_url}/api/vehicles/MH12AB12/trajectory", timeout=10)
print(f"-> HTTP {t_resp.status_code}:")
print(json.dumps(t_resp.json(), indent=2))

print("\n==========================================================")
print("            EVALUATOR WORKFLOW TEST COMPLETE              ")
print("==========================================================")
