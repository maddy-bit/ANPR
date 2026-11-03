"""
Chapter 9: Complete API Catalog, Database Models, Spatial Indexing, and Algorithms.
"""

def get_content() -> str:
    return r"""
<div class="page-break"></div>

<div class="content-section" id="ch-apis">
  <div class="section-header-tag">CHAPTER 18</div>
  <h2 class="section-title">Complete API Reference (REST, WebSockets &amp; Endpoints)</h2>

  <p>The platform exposes <strong>22 distinct HTTP, WebSocket, and static endpoints</strong> across the Spring Boot application tier and Python AI microservice.</p>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Method</th>
          <th>Exact Endpoint Path</th>
          <th>Auth?</th>
          <th>Subsystem</th>
          <th>Description &amp; Response Contract</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/health</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Liveness health check returning service name, version, and Redis latency.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/cameras</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Returns list of all registered junction camera nodes with coordinates.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/cameras/{id}</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Returns detailed status, stream URL, and direction for a single camera.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/cameras/nearby</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>PostGIS spatial query: returns cameras within <code>radiusKm</code>, sorted by distance.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/vehicles/{plate}</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Vehicle summary: first seen, last seen, camera count, total detections.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/vehicles/{plate}/detections</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Raw chronological observation log across all cameras for target plate.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/vehicles/{plate}/trajectory</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Reconstructed route: discrete camera visits, transition scores, distance, ETA.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/api/detections/ingest</code></td>
          <td>Basic</td>
          <td>Spring Boot</td>
          <td>Ingests a single AI-pipeline detection event; resolves vehicle identity.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/api/detections/ingest/batch</code></td>
          <td>Basic</td>
          <td>Spring Boot</td>
          <td>Batch ingestion endpoint for storing multiple detection events.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/analytics/overview</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>City traffic metrics: vehicle distribution, hourly histogram, busiest junctions.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/api/audit/recent</code></td>
          <td>Basic</td>
          <td>Spring Boot</td>
          <td>Audit log: records who searched which vehicle plate, timestamp, and IP.</td>
        </tr>
        <tr>
          <td><span class="badge-ws">WS</span></td>
          <td><code>/ws/live/{plate}</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Simulated live detection stream pacing waypoints every 3 seconds.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/evidence/{cam}/{file}</code></td>
          <td>None</td>
          <td>Spring Boot</td>
          <td>Static HTTP resource handler serving CCTV snapshot JPEG frames.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/process-video</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Runs full CV pipeline (dehaze &rarr; detect &rarr; track &rarr; OCR) on a video file.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/process-multi-camera</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Orchestrates concurrent multi-camera video feed processing.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/vehicle-journey/{id}</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Reconstructs cross-camera journey waypoints and flags speed anomalies.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/predict-trajectory/{id}</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Spatial Markov model: forecasts top-3 candidate next junctions and arrival ETAs.</td>
        </tr>
        <tr>
          <td><span class="badge-get">GET</span></td>
          <td><code>/geojson-trajectories/{id}</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Generates standard GeoJSON <code>FeatureCollection</code> for GIS mapping.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/detect-plate</code></td>
          <td>None</td>
          <td>FastAPI</td>
          <td>Real-time detector accepting Base64 frames and returning normalized box percentages.</td>
        </tr>
        <tr>
          <td><span class="badge-post">POST</span></td>
          <td><code>/api/yolo/detect</code></td>
          <td>None</td>
          <td>Next.js API</td>
          <td>Edge API proxy forwarding browser video frames to Python AI microservice.</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-database">
  <div class="section-header-tag">CHAPTER 19</div>
  <h2 class="section-title">Database Schemas, PostGIS Spatial Tables &amp; Redis State</h2>

  <h3>1. Relational Entities (PostgreSQL 16 / H2)</h3>

  <h4>A. Table: <code>cameras</code></h4>
  <p>Stores the municipal camera network infrastructure:</p>
  <div class="table-container">
    <table>
      <thead>
        <tr><th>Column Name</th><th>Data Type</th><th>Constraints</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><code>id</code></td><td>VARCHAR(32)</td><td>PRIMARY KEY</td><td>Stable camera identifier (e.g. <code>CAM-01</code>)</td></tr>
        <tr><td><code>name</code></td><td>VARCHAR(128)</td><td>NOT NULL</td><td>Junction location name (e.g. <code>Shivajinagar Chowk</code>)</td></tr>
        <tr><td><code>latitude</code></td><td>DOUBLE PRECISION</td><td>NOT NULL</td><td>WGS 84 GPS latitude</td></tr>
        <tr><td><code>longitude</code></td><td>DOUBLE PRECISION</td><td>NOT NULL</td><td>WGS 84 GPS longitude</td></tr>
        <tr><td><code>direction</code></td><td>VARCHAR(16)</td><td>NULL</td><td>Camera facing compass heading (e.g. <code>SE</code>, <code>NW</code>)</td></tr>
        <tr><td><code>status</code></td><td>VARCHAR(32)</td><td>NOT NULL</td><td>Operational state (<code>ONLINE</code>, <code>PROCESSING</code>, <code>OFFLINE</code>)</td></tr>
        <tr><td><code>location</code></td><td>GEOGRAPHY(Point, 4326)</td><td>GENERATED STORED</td><td>Generated PostGIS geography point with GiST spatial index</td></tr>
      </tbody>
    </table>
  </div>

  <h4>B. Table: <code>vehicles</code></h4>
  <p>The system of record for unique physical vehicle identities:</p>
  <div class="table-container">
    <table>
      <thead>
        <tr><th>Column Name</th><th>Data Type</th><th>Constraints</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><code>plate</code></td><td>VARCHAR(32)</td><td>PRIMARY KEY</td><td>Normalized license plate string (e.g. <code>MH12AB1234</code>)</td></tr>
        <tr><td><code>vehicle_type</code></td><td>VARCHAR(32)</td><td>NULL</td><td>Vehicle classification (<code>Sedan</code>, <code>SUV</code>, <code>Hatchback</code>)</td></tr>
        <tr><td><code>color</code></td><td>VARCHAR(32)</td><td>NULL</td><td>Dominant visual body color (e.g. <code>White</code>, <code>Silver</code>)</td></tr>
        <tr><td><code>make</code></td><td>VARCHAR(64)</td><td>NULL</td><td>Vehicle manufacturer (e.g. <code>Toyota</code>, <code>Hyundai</code>)</td></tr>
        <tr><td><code>model</code></td><td>VARCHAR(64)</td><td>NULL</td><td>Vehicle model name (e.g. <code>Prius</code>, <code>Creta</code>)</td></tr>
      </tbody>
    </table>
  </div>

  <h4>C. Table: <code>vehicle_detections</code></h4>
  <p>High-volume table storing every individual CCTV detection event:</p>
  <div class="table-container">
    <table>
      <thead>
        <tr><th>Column Name</th><th>Data Type</th><th>Constraints</th><th>Description</th></tr>
      </thead>
      <tbody>
        <tr><td><code>id</code></td><td>BIGINT</td><td>PRIMARY KEY IDENTITY</td><td>Auto-incrementing surrogate detection identifier</td></tr>
        <tr><td><code>vehicle_plate</code></td><td>VARCHAR(32)</td><td>FOREIGN KEY &rarr; vehicles(plate)</td><td>Linked vehicle identity (nullable if plate was unreadable)</td></tr>
        <tr><td><code>camera_id</code></td><td>VARCHAR(32)</td><td>FOREIGN KEY &rarr; cameras(id)</td><td>Camera node where detection occurred</td></tr>
        <tr><td><code>timestamp</code></td><td>TIMESTAMP WITH TIME ZONE</td><td>NOT NULL</td><td>Accurate UTC observation timestamp</td></tr>
        <tr><td><code>detection_confidence</code></td><td>DOUBLE PRECISION</td><td>NULL</td><td>YOLOv8 vehicle bounding box detection confidence (0.0–1.0)</td></tr>
        <tr><td><code>plate_text_raw</code></td><td>VARCHAR(32)</td><td>NULL</td><td>Unprocessed OCR string direct from EasyOCR engine</td></tr>
        <tr><td><code>plate_text_normalized</code></td><td>VARCHAR(32)</td><td>NULL</td><td>Canonical uppercase alphanumeric plate string</td></tr>
        <tr><td><code>plate_confidence</code></td><td>DOUBLE PRECISION</td><td>NULL</td><td>EasyOCR character recognition confidence score</td></tr>
        <tr><td><code>image_path</code></td><td>VARCHAR(256)</td><td>NULL</td><td>Relative path to saved JPEG evidence snapshot frame</td></tr>
        <tr><td><code>track_id</code></td><td>INTEGER</td><td>NULL</td><td>ByteTrack persistent multi-object tracking identifier</td></tr>
        <tr><td><code>frame_number</code></td><td>INTEGER</td><td>NULL</td><td>Original video frame index</td></tr>
      </tbody>
    </table>
  </div>

  <div class="page-break"></div>

  <h3>2. Mathematical Formulas &amp; Algorithms Used</h3>

  <h4>A. Great-Circle Haversine Distance (GeoUtils.java)</h4>
  <p>Calculates the spherical surface distance between two junction cameras $(\phi_1, \lambda_1)$ and $(\phi_2, \lambda_2)$ with Earth radius $R = 6371\text{ km}$:</p>
  $$a = \sin^2\left(\frac{\Delta\phi}{2}\right) + \cos(\phi_1)\cos(\phi_2)\sin^2\left(\frac{\Delta\lambda}{2}\right)$$
  $$d = 2R \cdot \text{atan2}(\sqrt{a}, \sqrt{1 - a})$$

  <h4>B. Forward Azimuth / Compass Bearing (GeoUtils.java)</h4>
  <p>Computes the initial heading $\theta \in [0^\circ, 360^\circ)$ from the origin camera to destination camera:</p>
  $$y = \sin(\Delta\lambda)\cos(\phi_2)$$
  $$x = \cos(\phi_1)\sin(\phi_2) - \sin(\phi_1)\cos(\phi_2)\cos(\Delta\lambda)$$
  $$\theta = (\text{atan2}(y, x) \cdot 180 / \pi + 360) \pmod{360}$$

  <h4>C. Levenshtein Edit Distance (identity_scorer.py)</h4>
  <p>Dynamic programming algorithm computing the minimum single-character edits (insertions, deletions, substitutions) required to transform plate string $s_1$ into $s_2$. Normalized string similarity is given by:</p>
  $$\text{Similarity}(s_1, s_2) = 1.0 - \frac{\text{Levenshtein}(s_1, s_2)}{\max(|s_1|, |s_2|)}$$
</div>
"""
