# 06. AI/ML Service Audit

## Overview
- **Service Root**: `ai-service/`
- **Primary Computer Vision Stack**: Ultralytics YOLOv8, ByteTrack, EasyOCR, PyTorch ResNet50, OpenCV
- **Analytical Intelligence**: Spatial Markov Chain, Multi-Factor Scoring, Haversine Topology Graph

---

## 1. Inventory of AI/ML Models & Algorithms

### 1.1 Vehicle Detector (`VehicleDetector`)
- **Source File**: [`ai-service/ai/vehicle_detector.py#L30-L83`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/vehicle_detector.py#L30-L83)
- **Model Name & Weights**: YOLOv8s (`cfg.models.vehicle_detector` = `ai-service/models/yolov8s.pt`).
- **Weights Presence on Disk**:
  - `ai-service/models/yolov8s.pt` **DOES NOT EXIST** in the repository.
  - The repo root contains `yolov8n.pt` (6.5 MB), but `config.py` specifies `models/yolov8s.pt`.
  - **Auto-Download Behavior**: Line 48 runs `self.model = YOLO(self._weights)`. If the file is missing, Ultralytics attempts to download `yolov8s.pt` from GitHub releases over the internet on first initialization. If offline, initialization fails with a network error.
- **Input Format**: BGR image (NumPy array `uint8`, shape: `[H, W, 3]`).
- **Preprocessing**: Internal letterboxing and normalization inside Ultralytics.
- **Inference Code**:
  ```python
  results = self.model.predict(
      frame,
      conf=self._conf_threshold, # 0.35
      classes=[2, 3, 5, 7],      # COCO: car, motorcycle, bus, truck
      verbose=False
  )[0]
  ```
- **Output Format**: List of `VehicleBox(bbox=(x1, y1, x2, y2), vehicle_class, confidence, class_id)`.
- **Postprocessing**: Rejection of degenerate boxes (`x2 <= x1` or `y2 <= y1`), descending sort by confidence.
- **Invoked at Runtime?**: **Yes**, called by `CameraAgent.process_feed()` and `/process-video`.
- **Reaches Backend?**: **Yes**, mapped to `DetectionEvent` and posted to backend by `scripts/process_video.py`.
- **Fallback / Mock**: None. Fails if weights cannot be downloaded.

---

### 1.2 License Plate Detector (`PlateDetector`)
- **Source File**: [`ai-service/ai/plate_detector.py#L42-L165`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/plate_detector.py#L42-L165)
- **Model Name & Priority**:
  1. Fine-tuned model: `cfg.models.plate_detector` (`ai-service/models/plate_detector_yolov8n.pt`)
  2. Pretrained HuggingFace hub model: `keremberke/yolov8n-license-plate-detection`
  3. Last resort fallback: `yolov8n.pt` (generic COCO object detector!)
- **Weights Presence on Disk**:
  - `plate_detector_yolov8n.pt` **DOES NOT EXIST** on disk.
  - Code falls back to loading `keremberke/yolov8n-license-plate-detection` from HuggingFace.
  - If HuggingFace load fails, lines 66-68 fall back to:
    ```python
    model = YOLO("yolov8n.pt") # generic object detector as crude placeholder!
    ```
- **Input Format**: Vehicle crop BGR image (`[H, W, 3]`), minimum size 80x60 pixels.
- **Inference Code**:
  ```python
  results = self.model.predict(vehicle_crop_bgr, conf=0.30, verbose=False)[0]
  ```
- **Output Format**: List of `PlateBox(bbox=(x1, y1, x2, y2), confidence, area_ratio)`.
- **Postprocessing**:
  - Rejects detections covering >60% of the vehicle crop.
  - Rejects aspect ratios `< 1.0` (plates must be wider than tall).
  - Rejects plates smaller than 30x10 pixels.
- **Invoked at Runtime?**: **Yes**, called in `video_pipeline.py` and `main.py`.
- **Reaches Backend?**: Yes, when successful.

---

### 1.3 Multi-Object Vehicle Tracker (`VehicleTracker`)
- **Source File**: [`ai-service/ai/tracker.py#L40-L128`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/tracker.py#L40-L128)
- **Algorithm**: ByteTrack via Ultralytics (`tracker="bytetrack.yaml"`).
- **Execution Code**:
  ```python
  results_stream = self.model.track(
      source=video_path,
      conf=self._conf,
      classes=[2, 3, 5, 7],
      tracker=cfg.tracking.tracker_config,
      persist=True,
      stream=True,
      verbose=False
  )
  ```
- **Input**: Video file path or RTSP URL.
- **Output**: Yields `(TrackedFrame, original_frame_bgr)` with track IDs scoped to `camera_id`.
- **Invoked at Runtime?**: **Yes**, called during video ingestion.

---

### 1.4 License Plate OCR & Confusable Correction (`OCRService`)
- **Source File**: [`ai-service/ai/ocr.py#L103-L225`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/ocr.py#L103-L225)
- **Model**: EasyOCR (`easyocr.Reader(['en'], gpu=False)`).
- **Pre-OCR Image Enhancement** ([`plate_preprocessor.py#L32-L73`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/plate_preprocessor.py#L32-L73)):
  1. CLAHE contrast enhancement (`clipLimit=3.0`, `tileGrid=(8,8)`).
  2. Bilateral / Gaussian denoising (`kernel=3`).
  3. Unsharp masking (`amount=1.5`).
- **Post-OCR Indian Registration Correction**:
  - Enforces standard Indian pattern `SS DD LL(L) DDDD` (State, District, Series, Number).
  - Swaps confusables based on character index:
    - Positions 0-1 (State code): Converts digits to letters (`0->O`, `1->I`, `5->S`, `8->B`).
    - Positions 2-3 (District code): Converts letters to digits (`O->0`, `I->1`, `S->5`, `B->8`).
    - Positions 4-6 (Series): Converts digits to letters.
    - Last 4 positions: Converts letters to digits.
- **Multi-Frame Majority Voting Fusion** ([`ocr.py#L165-L225`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/ocr.py#L165-L225)):
  - Gathers OCR readings from multiple frames of the same track.
  - Performs confidence-weighted character-by-character majority voting across aligned strings.
- **Invoked at Runtime?**: **Yes**, in video pipeline.
- **Reaches Backend?**: **Yes**, mapped to `plateTextRaw`, `plateTextNormalized`, `plateConfidence`.

---

### 1.5 Appearance Re-Identification (`ReIdService`)
- **Source File**: [`ai-service/ai/reid.py#L25-L135`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/reid.py#L25-L135)
- **Deep Model**: Pretrained ResNet50 (`models.ResNet50_Weights.DEFAULT`).
- **Embedding Layer**: Classification head replaced with `model.fc = torch.nn.Identity()`. Outputs raw 2048-dimensional float32 vector from the `avgpool` layer.
- **Preprocessing**: Normalized to ImageNet mean `[0.485, 0.456, 0.406]` and std `[0.229, 0.224, 0.225]`, resized to `(224, 224)`.
- **Normalization**: Output vector is L2 normalized: `feat = feat / np.linalg.norm(feat)`.
- **Fallback Implementation**: If PyTorch/Torchvision is not available or crashes, lines 106-114 extract a 960-dimensional HSV color histogram (`cv2.calcHist` with bins `[16, 16, 8]`).
- **Similarity Metric**: Cosine similarity (dot product of L2 normalized vectors).
- **CRITICAL AUDIT FINDING: Re-ID Result Never Reaches Database**:
  - The 2048-dimensional embedding is computed in `CameraAgent` ([`video_pipeline.py#L144-L146`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L144-L146)).
  - It is used **only inside Python memory** (`GlobalVehicleRegistry`).
  - It is **dropped** before sending to the Spring Boot backend (`DetectionIngestRequest` has no embedding field).
  - In the Spring Boot backend, `TrajectoryScoringService.java` literally hardcodes:
    ```java
    double appearanceScore = 0.6; // neutral placeholder
    ```
  - **Verdict**: **Re-ID is computed in Python, but completely disconnected from backend route scoring.**

---

### 1.6 Vehicle Color Classifier (`ColorClassifier`)
- **Source File**: [`ai-service/ai/color_classifier.py#L55-L139`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/color_classifier.py#L55-L139)
- **Algorithm**: Unsupervised HSV K-means clustering (k=3) on the upper 67% of the vehicle crop (to avoid ground/tarmac shadows).
- **Mapping**: Largest cluster center mapped to 10 calibrated color ranges (White, Black, Silver, Gray, Red, Orange, Yellow, Green, Blue, Brown).
- **Invoked at Runtime?**: **Yes**, executed in video pipeline and multi-camera orchestrator.
- **Reaches Backend?**: Stored in Python registry, but in backend `VehicleDetection`, color is not stored per detection (only vehicle-level color in `vehicles` table).

---

### 1.7 Adverse Weather & Fog Dehazer (`ImageDehazer`)
- **Source File**: [`ai-service/ai/dehazer.py#L46-L94`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/dehazer.py#L46-L94)
- **Algorithm**: Dark Channel Prior (DCP) defogging.
  1. Computes dark channel prior with 15x15 patch size.
  2. Estimates atmospheric light $A$ from top 0.1% brightest pixels in dark channel.
  3. Estimates transmission map $t(x) = 1 - \omega \cdot \text{dark}(I/A)$.
  4. Restores scene radiance $J(x) = (I(x) - A) / \max(t(x), 0.1) + A$.
  5. Post-processes with CLAHE contrast sharpening in LAB color space.
- **CRITICAL AUDIT FINDING: Dead Code / Never Invoked**:
  - `CameraAgent.__init__` instantiates `self.dehazer = ImageDehazer()` ([`video_pipeline.py#L56`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L56)).
  - `process_feed` accepts argument `enable_dehaze: bool = False` ([`video_pipeline.py#L67`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/services/video_pipeline.py#L67)).
  - **However, `self.dehazer.dehaze()` is never called in `process_feed` or anywhere else in `video_pipeline.py`**.
  - The video frames pass directly from ByteTrack into detector without dehazing.
  - **Verdict**: **Dehazing algorithm is implemented but completely uninvoked at runtime.**

---

### 1.8 Spatial Markov Trajectory Predictor (`TrajectoryPredictor`)
- **Source File**: [`ai-service/ai/trajectory_predictor.py#L25-L132`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/trajectory_predictor.py#L25-L132)
- **Algorithm**: First-order spatial Markov chain.
  - Builds transition matrix $P(\text{cam}_{j} \mid \text{cam}_{i}) = \text{count}(i \to j) / \sum \text{count}(i \to k)$.
  - Fallback when transition count is 0: inverse Haversine distance weighting $1 / \max(\text{dist}, 0.5)$.
  - Travel time estimated from average historical delta or assumed city speed (40 km/h).
- **Invoked at Runtime?**: Fails when called from frontend because frontend passes `plate` instead of `global_id`.
- **Verdict**: **Functional algorithm broken by API parameter mismatch.**

---

### 1.9 Multi-Factor Cross-Camera Identity Scorer (`IdentityScorer`)
- **Source File**: [`ai-service/ai/identity_scorer.py#L74-L179`](file:///c:/Users/Asus/OneDrive/Desktop/ai%20traffic/ai-service/ai/identity_scorer.py#L74-L179)
- **Composite Equation**:
  $$\text{Score} = 0.40 S_{\text{plate}} + 0.30 S_{\text{reid}} + 0.12 S_{\text{color}} + 0.10 S_{\text{type}} + 0.05 S_{\text{temporal}} + 0.03 S_{\text{topo}}$$
- **Components**:
  1. $S_{\text{plate}}$: Normalized Levenshtein edit distance with state code prefix bonus.
  2. $S_{\text{reid}}$: Cosine similarity of ResNet50 embeddings.
  3. $S_{\text{color}}$: 1.0 if identical color, 0.0 otherwise.
  4. $S_{\text{type}}$: 1.0 if compatible vehicle class (e.g. car vs sedan).
  5. $S_{\text{temporal}}$: Exponential decay based on elapsed transit time.
  6. $S_{\text{topo}}$: Haversine distance divided by elapsed time. Flags impossible speed (>150 km/h) as score 0.0.
- **Match Thresholds**:
  - `Score >= 0.75`: Confirmed match.
  - `Score >= 0.50`: Probable match.
- **Invoked at Runtime?**: Used when `MultiCameraOrchestrator` runs multi-feed correlation.

---

## 2. End-to-End Video Processing Sequence Trace

Tracing execution from video file to final detection:

```
[Video File: videos/CAM-01.mp4]
         │
         ▼
[cv2.VideoCapture] ──► Reads FPS, frame count
         │
         ▼
[VehicleTracker.track_video()] ──► Ultralytics ByteTrack (YOLOv8s + lap solver)
         │                         Iterates over frames with frame_stride=5
         ▼
  For each tracked vehicle:
    ├── 1. Crop vehicle bounding box [x1:x2, y1:y2]
    │      (if crop is empty, skip)
    │
    ├── 2. Sample attributes (every plate_sample_stride=3 frames):
    │      ├── ColorClassifier.classify(crop) ──► HSV K-means dominant color
    │      │
    │      ├── ReIdService.embed(crop) ──► ResNet50 avgpool 2048-dim embedding
    │      │
    │      └── PlateDetector.detect(crop) ──► YOLOv8n LP
    │             │
    │             ├── If plate found:
    │             │     Crop plate region
    │             │     PlatePreprocessor.enhance(plate_crop) (CLAHE + unsharp)
    │             │     OCRService.read_plate() ──► EasyOCR readtext()
    │             │     _correct_indian_plate() ──► confusable correction
    │             │     normalize_plate() ──► regex clean
    │             │
    │             └── If plate not found: plate text remains null
    │
    ├── 3. cv2.imwrite() ──► Saves crop to data/evidence/<camera_id>/crop_frame...jpg
    │
    └── 4. Accumulate into track memory (track_plates, track_colors, track_reids)
         │
         ▼
[MultiFrameFusionService.aggregate_vehicle_observation()]
    ├── Majority voting across OCR readings
    ├── Modal vehicle color & type
    └── Average Re-ID embedding
         │
         ▼
[GlobalVehicleRegistry.register_or_update()]
    ├── Matches against existing global vehicles via IdentityScorer
    └── Assigns VEH-GLOBAL-XXXX identity
```

---

## 3. Summary of AI/ML Reality vs Claims

| AI Capability | Claimed Status | Actual Implementation Reality |
| :--- | :--- | :--- |
| **YOLOv8 Vehicle Detection** | Real-time GPU/CPU | **Functional via Ultralytics**, auto-downloads weights if missing. |
| **ByteTrack Tracking** | Cross-frame track ID | **Functional**, scoped strictly per camera. |
| **YOLOv8 Plate Detection** | Fine-tuned Indian ANPR | **Fine-tuned weights missing**, falls back to HuggingFace pretrained or nano COCO placeholder. |
| **EasyOCR Plate Reading** | Intelligent Indian OCR | **Functional**, includes Indian character confusable correction and majority voting. |
| **ResNet50 Re-ID** | 2048-dim Re-ID | **Functional in Python**, but **dropped before backend** and unused in backend trajectory scoring. |
| **DCP Dehazing** | Defogs hazy video feeds | **Implemented as dead code**, never called in `process_feed`. |
| **Real-time Camera ML** | Live webcam/CCTV inference | `/detect-plate` **echoes target plate** without running OCR and uses a hardcoded bumper box heuristic. |
| **Markov Trajectory Prediction**| Junction forecasting | **Algorithm implemented**, but broken in UI due to `plate` vs `global_id` parameter mismatch. |

