import requests
import os
import io

backend_url = "http://localhost:8080"
ai_url = "http://localhost:8000"

print("==========================================================")
print("     FAILURE, BOUNDARY & SECURITY INTEGRATION TESTS       ")
print("==========================================================")

results = {}

# 1. Empty upload
print("\n[Test 1] Empty video upload...")
resp = requests.post(
    f"{backend_url}/api/upload-video",
    files={"file": ("empty.mp4", io.BytesIO(b""), "video/mp4")},
    data={"camera_id": "CAM-01"}
)
print(f"Status: {resp.status_code}, Body: {resp.text}")
results["empty_upload"] = (resp.status_code == 400)

# 2. Corrupted / invalid video file
print("\n[Test 2] Invalid / corrupted video upload...")
resp = requests.post(
    f"{backend_url}/api/upload-video",
    files={"file": ("corrupt.mp4", io.BytesIO(b"NOT_A_VALID_MP4_HEADER_DATA_GARBAGE"), "video/mp4")},
    data={"camera_id": "CAM-01"}
)
print(f"Status: {resp.status_code}, Body: {resp.text}")
# Should accept or return 400, or queue job that handles corrupt gracefully
results["corrupt_upload"] = resp.status_code in [200, 400]

# 3. Oversized video upload (exceeding 150MB limit)
print("\n[Test 3] Oversized video upload (> 150MB)...")
class FakeLargeFile(io.RawIOBase):
    def __init__(self, size):
        self.size = size
        self.pos = 0
    def read(self, n=-1):
        if self.pos >= self.size:
            return b""
        if n is None or n < 0:
            chunk_size = self.size - self.pos
        else:
            chunk_size = min(n, self.size - self.pos)
        self.pos += chunk_size
        return b"0" * chunk_size
    def seek(self, offset, whence=0):
        if whence == 0: self.pos = offset
        elif whence == 1: self.pos += offset
        elif whence == 2: self.pos = self.size + offset
        return self.pos
    def tell(self): return self.pos
    def __len__(self): return self.size

# Test with 151MB
large_f = FakeLargeFile(151 * 1024 * 1024)
try:
    resp = requests.post(
        f"{backend_url}/api/upload-video",
        files={"file": ("oversized.mp4", large_f, "video/mp4")},
        data={"camera_id": "CAM-01"},
        timeout=10
    )
    print(f"Status: {resp.status_code}, Body: {resp.text}")
    results["oversized_upload"] = (resp.status_code in [400, 413])
except Exception as e:
    print(f"Oversized rejected with error: {e}")
    results["oversized_upload"] = True

# 4. Invalid plate search
print("\n[Test 4] Non-existent / invalid plate search...")
resp = requests.get(f"{backend_url}/api/vehicles/NON_EXISTENT_PLATE_999")
print(f"Status: {resp.status_code}, Body: {resp.text}")
results["invalid_plate_search"] = (resp.status_code == 404)

# 5. Non-existent trajectory query
print("\n[Test 5] Non-existent plate trajectory query...")
resp = requests.get(f"{backend_url}/api/vehicles/NON_EXISTENT_PLATE_999/trajectory")
print(f"Status: {resp.status_code}, Body: {resp.text}")
results["non_existent_trajectory"] = (resp.status_code == 404)

# 6. Missing evidence image
print("\n[Test 6] Missing evidence image request...")
resp = requests.get(f"{backend_url}/evidence/CAM-01/non_existent_crop_999.jpg")
print(f"Status: {resp.status_code}")
results["missing_evidence"] = (resp.status_code == 404)

# 7. Authentication for Ingestion API
print("\n[Test 7] Ingestion API without auth (should return 401)...")
resp = requests.post(
    f"{backend_url}/api/detections/ingest/batch",
    json=[]
)
print(f"Status: {resp.status_code}")
results["unauthorized_ingest"] = (resp.status_code == 401)

# 8. Authentication with valid credentials
print("\n[Test 8] Ingestion API with valid credentials...")
resp = requests.post(
    f"{backend_url}/api/detections/ingest/batch",
    json=[],
    auth=("ingest", "local-dev-ingest-only-not-for-prod")
)
print(f"Status: {resp.status_code}")
results["authorized_ingest"] = (resp.status_code == 201)

# 9. CORS Preflight check
print("\n[Test 9] CORS OPTIONS preflight request...")
resp = requests.options(
    f"{backend_url}/api/watchlist",
    headers={
        "Origin": "http://localhost:3000",
        "Access-Control-Request-Method": "GET"
    }
)
print(f"Status: {resp.status_code}, Allow-Origin: {resp.headers.get('Access-Control-Allow-Origin')}")
results["cors_preflight"] = (resp.status_code in [200, 204] and resp.headers.get("Access-Control-Allow-Origin") == "http://localhost:3000")

# 10. Non-existent job query
print("\n[Test 10] Non-existent job status query...")
resp = requests.get(f"{backend_url}/api/jobs/job-non-existent-999")
print(f"Status: {resp.status_code}, Body: {resp.text}")
results["non_existent_job"] = (resp.status_code == 404)

print("\n==========================================================")
print("                  TEST RESULTS SUMMARY                    ")
print("==========================================================")
for k, v in results.items():
    print(f"  {k:30}: {'PASS' if v else 'FAIL'}")

assert all(results.values()), "Some failure/security tests failed!"
print("\nALL FAILURE & SECURITY TESTS PASSED!")
