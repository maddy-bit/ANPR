"""
Chapter 4: Ordered Learning Roadmap, Language Fundamentals, and Core Engineering Concepts.
"""

def get_content() -> str:
    return """
<div class="page-break"></div>

<div class="content-section" id="ch-roadmap">
  <div class="section-header-tag">CHAPTER 06</div>
  <h2 class="section-title">Complete Prerequisite Learning Roadmap</h2>

  <p>To recreate this platform independently from scratch without relying on external guidance, you must master the technologies across eight progressive levels, starting from foundational systems tooling to advanced spatial databases and deep learning inference.</p>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 0</span>
      <span class="level-title">Absolute Systems &amp; Tooling Prerequisites</span>
    </div>
    <p><strong>Topics:</strong> Terminal shell navigation, POSIX command syntax, environment variables, standard streams (<code>stdin</code>, <code>stdout</code>, <code>stderr</code>), exit codes, Git branch management, Python virtual environments (<code>python -m venv</code>), Maven lifecycle (<code>clean</code>, <code>compile</code>, <code>package</code>), Node.js package management (<code>npm install</code>, <code>npm run dev</code>).</p>
    <p><strong>Where Used:</strong> <code>scripts/smoke_test.sh</code>, <code>backend/pom.xml</code>, <code>frontend/package.json</code>, <code>ai-service/requirements.txt</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 1</span>
      <span class="level-title">Core Programming Languages (Python 3.11, Java 21, TypeScript 5)</span>
    </div>
    <p><strong>Topics:</strong> Strongly typed Python dataclasses, asynchronous event loops (<code>asyncio</code>), Java 21 records, Pattern Matching, Stream API, <code>java.time.Instant</code>, TypeScript discriminated union types, strict null checks, and reactive state immutability.</p>
    <p><strong>Where Used:</strong> <code>ai-service/schemas.py</code>, <code>backend/.../trajectory/TrajectoryEngine.java</code>, <code>frontend/src/lib/api.ts</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 2</span>
      <span class="level-title">Framework Architecture &amp; Core Abstractions</span>
    </div>
    <p><strong>Topics:</strong> FastAPI request validation and lifespan events, Spring Boot 3.3.4 Dependency Injection and Inversion of Control, Hibernate JPA ORM entity persistence, Spring Security filter chains, Next.js 16 App Router architecture, React 19 Client Components, and Tailwind CSS v4 design systems.</p>
    <p><strong>Where Used:</strong> <code>ai-service/main.py</code>, <code>backend/.../BackendApplication.java</code>, <code>frontend/src/app/page.tsx</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 3</span>
      <span class="level-title">Computer Vision, Tracking &amp; OCR Engineering</span>
    </div>
    <p><strong>Topics:</strong> YOLOv8 anchor-free convolutional object detection, Non-Maximum Suppression (NMS), ByteTrack multi-object tracking (MOT) with Kalman state filtering and Hungarian bipartite matching, EasyOCR CRNN with CTC loss, Dark Channel Prior (DCP) atmospheric dehazing, and ResNet50 visual appearance embeddings.</p>
    <p><strong>Where Used:</strong> <code>ai-service/ai/vehicle_detector.py</code>, <code>tracker.py</code>, <code>ocr.py</code>, <code>dehazer.py</code>, <code>reid.py</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 4</span>
      <span class="level-title">Spatial Algorithms &amp; Heuristic Identity Association</span>
    </div>
    <p><strong>Topics:</strong> Multi-factor identity fusion equation with dynamic weight redistribution, Levenshtein string edit distance, Great-Circle Haversine distance, forward compass azimuth calculation, kinematic velocity validation, PostGIS 3.4 <code>geography(Point, 4326)</code> with GiST indexes, and <code>ST_DWithin</code> radius queries.</p>
    <p><strong>Where Used:</strong> <code>ai-service/ai/identity_scorer.py</code>, <code>backend/.../trajectory/TrajectoryScoringService.java</code>, <code>SpatialCameraService.java</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 5</span>
      <span class="level-title">High-Throughput Systems, Caching &amp; WebSockets</span>
    </div>
    <p><strong>Topics:</strong> Redis sliding-window rate limiting using minute-bucketed keys with fail-open fallback, Spring Cache eviction upon entity ingestion, Redis Pub/Sub event distribution, native WebSocket binary/text frames, and scheduled paced event streaming.</p>
    <p><strong>Where Used:</strong> <code>backend/.../security/RedisRateLimiterFilter.java</code>, <code>LiveTrackingWebSocketHandler.java</code>, <code>liveClient.ts</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 6</span>
      <span class="level-title">Geospatial WebGL GIS &amp; Reactive Frontend HUD</span>
    </div>
    <p><strong>Topics:</strong> MapLibre GL JS vector canvas rendering, GeoJSON <code>LineString</code> trajectory interpolation, animated marker replay pacing, dynamic 3D CSS perspective card tilting, canvas-based wireframe hologram rendering, and client-side PDF document generation.</p>
    <p><strong>Where Used:</strong> <code>frontend/src/components/InvestigationMap.tsx</code>, <code>EvidenceViewer.tsx</code>, <code>VehicleHologram3D.tsx</code>.</p>
  </div>

  <div class="level-box">
    <div class="level-header">
      <span class="level-badge">LEVEL 7</span>
      <span class="level-title">Testing, Production Hardening &amp; Zero-to-One Recreation</span>
    </div>
    <p><strong>Topics:</strong> Automated unit testing with JUnit 5 and Mockito, end-to-end black-box API smoke testing with Bash and curl, multi-stage Docker containerization, healthchecks, and step-by-step milestone reconstruction.</p>
    <p><strong>Where Used:</strong> <code>scripts/smoke_test.sh</code>, <code>backend/src/test/...</code>, <code>docker-compose.yml</code>.</p>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-languages">
  <div class="section-header-tag">CHAPTER 07</div>
  <h2 class="section-title">Programming Language Fundamentals Used in the Project</h2>

  <h3>1. Python 3.11+ Core Language Features</h3>
  <p>The AI service relies extensively on Python 3.11's enhanced typing and performance optimizations:</p>

  <h4>A. Strongly Typed Dataclasses</h4>
  <p>Rather than using loose dictionaries or raw tuples, all configuration objects in <code>ai-service/config.py</code> use <code>@dataclass</code>. This guarantees field validation, immutability where needed, and clear IDE auto-completion:</p>
  <pre><code class="language-python">from dataclasses import dataclass, field
from pathlib import Path

@dataclass
class DetectionConfig:
    vehicle_confidence_threshold: float = 0.35
    plate_confidence_threshold: float = 0.30
    vehicle_classes: dict[int, str] = field(default_factory=lambda: {
        2: "car", 3: "motorcycle", 5: "bus", 7: "truck"
    })
</code></pre>

  <h4>B. Asynchronous Concurrency with FastAPI</h4>
  <p>FastAPI uses Python's <code>asyncio</code> event loop. Endpoints like <code>@app.get("/health")</code> are declared <code>async def</code>, allowing non-blocking Redis health check pings while synchronous heavy computer vision operations run in worker thread pools:</p>
  <pre><code class="language-python">@app.get("/health")
async def health() -> dict:
    redis_info = await redis_service.check_health()
    return {"status": "ok", "redis": redis_info}
</code></pre>

  <h3>2. Java 21 Modern Language Features</h3>
  <p>The backend application is written in Java 21, taking full advantage of modern syntax enhancements:</p>

  <h4>A. Java Records (Immutable Data Transfer Objects)</h4>
  <p>Java records eliminate boilerplate getters, setters, <code>equals()</code>, <code>hashCode()</code>, and <code>toString()</code> methods. All DTOs in <code>backend/.../dto/</code> are declared as records:</p>
  <pre><code class="language-java">package com.cityai.backend.dto;

import java.time.Instant;

public record TrajectoryPointDto(
    String cameraId,
    String cameraName,
    Double latitude,
    Double longitude,
    String direction,
    Instant timestamp,
    Double plateConfidence,
    Double detectionConfidence,
    String imagePath,
    int detectionCount,
    Double incomingTransitionConfidence,
    String transitionNote
) {}
</code></pre>

  <h4>B. Stream API &amp; Modern Time API</h4>
  <p>In <code>TrajectoryEngine.java</code>, detections are grouped and averaged using functional Stream pipelines and <code>java.time.Instant</code>:</p>
  <pre><code class="language-java">double overallConfidence = transitions.stream()
    .mapToDouble(t -> t.score().confidence())
    .average()
    .orElse(0.0);

long totalDurationMinutes = Duration.between(
    visits.get(0).firstSeen(), 
    visits.get(visits.size() - 1).firstSeen()
).toMinutes();
</code></pre>

  <h3>3. TypeScript 5 &amp; Modern React 19</h3>
  <p>The frontend codebase uses TypeScript 5 for end-to-end type safety between the Spring Boot backend REST endpoints and React components:</p>

  <h4>A. Discriminated Unions for WebSocket Events</h4>
  <p>In <code>frontend/src/lib/liveClient.ts</code>, WebSocket messages are modeled as discriminated unions. TypeScript automatically narrows event types based on the <code>type</code> string literal:</p>
  <pre><code class="language-typescript">export type LiveEvent =
  | { type: "connected"; plate: string; totalEvents: number }
  | { type: "detection"; index: number; total: number; point: TrajectoryPointDto }
  | { type: "complete"; overallConfidence: number; estimatedDistanceKm: number }
  | { type: "error"; message: string };

function handleMessage(event: LiveEvent) {
  if (event.type === "detection") {
    console.log(`Processing waypoint ${event.index} of ${event.total}`);
  }
}
</code></pre>
</div>
"""
