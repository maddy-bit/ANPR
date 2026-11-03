# SIH26127 Evaluator Demonstration Guide

**Project:** City-Wide Multi-Camera Vehicle Intelligence & ANPR Trajectory Platform  
**Organization:** Bharat Electronics Limited (BEL)  
**Problem Statement:** SIH26127  
**System Architecture:** FastAPI (Computer Vision) + Spring Boot (Kinematic & Graph Engine) + Next.js (Tactical UI)

---

## 1. Quick Start (Single-Command Execution)

To start the entire platform with a single command from PowerShell:

```powershell
.\START_DEMO.ps1
```

This controller script automatically:
1. Verifies Python virtual environment, Java 21 JDK, Maven, and Node.js.
2. Checks port availability (8000, 8080, 3000).
3. Spawns all three services in background daemon processes.
4. Polls service health endpoints until all three respond `READY (HTTP 200)`.
5. Automatically opens **`http://localhost:3000`** in your default web browser.

To safely shut down all services when done:
```powershell
.\STOP_DEMO.ps1
```

---

## 2. Live Evaluator Demonstration Script (Step-by-Step)

Follow this 5-minute workflow to demonstrate the full end-to-end intelligence capability to evaluators:

### Step 1: Open the Surveillance Interface
* Open **`http://localhost:3000`** in Chrome / Edge.
* Point out the **tactical GIS vector map** displaying 12 operational camera nodes distributed across the Pune urban corridor (Shivajinagar, FC Road, JM Road, Deccan Gymkhana, Swargate, Hinjewadi, etc.).
* Point out the live telemetry strip indicating system status, online cameras, and real-time sensor readiness.

### Step 2: Ingest CCTV Footage via Real AI Pipeline
* In the top action bar, click **`📹 Ingest Video Feed`**.
* Switch to the **`📁 Upload Custom Video (MP4 / AVI)`** tab.
* In the **Target Camera Node** dropdown, select **`CAM-01 — Shivajinagar Chowk`**.
* Click the file upload box and select **`videos/CAM-01.mp4`** (or drag and drop it).
* *(Optional)* Explain the **Dark Channel Prior (DCP)** toggle: Uses He et al. transmission map estimation to remove smog/fog before object detection.
* Click **`⚙ Start AI Processing Pipeline`**.
* **Observe real-time execution telemetry:**
  * Real-time progress bar (0% $\rightarrow$ 100%).
  * Real frame counter advancing across video frames.
  * Real YOLOv8 vehicle detections identified.
  * ByteTrack track ID continuity maintained across consecutive frames.
  * Optical Character Recognition (EasyOCR) recognizing license plate **`MH12AB12`** (confidence: `0.589`).
  * ResNet50 visual appearance feature extractor generating a 2048-dimensional L2-normalized embedding.
  * Evidence crop automatically saved to `data/evidence/CAM-01/crop_frame75_track1.jpg` and synced to the backend database.

### Step 3: Ingest Second Camera Footage (CAM-02)
* In the modal, select **`CAM-02 — FC Road Junction`**.
* Upload **`videos/CAM-02.mp4`**.
* Click **`⚙ Start AI Processing Pipeline`**.
* When processing finishes, explain that CAM-02 captured a vehicle detection (`crop_frame78_track2.jpg`), but due to distance and angle, the license plate was not readable. 
* Close the modal by clicking **`Close`**.

### Step 4: Reconstruct 3D Target Journey
* On the left column, locate the **Target Search** panel.
* Enter the recognized plate number: **`MH12AB12`**.
* Click **`⚡ Reconstruct 3D Trajectory`**.
* **Evaluator highlights in Target Dossier:**
  * **Vehicle Classification**: Identifies vehicle class (`car`), detection location (`CAM-01 - Shivajinagar Chowk`), and detection timestamp (`2026-09-05T12:00:05Z`).
  * **Evidence Snapshot Viewer**: Right-hand column loads and displays the genuine CCTV evidence frame (`crop_frame75_track1.jpg`) served directly from Spring Boot (`http://localhost:8080/evidence/CAM-01/crop_frame75_track1.jpg`).
  * **Honest Kinematic Warning**: Highlight that the system **honestly refuses to hallucinate a multi-camera trajectory** when data is insufficient. An active warning banner states:
    > **KINEMATIC WARNING:** `NO_RELIABLE_TRAJECTORY_FOUND: only one camera detection available.`
    *(Minimum 2 camera checkpoints required for spatial-temporal trajectory reconstruction).*

### Step 5: Multi-Camera Appearance Re-Identification (Re-ID)
* Explain the Cross-Camera Re-ID capability:
  * Even though `CAM-02` could not read the vehicle's plate, the deep learning ResNet50 Re-ID extractor compared the 2048-dimensional appearance vectors between the vehicle crop in `CAM-01` and `CAM-02`.
  * The computed cosine appearance similarity is **`0.8014`**, exceeding the `0.50` threshold and proving cross-camera vehicle association via visual embeddings alone.

