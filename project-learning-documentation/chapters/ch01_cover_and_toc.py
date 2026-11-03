"""
Chapter 1: Cover Page, Table of Contents, and How to Use This Guide.
"""

def get_content() -> str:
    return """
<div class="cover-page">
  <div class="cover-badge">BHARAT ELECTRONICS LIMITED (BEL) &bull; PROBLEM STATEMENT SIH26127</div>
  <h1 class="cover-title">City-Wide Multi-Camera ANPR Trajectory Tracking &amp; Urban Traffic Intelligence Platform</h1>
  <div class="cover-subtitle">Complete Project Reverse-Engineering, Source Code Walkthrough, Architectural Blueprint &amp; Independent Reconstruction Guide</div>
  
  <div class="cover-meta-grid">
    <div class="meta-item">
      <div class="meta-label">DOCUMENT ROLE</div>
      <div class="meta-val">Senior Software Architect, Full-Stack Engineer &amp; Code Auditor</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">TARGET AUDIENCE</div>
      <div class="meta-val">Full-Stack Engineers, AI/CV Researchers &amp; Systems Architects</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">COMPLIANCE &amp; SCOPE</div>
      <div class="meta-val">100% Workspace Evidence-Based Analysis (143 Files Audited)</div>
    </div>
    <div class="meta-item">
      <div class="meta-label">VERSION &amp; DATE</div>
      <div class="meta-val">v1.0.0 &bull; October 2026</div>
    </div>
  </div>

  <div class="cover-callout">
    <strong>Master Learning Objective:</strong> To understand every architectural decision, mathematical algorithm, computer vision pipeline stage, backend security mechanism, spatial GIS query, and reactive frontend component in this repository so thoroughly that you can recreate the entire platform independently from an empty directory without relying on AI code generation.
  </div>
</div>

<div class="page-break"></div>

<div class="toc-container">
  <h2 class="section-title">Comprehensive Table of Contents</h2>
  
  <div class="toc-grid">
    <div class="toc-column">
      <div class="toc-group">
        <div class="toc-group-title">PART I: SYSTEM OVERVIEW &amp; ARCHITECTURAL BLUEPRINT</div>
        <a href="#ch-how-to-use" class="toc-item"><span class="toc-num">01.</span> How to Use This Guide &amp; Learning Strategy</a>
        <a href="#ch-overview" class="toc-item"><span class="toc-num">02.</span> Project Overview, Problem Statement (SIH26127) &amp; Feature Inventory</a>
        <a href="#ch-architecture" class="toc-item"><span class="toc-num">03.</span> System Architecture &amp; Subsystems Decomposition</a>
        <a href="#ch-diagrams" class="toc-item"><span class="toc-num">04.</span> Architectural Execution Flow &amp; Sequence Diagrams</a>
        <a href="#ch-inventory" class="toc-item"><span class="toc-num">05.</span> Complete Project Workspace Directory Tree &amp; File Inventory</a>
      </div>

      <div class="toc-group">
        <div class="toc-group-title">PART II: PEDAGOGICAL SYLLABUS &amp; DEPENDENCY AUDIT</div>
        <a href="#ch-roadmap" class="toc-item"><span class="toc-num">06.</span> Ordered Learning Roadmap (Levels 0 through 7)</a>
        <a href="#ch-languages" class="toc-item"><span class="toc-num">07.</span> Programming Language Fundamentals (Python 3.11, Java 21, TS 5)</a>
        <a href="#ch-frameworks" class="toc-item"><span class="toc-num">08.</span> Frameworks &amp; Deep Learning Concepts (FastAPI, Spring, Next.js, YOLO)</a>
        <a href="#ch-dependencies" class="toc-item"><span class="toc-num">09.</span> Complete Dependency, Library &amp; Framework Audit</a>
      </div>

      <div class="toc-group">
        <div class="toc-group-title">PART III: DETAILED SOURCE CODE AUDIT (FILE-BY-FILE)</div>
        <a href="#ch-ai-core" class="toc-item"><span class="toc-num">10.</span> AI Microservice Core &amp; Schemas (main.py, schemas.py, config.py)</a>
        <a href="#ch-ai-cv" class="toc-item"><span class="toc-num">11.</span> Computer Vision, Dehazing &amp; Tracking (YOLOv8, ByteTrack, DCP)</a>
        <a href="#ch-ai-ocr" class="toc-item"><span class="toc-num">12.</span> License Plate Localization, EasyOCR &amp; Multi-Frame Fusion</a>
        <a href="#ch-ai-reid" class="toc-item"><span class="toc-num">13.</span> Appearance Re-ID, Identity Scorer &amp; Trajectory Predictor</a>
        <a href="#ch-ai-services" class="toc-item"><span class="toc-num">14.</span> Multi-Camera Orchestrator, Video Pipeline &amp; Redis Async State</a>
      </div>
    </div>

    <div class="toc-column">
      <div class="toc-group">
        <div class="toc-group-title">PART IV: BACKEND, SPATIAL &amp; TRAJECTORY ENGINES</div>
        <a href="#ch-backend-core" class="toc-item"><span class="toc-num">15.</span> Java Spring Boot Entry, Configurations &amp; Redis Rate Limiter</a>
        <a href="#ch-backend-domain" class="toc-item"><span class="toc-num">16.</span> Domain Entities, Repositories &amp; Jackson DTO Records</a>
        <a href="#ch-backend-services" class="toc-item"><span class="toc-num">17.</span> Detection Ingestion, Seeding, Mock Registry &amp; Redis Pub/Sub</a>
        <a href="#ch-backend-spatial" class="toc-item"><span class="toc-num">18.</span> PostGIS Spatial Migrations &amp; ST_DWithin KNN Nearest-Neighbor</a>
        <a href="#ch-backend-trajectory" class="toc-item"><span class="toc-num">19.</span> Trajectory Reconstruction Engine &amp; 5-Factor Kinematic Scorer</a>
        <a href="#ch-backend-controllers" class="toc-item"><span class="toc-num">20.</span> REST Controllers, AI Proxy &amp; Live Replay WebSocket Handler</a>
      </div>

      <div class="toc-group">
        <div class="toc-group-title">PART V: TACTICAL FRONTEND, APIS &amp; DATA STRUCTURES</div>
        <a href="#ch-frontend-core" class="toc-item"><span class="toc-num">21.</span> Next.js 16 App Router, Layout, Styling &amp; Dynamic API Proxy</a>
        <a href="#ch-frontend-gis" class="toc-item"><span class="toc-num">22.</span> Interactive MapLibre GL JS WebGL GIS Map &amp; GeoJSON Canvas</a>
        <a href="#ch-frontend-hud" class="toc-item"><span class="toc-num">23.</span> Tactical Investigation HUD, Timeline, Evidence Viewer &amp; 3D Cards</a>
        <a href="#ch-frontend-lib" class="toc-item"><span class="toc-num">24.</span> API Fetch Wrappers, Formatters, Live WebSocket Client &amp; Vahan RC</a>
      </div>

      <div class="toc-group">
        <div class="toc-group-title">PART VI: VERIFICATION, RECREATION &amp; DEFENSE</div>
        <a href="#ch-apis" class="toc-item"><span class="toc-num">25.</span> Complete API Reference (REST, WebSockets &amp; GeoJSON Contracts)</a>
        <a href="#ch-database" class="toc-item"><span class="toc-num">26.</span> Database Schema, PostGIS Tables &amp; Redis Memory Structures</a>
        <a href="#ch-security" class="toc-item"><span class="toc-num">27.</span> Authentication, Authorization &amp; Security Hardening Audit</a>
        <a href="#ch-config" class="toc-item"><span class="toc-num">28.</span> Environment Variables Reference Matrix &amp; Sanitized Templates</a>
        <a href="#ch-reconstruction" class="toc-item"><span class="toc-num">29.</span> Zero-to-Production Reconstruction Roadmap (Milestones 1 to 14)</a>
        <a href="#ch-testing" class="toc-item"><span class="toc-num">30.</span> Testing Strategy, Unit Tests &amp; Automated Smoke Test Suite</a>
        <a href="#ch-troubleshooting" class="toc-item"><span class="toc-num">31.</span> Production Troubleshooting Handbook &amp; Failure Diagnostics</a>
        <a href="#ch-exercises" class="toc-item"><span class="toc-num">32.</span> Learning Exercises, Coding Drills &amp; Complete Solution Keys</a>
        <a href="#ch-interview" class="toc-item"><span class="toc-num">33.</span> SIH Hackathon Defense Guide, Oral Q&amp;A &amp; Technical Interview</a>
        <a href="#ch-traceability" class="toc-item"><span class="toc-num">34.</span> Traceability Coverage Matrix, Glossary &amp; Official References</a>
      </div>
    </div>
  </div>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-how-to-use">
  <div class="section-header-tag">CHAPTER 01</div>
  <h2 class="section-title">How to Use This Learning Guide</h2>
  
  <p>This master guide is not an abstract theoretical manual. It is an exact, line-by-line reverse-engineering audit and personal curriculum constructed directly from the active files of the <strong>City AI Multi-Camera ANPR Trajectory Tracking &amp; Urban Traffic Intelligence Platform</strong> (SIH Problem Statement SIH26127, sponsored by Bharat Electronics Limited).</p>

  <h3>Pedagogical Philosophy &amp; Progressive Study Strategy</h3>
  <p>To master this system and achieve complete independent engineering capability, follow this three-stage methodology:</p>

  <div class="card-grid-3">
    <div class="card">
      <div class="card-title">Stage 1: Architecture &amp; Foundations</div>
      <p>Study Chapters 2 through 9. Understand how video frames captured by junction cameras flow across the Dark Channel Prior dehazer, YOLOv8 detector, ByteTrack tracker, EasyOCR engine, and Spring Boot backend. Familiarize yourself with the 5-tier architecture and the prerequisite language features in Java 21 and Python 3.11.</p>
    </div>
    <div class="card">
      <div class="card-title">Stage 2: Line-by-Line Code Audit</div>
      <p>Work methodically through Chapters 10 through 24. For every file, inspect the file identity, read the prerequisite concepts, analyze the line-by-line walkthrough, and complete the small implementation exercise without copying the original source code.</p>
    </div>
    <div class="card">
      <div class="card-title">Stage 3: Zero-to-One Reconstruction</div>
      <p>Open an empty folder and execute the 14 milestones detailed in Chapter 29. Use the verified commands, dependency manifests, and schemas. Run the automated smoke test suite in Chapter 30 to confirm your recreated platform passes every single check.</p>
    </div>
  </div>

  <div class="alert-box alert-info">
    <div class="alert-title">Strict Compliance with Evidence-Based Analysis</div>
    <p>Every class, function, DTO record, configuration parameter, and SQL query documented herein exists in the actual repository. Where features represent prototypes (e.g., in-memory mock Vahan registry) or verified production components (e.g., genuine PostGIS <code>ST_DWithin</code> and <code>&lt;-&gt;</code> KNN queries, Redis sliding-window rate limiters), they are explicitly labeled so you understand both the prototype reality and the enterprise roadmap.</p>
  </div>
</div>
"""
