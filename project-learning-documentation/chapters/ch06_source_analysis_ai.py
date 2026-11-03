"""
Chapter 6: Detailed Source Code Analysis — Python AI Microservice Modules.
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-ai-core">
  <div class="section-header-tag">CHAPTER 09</div>
  <h2 class="section-title">Detailed Source Code Analysis: AI Microservice Core &amp; Schemas</h2>

  <h3>1. File: <code>ai-service/schemas.py</code> (Pydantic Data Contracts)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>ai-service/schemas.py</code><br>
    <strong>Architectural Layer:</strong> AI Intelligence Tier / Domain Schema Contracts<br>
    <strong>Lines of Code:</strong> 292 lines &bull; <strong>Imports:</strong> <code>pydantic.BaseModel</code>, <code>pydantic.Field</code><br>
    <strong>Consumers:</strong> <code>main.py</code>, <code>video_pipeline.py</code>, <code>multi_camera_orchestrator.py</code>, <code>identity_scorer.py</code>
  </div>

  <h4>Prerequisite Concepts to Understand This File</h4>
  <p>Pydantic V2 data validation, type hints, optional fields, model inheritance, and <code>model_post_init()</code> hooks for field backfilling and backward compatibility.</p>

  <h4>Line-by-Line &amp; Structural Walkthrough</h4>
  <p>The file defines the complete data hierarchy used across video analysis, multi-camera tracking, and trajectory prediction:</p>
  <ul>
    <li><code>PlateObservation</code> (Lines 22–43): Represents an individual OCR read from a single video frame. Fields include <code>raw_text</code>, <code>normalized_text</code>, <code>confidence</code>, <code>plate_bbox</code>, <code>frame_number</code>, and <code>is_uncertain</code>. The <code>model_post_init()</code> method backfills <code>text</code> from <code>raw_text</code> if omitted, ensuring backward compatibility with legacy scripts.</li>
    <li><code>VehicleObservation</code> (Lines 45–86): Represents all aggregated evidence for a locally tracked vehicle within a single camera's field of view. Fields include <code>camera_id</code>, <code>track_id</code>, <code>vehicle_class</code>, <code>color</code>, <code>first_seen_timestamp</code>, <code>last_seen_timestamp</code>, <code>plate_history</code> (a list of <code>PlateObservation</code>s), and <code>reid_embedding</code> (a 2144-dimensional float vector).</li>
    <li><code>IdentityMatchDetail</code> (Lines 89–108): Contains the individual breakdown scores from the 6-factor association engine: <code>plate_score</code>, <code>reid_score</code>, <code>color_score</code>, <code>type_score</code>, <code>temporal_score</code>, and <code>topology_score</code>, culminating in <code>total_score</code> and <code>is_match</code> (boolean).</li>
    <li><code>JourneyWaypoint</code> (Lines 137–147): Represents a single camera arrival/departure event in a vehicle's multi-camera journey. Fields include <code>camera_id</code>, <code>timestamp_enter</code>, <code>timestamp_exit</code>, <code>dwell_time_seconds</code>, <code>transit_speed_kmh</code>, and <code>transit_distance_km</code>.</li>
    <li><code>VehicleJourney</code> (Lines 149–158): The full reconstructed cross-camera journey, containing <code>global_id</code>, <code>primary_plate</code>, <code>waypoints</code>, <code>total_distance_km</code>, <code>duration_seconds</code>, and <code>anomalies</code> (a list of <code>AnomalyAlert</code>s).</li>
    <li><code>TrajectoryPredictionResponse</code> (Lines 183–189): Contains forecasted next-junction predictions: <code>global_id</code>, <code>current_camera_id</code>, and <code>candidates</code> (a list of <code>TrajectoryCandidate</code>s with probability, estimated travel seconds, and arrival ETA).</li>
  </ul>

  <div class="code-exercise">
    <strong>Independent Reconstruction Checklist:</strong>
    1. Define <code>PlateObservation</code> with OCR confidence and bounding box.
    2. Define <code>VehicleObservation</code> embedding a list of <code>PlateObservation</code>s and Re-ID float vectors.
    3. Define <code>JourneyWaypoint</code> and <code>VehicleJourney</code> with anomaly alert lists.
  </div>

  <div class="page-break"></div>

  <h3>2. File: <code>ai-service/config.py</code> (Central Configuration Dataclasses)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>ai-service/config.py</code><br>
    <strong>Architectural Layer:</strong> AI Microservice / System Configuration<br>
    <strong>Lines of Code:</strong> 206 lines &bull; <strong>Imports:</strong> <code>dataclasses.dataclass</code>, <code>pathlib.Path</code><br>
    <strong>Consumers:</strong> All modules in <code>ai-service/ai/</code> and <code>ai-service/services/</code>
  </div>

  <h4>Code Walkthrough &amp; Key Tunables</h4>
  <p>The module establishes a single source of truth for all machine learning thresholds, file paths, and scoring weights:</p>
  <ul>
    <li><code>ModelPaths</code> (Lines 21–28): Resolves paths for <code>yolov8s.pt</code>, <code>plate_detector_yolov8n.pt</code>, and specifies the HuggingFace fallback repository ID (<code>keremberke/yolov8n-license-plate-detection</code>).</li>
    <li><code>DetectionConfig</code> (Lines 30–44): Sets <code>vehicle_confidence_threshold = 0.35</code>, <code>plate_confidence_threshold = 0.30</code>, and maps COCO class IDs (2: car, 3: motorcycle, 5: bus, 7: truck). Sets minimum vehicle crop dimensions to <code>80x60</code> pixels.</li>
    <li><code>OCRConfig</code> (Lines 58–71): Sets OCR languages to English, <code>min_confidence = 0.30</code>, and <code>uncertain_threshold = 0.55</code>. Requires minimum plate crop dimensions of <code>60x20</code> pixels and standardizes plate height to <code>80</code> pixels prior to recognition.</li>
    <li><code>IdentityScoringConfig</code> (Lines 97–120): Declares the normalized weights for cross-camera association:
      <pre><code class="language-python">weight_plate: float = 0.40       # License plate text string similarity
weight_reid: float = 0.30        # ResNet50 visual appearance cosine similarity
weight_color: float = 0.12       # HSV dominant color match
weight_type: float = 0.10        # Vehicle classification compatibility
weight_temporal: float = 0.05    # Temporal elapsed time window
weight_topology: float = 0.03    # Spatial graph travel feasibility</code></pre>
      Sets <code>confirmed_threshold = 0.75</code> and <code>probable_threshold = 0.50</code>.</li>
    <li><code>PipelineConfig</code> (Lines 144–206): Aggregates all dataclasses into the singleton instance <code>cfg = PipelineConfig()</code>. Exposes top-level convenience properties (<code>cfg.DEVICE</code>, <code>cfg.FRAME_STRIDE</code>, <code>cfg.WEIGHT_PLATE_MATCH</code>).</li>
  </ul>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-ai-cv">
  <div class="section-header-tag">CHAPTER 10</div>
  <h2 class="section-title">Detailed Source Code Analysis: Computer Vision &amp; Tracking Modules</h2>

  <h3>1. File: <code>ai-service/ai/dehazer.py</code> (Dark Channel Prior Dehazer)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>ai-service/ai/dehazer.py</code><br>
    <strong>Architectural Layer:</strong> Computer Vision / Image Restoration<br>
    <strong>Lines of Code:</strong> 95 lines &bull; <strong>Imports:</strong> <code>cv2</code>, <code>numpy as np</code>
  </div>

  <h4>Mathematical Theory: Atmospheric Scattering Model</h4>
  <p>In foggy or hazy conditions, light reaches the camera sensor through scattering:
    $$I(x) = J(x)t(x) + A(1 - t(x))$$
  where $I(x)$ is the observed hazy image, $J(x)$ is the true haze-free scene radiance, $A$ is the global atmospheric light, and $t(x)$ is the medium transmission map ($t(x) = e^{-\beta d(x)}$).</p>

  <h4>Line-by-Line Code Walkthrough</h4>
  <ul>
    <li><code>get_dark_channel(image, patch_size=15)</code> (Lines 17–22):
      <pre><code class="language-python">min_channel = np.min(image, axis=2)
kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (patch_size, patch_size))
dark_channel = cv2.erode(min_channel, kernel)
return dark_channel</code></pre>
      Calculates the minimum pixel intensity across RGB channels, then applies morphological minimum filtering (erosion) over a $15\times15$ rectangular window. In non-sky regions, at least one color channel has very low intensity (near zero).</li>
    <li><code>estimate_atmospheric_light(image, dark_channel)</code> (Lines 25–36): Selects the top 0.1% brightest pixels in the dark channel (which correspond to the thickest fog/haze) and identifies the maximum RGB value among those pixels to establish atmospheric light vector $A$.</li>
    <li><code>estimate_transmission(image, A, omega=0.85)</code> (Lines 39–43):
      <pre><code class="language-python">norm_img = image.astype(np.float64) / np.maximum(A, 1.0)
transmission = 1.0 - omega * get_dark_channel(norm_img, patch_size)
return np.clip(transmission, 0.1, 1.0)</code></pre>
      Estimates transmission $t(x)$. A lower bound of $0.1$ is enforced to prevent division-by-zero artifacts in dense fog. Parameter $\omega = 0.85$ preserves a natural sense of aerial perspective.</li>
    <li><code>ImageDehazer.dehaze(image_bgr)</code> (Lines 46–95):
      Reconstructs true scene radiance:
      $$J(x) = \frac{I(x) - A}{\max(t(x), t_0)} + A$$
      Applies a $15\times15$ Gaussian blur to smooth the transmission map and eliminate halo edge artifacts. If <code>try_clahe=True</code>, converts to LAB color space, applies Contrast Limited Adaptive Histogram Equalization (CLAHE) on the L-channel (clip limit 3.0, grid $8\times8$), and converts back to BGR.</li>
  </ul>

  <div class="page-break"></div>

  <h3>2. File: <code>ai-service/ai/tracker.py</code> (ByteTrack Multi-Object Tracking)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>ai-service/ai/tracker.py</code><br>
    <strong>Architectural Layer:</strong> Computer Vision / Multi-Object Tracking (MOT)<br>
    <strong>Lines of Code:</strong> 112 lines &bull; <strong>Imports:</strong> <code>ultralytics.YOLO</code>
  </div>

  <h4>How ByteTrack Works Internally</h4>
  <p>Standard tracking algorithms discard low-confidence detections ($<0.6$), losing tracked targets during temporary occlusion or motion blur. ByteTrack retains both high-confidence and low-confidence detections. It first associates high-confidence detections with existing tracklets using Kalman filter state prediction and bounding box Intersection over Union (IoU). In the second association stage, it matches remaining unmatched tracklets against low-confidence detections, recovering occluded vehicles seamlessly.</p>

  <h4>Key Code Implementation</h4>
  <p>In <code>VehicleTracker.track_frame()</code>, the tracker invokes Ultralytics' native ByteTrack tracker:</p>
  <pre><code class="language-python">results = self.model.track(
    source=frame,
    persist=True,
    classes=[2, 3, 5, 7],     # Car, Motorcycle, Bus, Truck
    conf=0.25,
    tracker="bytetrack.yaml",
    verbose=False
)
if results and results[0].boxes and results[0].boxes.id is not None:
    track_ids = results[0].boxes.id.int().cpu().tolist()
    boxes = results[0].boxes.xyxy.cpu().numpy()
    classes = results[0].boxes.cls.int().cpu().tolist()
    confidences = results[0].boxes.conf.cpu().numpy()
</code></pre>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-ai-ocr">
  <div class="section-header-tag">CHAPTER 11</div>
  <h2 class="section-title">Detailed Source Code Analysis: Plate Detection, OCR &amp; Fusion</h2>

  <h3>1. File: <code>ai-service/ai/ocr.py</code> (EasyOCR &amp; Character Correction)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>ai-service/ai/ocr.py</code><br>
    <strong>Architectural Layer:</strong> Computer Vision / Text Recognition<br>
    <strong>Lines of Code:</strong> 220 lines &bull; <strong>Imports:</strong> <code>easyocr</code>, <code>cv2</code>, <code>re</code>
  </div>

  <h4>Character Confusion Mapping &amp; Indian Plate Regex</h4>
  <p>CCTV cameras capturing fast-moving vehicles suffer from pixelation and angle skew. OCR engines frequently confuse visually similar alphanumeric glyphs. <code>ocr.py</code> implements a domain-specific character substitution dictionary and regex validator:</p>

  <pre><code class="language-python">INDIAN_PLATE_REGEX = re.compile(
    r'^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$'
)

CHAR_CONFUSIONS = {
    'O': '0', 'Q': '0', 'D': '0',
    'I': '1', 'L': '1',
    'Z': '2',
    'B': '8',
    'S': '5',
}

def correct_plate_characters(text: str) -> str:
    cleaned = re.sub(r'[^A-Z0-9]', '', text.upper())
    if len(cleaned) < 4:
        return cleaned
    
    # First 2 chars MUST be state letters (e.g., MH, DL, KA)
    prefix = list(cleaned[:2])
    for i in range(2):
        if prefix[i] == '0': prefix[i] = 'O'
        elif prefix[i] == '1': prefix[i] = 'I'
        elif prefix[i] == '8': prefix[i] = 'B'
        
    # Last 4 chars MUST be registration digits (e.g., 1234)
    suffix = list(cleaned[-4:])
    for i in range(4):
        if suffix[i] in CHAR_CONFUSIONS:
            suffix[i] = CHAR_CONFUSIONS[suffix[i]]
            
    middle = cleaned[2:-4]
    return "".join(prefix) + middle + "".join(suffix)
</code></pre>

  <h3>2. File: <code>ai-service/ai/multi_frame_fusion.py</code> (Multi-Frame Positional Voting)</h3>
  <p>Rather than trusting a single noisy OCR reading, <code>MultiFrameFusionService</code> accumulates OCR observations over all frames where a vehicle is tracked within a camera view:</p>
  <ul>
    <li>Filters candidate reads with confidence $\ge 0.30$.</li>
    <li>Applies a 1.3x bonus weight to strings matching the <code>INDIAN_PLATE_REGEX</code>.</li>
    <li>If multiple candidates share identical length, performs weighted positional character voting across each character index:
      $$\text{Vote}(c, p) = \sum_{i \in \text{Obs}} \text{Confidence}_i \cdot \mathbb{I}(\text{Char}_{i, p} == c)$$
    </li>
    <li>Outputs the consensus plate string and boosted confidence score (capped at 0.98).</li>
  </ul>
</div>
"""
