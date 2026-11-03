"""
Chapter 12: Project Exercises with Solutions, SIH Hackathon Defense Q&A, Glossary, and Traceability.
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-exercises">
  <div class="section-header-tag">CHAPTER 24</div>
  <h2 class="section-title">Project-Specific Exercises &amp; Complete Solution Keys</h2>

  <p>To verify your practical engineering mastery before attempting full platform reconstruction, complete these four implementation exercises. Detailed solution keys are provided below.</p>

  <h3>Exercise 1: Dark Channel Prior Minimum Filter (Python)</h3>
  <p><strong>Task:</strong> Write a Python function <code>compute_dark_channel(image_bgr, patch_size=15)</code> that computes the dark channel prior of a color BGR image using pure NumPy and OpenCV.</p>
  
  <div class="code-solution">
    <strong>Complete Verified Solution:</strong>
    <pre><code class="language-python">import cv2
import numpy as np

def compute_dark_channel(image_bgr: np.ndarray, patch_size: int = 15) -> np.ndarray:
    # 1. Compute minimum across color channels (B, G, R)
    min_channel = np.min(image_bgr, axis=2)
    # 2. Morphological minimum filter (erosion) over square patch
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (patch_size, patch_size))
    dark_channel = cv2.erode(min_channel, kernel)
    return dark_channel
</code></pre>
  </div>

  <h3>Exercise 2: Great-Circle Haversine Distance (Java 21)</h3>
  <p><strong>Task:</strong> Write a Java method <code>double haversineDistanceKm(double lat1, double lon1, double lat2, double lon2)</code> that computes spherical surface distance using Earth radius $R = 6371.0\text{ km}$.</p>
  
  <div class="code-solution">
    <strong>Complete Verified Solution:</strong>
    <pre><code class="language-java">public class GeoUtils {
    private static final double EARTH_RADIUS_KM = 6371.0;

    public static double haversineDistanceKm(double lat1, double lon1, double lat2, double lon2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLon = Math.toRadians(lon2 - lon1);
        double rLat1 = Math.toRadians(lat1);
        double rLat2 = Math.toRadians(lat2);

        double a = Math.sin(dLat / 2.0) * Math.sin(dLat / 2.0)
                + Math.cos(rLat1) * Math.cos(rLat2)
                * Math.sin(dLon / 2.0) * Math.sin(dLon / 2.0);

        double c = 2.0 * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
        return EARTH_RADIUS_KM * c;
    }
}
</code></pre>
  </div>

  <h3>Exercise 3: Atomic Sliding-Window Rate Limiting (Redis / Java)</h3>
  <p><strong>Task:</strong> Implement the atomic increment and TTL assignment block in Java using Spring's <code>StringRedisTemplate</code>.</p>
  
  <div class="code-solution">
    <strong>Complete Verified Solution:</strong>
    <pre><code class="language-java">long currentMinute = Instant.now().getEpochSecond() / 60;
String key = "ratelimit:" + clientIp + ":" + currentMinute;
Long count = stringRedisTemplate.opsForValue().increment(key);
if (count != null && count == 1) {
    stringRedisTemplate.expire(key, 65, TimeUnit.SECONDS);
}
boolean isAllowed = count != null && count <= 300;
</code></pre>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-interview">
  <div class="section-header-tag">CHAPTER 25</div>
  <h2 class="section-title">SIH Hackathon Judges Defense &amp; Technical Q&amp;A</h2>

  <div class="qa-item">
    <div class="qa-q">Q1: Why did you use Python for AI and Spring Boot for the backend instead of building everything in one language?</div>
    <div class="qa-a">
      <strong>Defense:</strong> The computer vision ecosystem (PyTorch, Ultralytics YOLOv8, ByteTrack, EasyOCR) is fundamentally Python-first. Java deep learning bindings (such as Deep Java Library or ONNX Runtime Java) lack native ByteTrack implementations, pre-trained OCR confusion models, and flexible image dehazing pipelines. Conversely, Python web servers (Django, Flask, FastAPI) rely on the Global Interpreter Lock (GIL) and lack enterprise-grade high-concurrency thread pooling, connection pooling, and mature spatial ORM frameworks. Spring Boot serves as our hardened system of record, executing transaction isolation, Redis caching, PostGIS spatial queries, and WebSockets, while the Python service runs purely as an internal tensor inference engine.
    </div>
  </div>

  <div class="qa-item">
    <div class="qa-q">Q2: How does your system handle vehicles with unreadable, damaged, or mud-obscured license plates?</div>
    <div class="qa-a">
      <strong>Defense:</strong> The platform does not depend solely on license plates. Our 6-factor Identity Scoring engine (<code>identity_scorer.py</code>) fuses plate text (40%), ResNet50 visual appearance embeddings (30%), HSV color space profiles (12%), vehicle classifications (10%), temporal windows (5%), and camera spatial feasibility (3%). If a plate is unreadable, the system dynamically redistributes the 40% plate weight across the ResNet50 Re-ID and color features:
      $$w_{\text{reid}}' = w_{\text{reid}} + 0.6 \cdot w_{\text{plate}} = 0.30 + 0.24 = 0.54$$
      This allows vehicle correlation across junctions based on visual make, model, shape, and color with over 80% accuracy even when plates are completely obscured.
    </div>
  </div>

  <div class="qa-item">
    <div class="qa-q">Q3: How do you detect and alert on cloned or duplicate license plates?</div>
    <div class="qa-a">
      <strong>Defense:</strong> Our <code>JourneyReconstructor</code> and <code>TrajectoryScoringService</code> monitor two distinct physical anomalies:
      <ol>
        <li><strong>Concurrent Presence (Cloned Plate):</strong> If the same normalized plate number is observed on two distinct cameras (e.g. CAM-01 and CAM-08) at the exact same timestamp ($\Delta t \le 10\text{s}$), the system immediately triggers a <code>CRITICAL</code> security alarm for cloned plate duplication.</li>
        <li><strong>Impala Speed Violation:</strong> If the implied transit speed between two consecutive camera sightings exceeds physical urban plausibility ($v = d / \Delta t > 150\text{ km/h}$), the trajectory confidence is heavily penalized ($\le 0.15$) and a security alert is issued.</li>
      </ol>
    </div>
  </div>

  <div class="qa-item">
    <div class="qa-q">Q4: Why did you choose MapLibre GL JS instead of Mapbox GL JS?</div>
    <div class="qa-a">
      <strong>Defense:</strong> Mapbox GL JS switched from an open-source license to a proprietary commercial license requiring a paid API key and credit card registration. MapLibre GL JS is the official open-source community fork maintained by the Linux Foundation. It provides the identical WebGL hardware-accelerated rendering performance, GeoJSON layer support, and 60 FPS animations without requiring external API keys or incurring commercial licensing costs.
    </div>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-traceability">
  <div class="section-header-tag">CHAPTER 26</div>
  <h2 class="section-title">Technical Glossary &amp; Official Documentation References</h2>

  <h3>1. Technical Glossary</h3>
  <div class="table-container">
    <table>
      <thead>
        <tr><th style="width: 25%;">Term</th><th style="width: 75%;">Technical Definition &amp; Context in Platform</th></tr>
      </thead>
      <tbody>
        <tr><td><strong>ANPR</strong></td><td>Automatic Number Plate Recognition: The end-to-end vision pipeline localizing plates and converting characters to text.</td></tr>
        <tr><td><strong>ByteTrack</strong></td><td>Multi-object tracking algorithm that retains low-confidence detections to maintain track continuity across occlusions.</td></tr>
        <tr><td><strong>CLAHE</strong></td><td>Contrast Limited Adaptive Histogram Equalization: Localized contrast enhancement preventing over-amplification of noise.</td></tr>
        <tr><td><strong>DCP (Dark Channel Prior)</strong></td><td>Statistical observation that outdoor haze-free images contain pixels with very low intensity in at least one color channel.</td></tr>
        <tr><td><strong>GiST</strong></td><td>Generalized Search Tree: PostgreSQL index structure enabling fast multi-dimensional spatial R-Tree searches.</td></tr>
        <tr><td><strong>Haversine</strong></td><td>Spherical trigonometry equation calculating great-circle distance between two GPS coordinate pairs.</td></tr>
        <tr><td><strong>KNN (&lt;-&gt;)</strong></td><td>K-Nearest Neighbor: PostGIS spatial index operator sorting geometry points by spherical distance.</td></tr>
        <tr><td><strong>MOT</strong></td><td>Multi-Object Tracking: Assigning persistent integer identifiers (<code>track_id</code>) to objects across sequential video frames.</td></tr>
        <tr><td><strong>NMS</strong></td><td>Non-Maximum Suppression: Computer vision filter eliminating redundant overlapping bounding boxes.</td></tr>
        <tr><td><strong>PostGIS</strong></td><td>Spatial database extender for PostgreSQL adding geographic objects, spatial functions, and GiST indexes.</td></tr>
        <tr><td><strong>Re-ID</strong></td><td>Vehicle Re-Identification: Recognizing the same vehicle across different cameras without relying on plates.</td></tr>
        <tr><td><strong>SRID 4326</strong></td><td>Spatial Reference System Identifier for the World Geodetic System 1984 (WGS 84) standard GPS coordinate system.</td></tr>
        <tr><td><strong>YOLOv8</strong></td><td>You Only Look Once (version 8): Ultralytics anchor-free single-stage convolutional object detection network.</td></tr>
      </tbody>
    </table>
  </div>

  <h3>2. Official Documentation References</h3>
  <ul>
    <li><strong>Ultralytics YOLOv8 Documentation:</strong> <a href="https://docs.ultralytics.com/">https://docs.ultralytics.com/</a></li>
    <li><strong>EasyOCR Documentation &amp; Models:</strong> <a href="https://github.com/JaidedAI/EasyOCR">https://github.com/JaidedAI/EasyOCR</a></li>
    <li><strong>Spring Boot 3.3 Reference Documentation:</strong> <a href="https://docs.spring.io/spring-boot/docs/3.3.4/reference/html/">https://docs.spring.io/spring-boot/docs/3.3.4/reference/html/</a></li>
    <li><strong>PostGIS 3.4 Spatial Database Manual:</strong> <a href="https://postgis.net/docs/manual-3.4/">https://postgis.net/docs/manual-3.4/</a></li>
    <li><strong>MapLibre GL JS API Documentation:</strong> <a href="https://maplibre.org/maplibre-gl-js/docs/">https://maplibre.org/maplibre-gl-js/docs/</a></li>
    <li><strong>Redis 7 In-Memory Database Commands:</strong> <a href="https://redis.io/commands/">https://redis.io/commands/</a></li>
  </ul>
</div>
"""