### Step 6: Multi-Camera Scenario Demonstration (Historical Trajectory)
* In the **Target Search** panel, select the preset scenario **`ET3633P (Silver Sedan - 4 Cams)`**.
* Click **`⚡ Reconstruct 3D Trajectory`**.
* **Observe complete multi-camera trajectory reconstruction:**
  * **Vector Map**: Shows GIS polyline connecting `CAM-01` $\rightarrow$ `CAM-02` $\rightarrow$ `CAM-03` $\rightarrow$ `CAM-04`.
  * **Route Confidence Score**: Shows composite score (0.916) incorporating topological feasibility, speed constraints (Haversine velocity check), and appearance consistency.
  * **Interactive Trajectory Player**: Click the Play button to animate the vehicle traversing camera checkpoints in chronological order.
  * **Checkpoint Stepping**: Use the `< Prev` and `Next >` buttons in the Evidence Viewer to review evidence frames at each sequential junction.
  * **Trajectory Predictor**: View next-junction spatial transition probabilities (Markov model) predicting likely forward routes.

---

## 3. Real AI Pipeline Architecture & Roles

| Model / Pipeline Component | Implementation | Role in System |
| :--- | :--- | :--- |
| **YOLOv8s Object Detector** | `ultralytics.YOLO("yolov8s.pt")` | Detects vehicle bounding boxes (cars, trucks, buses, motorcycles) on raw video frames. |
| **ByteTrack Multi-Object Tracker** | `ai.tracker.ByteTrackWrapper` | Maintains persistent local track IDs across consecutive frames, preventing duplicate detections. |
| **Plate Detector & EasyOCR** | `ai.ocr.PlateReader` | Localizes number plate regions and extracts alphanumeric characters with character-level confidence scores. |
| **ResNet50 Re-ID Extractor** | `ai.reid.ReIdService` | Generates 2048-dimensional L2-normalized deep visual appearance embeddings for cross-camera vehicle matching without plates. |
| **Dark Channel Prior (DCP)** | `ai.dehaze.DarkChannelDehazer` | He et al. physical atmospheric scattering dehazer for smog, fog, or nighttime CCTV glare removal. |
| **Kinematic Scorer** | Spring Boot `TrajectoryScoringService` | Evaluates physical feasibility (Haversine transit velocity $\le 150$ km/h, appearance similarity $\ge 0.50$, topology adjacency). |
| **Spatial-Temporal Predictor** | FastAPI `MarkovPredictor` | Computes first-order Markov transition probabilities for next camera node prediction. |

---

## 4. Preserved Video & Evidence Assets

All sample CCTV footage and model weights are pre-packaged and ready in the repository:

* **Sample CCTV Corridor Footage**:
  * `videos/CAM-01.mp4` — Shivajinagar Chowk (Contains vehicle `MH12AB12`)
  * `videos/CAM-02.mp4` — FC Road Junction (Contains passing vehicle from angle)
  * `videos/CAM-03.mp4` through `CAM-11.mp4` — Additional corridor checkpoints
* **Stored Evidence Frames**:
  * `data/evidence/CAM-01/crop_frame75_track1.jpg` (7,155 bytes) — Evidence snapshot for `MH12AB12`
  * `data/evidence/CAM-02/crop_frame78_track2.jpg` — Evidence crop for CAM-02 detection
* **Automated Acceptance Screenshots**:
  * `artifacts/screenshots/01_dashboard_loaded.png`
  * `artifacts/screenshots/02_cam01_file_selected.png`
  * `artifacts/screenshots/03_cam01_completed.png`
  * `artifacts/screenshots/04_cam02_file_selected.png`
  * `artifacts/screenshots/05_cam02_completed.png`
  * `artifacts/screenshots/06_vehicle_profile_mh12ab12.png`
  * `artifacts/screenshots/07_evidence_snapshot_viewer.png`
  * `artifacts/screenshots/08_honest_trajectory_warning.png`

---

## 5. Known Limitations & Technical Honesty

1. **Camera Angle Constraints on OCR**: In real CCTV footage, vehicles passing at sharp angles or beyond 25 meters may not yield legible license plates. The system relies on its 2048-dimensional Re-ID visual appearance embeddings to track vehicles across cameras when plates are unreadable.
2. **Single Camera Checkpoint**: A single camera detection cannot mathematically define velocity or direction. The system honestly warns the user and suppresses route trajectory lines until at least 2 checkpoints are recorded.
3. **Hardware Acceleration**: Video processing runs on standard CPU using PyTorch and OpenCV. Throughput is ~1.5–2.5 FPS on standard CPU, which is suitable for prototype demonstration; production deployment with NVIDIA CUDA GPUs achieves 30+ FPS real-time processing.

