"""
Chapter 5: Complete Dependency, Library, and Framework Audit across Python, Java, and Node.js.
"""

def get_content() -> str:
    return """
<div class="page-break"></div>

<div class="content-section" id="ch-dependencies">
  <div class="section-header-tag">CHAPTER 08</div>
  <h2 class="section-title">Complete Dependency, Library &amp; Framework Audit</h2>

  <p>This chapter audits every direct runtime, build-time, and development dependency declared in the project's dependency manifests (<code>ai-service/requirements.txt</code>, <code>backend/pom.xml</code>, and <code>frontend/package.json</code>). No transitive dependencies are confused with directly imported packages.</p>

  <h3>1. Python AI Microservice Dependencies (<code>requirements.txt</code>)</h3>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Package Name</th>
          <th>Declared Version</th>
          <th>Scope</th>
          <th>Role &amp; Primary Functionality</th>
          <th>Key APIs &amp; Modules Used</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>fastapi</strong></td>
          <td><code>0.115.0</code></td>
          <td>Runtime</td>
          <td>High-performance asynchronous web framework for REST API microservice.</td>
          <td><code>FastAPI()</code>, <code>HTTPException</code>, <code>Query()</code>, <code>@app.get</code>, <code>@app.post</code></td>
        </tr>
        <tr>
          <td><strong>uvicorn[standard]</strong></td>
          <td><code>0.30.6</code></td>
          <td>Runtime</td>
          <td>Lightning-fast ASGI web server implementation running FastAPI event loop.</td>
          <td><code>uvicorn.run()</code>, CLI server runner with uvloop support</td>
        </tr>
        <tr>
          <td><strong>pydantic</strong></td>
          <td><code>&gt;=2.0.0</code></td>
          <td>Runtime</td>
          <td>Data validation and serialization using Python type annotations.</td>
          <td><code>BaseModel</code>, <code>Field()</code>, <code>model_dump()</code>, <code>model_post_init()</code></td>
        </tr>
        <tr>
          <td><strong>ultralytics</strong></td>
          <td><code>8.4.138</code></td>
          <td>Runtime</td>
          <td>State-of-the-art YOLOv8 computer vision model engine &amp; ByteTrack tracking.</td>
          <td><code>YOLO("yolov8s.pt")</code>, <code>model.track()</code>, <code>model.predict()</code></td>
        </tr>
        <tr>
          <td><strong>lap</strong></td>
          <td><code>0.5.13</code></td>
          <td>Runtime</td>
          <td>Linear Assignment Problem solver implementing Jonker-Volgenant algorithm for ByteTrack.</td>
          <td><code>lap.lapjv()</code> (used internally by ByteTrack to associate bounding boxes)</td>
        </tr>
        <tr>
          <td><strong>easyocr</strong></td>
          <td><code>1.7.2</code></td>
          <td>Runtime</td>
          <td>Optical Character Recognition (OCR) engine detecting &amp; recognizing text on license plates.</td>
          <td><code>easyocr.Reader(["en"], gpu=False)</code>, <code>reader.readtext()</code></td>
        </tr>
        <tr>
          <td><strong>opencv-python-headless</strong></td>
          <td><code>4.10.0.84</code></td>
          <td>Runtime</td>
          <td>Computer vision image processing library (headless, no X11/GUI dependencies).</td>
          <td><code>cv2.VideoCapture</code>, <code>cv2.createCLAHE</code>, <code>cv2.erode</code>, <code>cv2.imdecode</code></td>
        </tr>
        <tr>
          <td><strong>torch</strong></td>
          <td><code>&gt;=2.0.0</code></td>
          <td>Runtime</td>
          <td>Deep learning tensor computing framework with GPU acceleration support.</td>
          <td><code>torch.no_grad()</code>, <code>torch.from_numpy()</code>, tensor matrix operations</td>
        </tr>
        <tr>
          <td><strong>torchvision</strong></td>
          <td><code>&gt;=0.15.0</code></td>
          <td>Runtime</td>
          <td>Computer vision neural network architectures and image transformation pipelines.</td>
          <td><code>torchvision.models.resnet50(pretrained=True)</code>, <code>transforms.Normalize</code></td>
        </tr>
        <tr>
          <td><strong>numpy</strong></td>
          <td><code>&gt;=1.24.0</code></td>
          <td>Runtime</td>
          <td>Fundamental package for scientific computing, N-dimensional arrays, and vector math.</td>
          <td><code>np.ndarray</code>, <code>np.dot()</code>, <code>np.linalg.norm()</code>, <code>np.argsort()</code></td>
        </tr>
        <tr>
          <td><strong>redis</strong></td>
          <td><code>&gt;=5.0.0</code></td>
          <td>Runtime</td>
          <td>Asynchronous Redis client for distributed job tracking and health monitoring.</td>
          <td><code>redis.asyncio.Redis</code>, <code>client.ping()</code>, <code>client.set()</code>, <code>client.get()</code></td>
        </tr>
        <tr>
          <td><strong>requests</strong></td>
          <td><code>2.34.2</code></td>
          <td>Tooling</td>
          <td>HTTP client library used by ingestion scripts to send POST requests to Spring Boot.</td>
          <td><code>requests.post(url, json=payload, auth=(user, pass))</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="page-break"></div>

  <h3>2. Java Spring Boot Backend Dependencies (<code>pom.xml</code>)</h3>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Artifact ID</th>
          <th>Version / Parent</th>
          <th>Scope</th>
          <th>Role &amp; Primary Functionality</th>
          <th>Key Classes &amp; Annotations Used</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>spring-boot-starter-parent</strong></td>
          <td><code>3.3.4</code></td>
          <td>Parent POM</td>
          <td>Provides dependency management, default compiler settings, and plugin configurations.</td>
          <td>Spring Boot BOM (Bill of Materials)</td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-web</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Builds RESTful APIs using Spring MVC and embedded Apache Tomcat.</td>
          <td><code>@RestController</code>, <code>@RequestMapping</code>, <code>@GetMapping</code>, <code>RestTemplate</code></td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-data-jpa</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Persistence framework wrapping Hibernate ORM and Spring Data JPA repositories.</td>
          <td><code>@Entity</code>, <code>@Table</code>, <code>@Id</code>, <code>JpaRepository&lt;T, ID&gt;</code>, <code>@Transactional</code></td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-websocket</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>WebSocket server integration for low-latency live tracking streaming.</td>
          <td><code>WebSocketConfigurer</code>, <code>TextWebSocketHandler</code>, <code>WebSocketSession</code></td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-security</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Security framework enforcing HTTP Basic authentication on ingest and audit routes.</td>
          <td><code>SecurityFilterChain</code>, <code>PasswordEncoder</code>, <code>InMemoryUserDetailsManager</code></td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-data-redis</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Redis client using Lettuce driver for distributed caching, rate limiting, and Pub/Sub.</td>
          <td><code>StringRedisTemplate</code>, <code>RedisConnectionFactory</code>, <code>RedisCacheManager</code></td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-cache</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Spring core caching abstraction providing declarative <code>@Cacheable</code> annotations.</td>
          <td><code>@EnableCaching</code>, <code>@Cacheable(value="trajectories")</code>, <code>CacheManager</code></td>
        </tr>
        <tr>
          <td><strong>commons-pool2</strong></td>
          <td>Managed</td>
          <td>Compile</td>
          <td>Object-pooling library managing Lettuce Redis client socket connection pools.</td>
          <td><code>GenericObjectPoolConfig</code> (used internally by Lettuce)</td>
        </tr>
        <tr>
          <td><strong>h2</strong></td>
          <td>Managed</td>
          <td>Runtime</td>
          <td>In-memory/file-based SQL database providing zero-config local development persistence.</td>
          <td><code>org.h2.Driver</code>, embedded H2 web console (<code>/h2-console</code>)</td>
        </tr>
        <tr>
          <td><strong>postgresql</strong></td>
          <td>Managed</td>
          <td>Runtime</td>
          <td>Official JDBC driver connecting Spring Boot to PostgreSQL 16 + PostGIS database.</td>
          <td><code>org.postgresql.Driver</code> (activated via <code>postgres</code> profile)</td>
        </tr>
        <tr>
          <td><strong>spring-boot-starter-test</strong></td>
          <td>Managed</td>
          <td>Test</td>
          <td>Testing framework packaging JUnit 5 (Jupiter), Mockito, and AssertJ.</td>
          <td><code>@Test</code>, <code>assertEquals()</code>, <code>assertNotNull()</code>, <code>Mockito</code></td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="page-break"></div>

  <h3>3. Next.js Frontend Dependencies (<code>package.json</code>)</h3>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th>Package Name</th>
          <th>Version</th>
          <th>Category</th>
          <th>Role in Application</th>
          <th>Key Imports &amp; APIs Used</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><strong>next</strong></td>
          <td><code>16.3.4</code></td>
          <td>Runtime</td>
          <td>React application framework providing App Router, SSR, Turbopack, and build optimization.</td>
          <td><code>next/font/google</code>, <code>NextRequest</code>, <code>NextResponse</code></td>
        </tr>
        <tr>
          <td><strong>react</strong> / <strong>react-dom</strong></td>
          <td><code>19.2.8</code></td>
          <td>Runtime</td>
          <td>Core component library and Virtual DOM renderer.</td>
          <td><code>useState</code>, <code>useEffect</code>, <code>useCallback</code>, <code>useRef</code>, <code>createRoot</code></td>
        </tr>
        <tr>
          <td><strong>maplibre-gl</strong></td>
          <td><code>^6.6.0</code></td>
          <td>Runtime</td>
          <td>Open-source WebGL vector &amp; raster tile map renderer (token-free Mapbox fork).</td>
          <td><code>maplibregl.Map</code>, <code>Marker</code>, <code>addSource("geojson")</code>, <code>addLayer()</code></td>
        </tr>
        <tr>
          <td><strong>framer-motion</strong></td>
          <td><code>^13.1.1</code></td>
          <td>Runtime</td>
          <td>Production-ready motion library for React creating smooth layout and modal transitions.</td>
          <td><code>motion.div</code>, <code>AnimatePresence</code></td>
        </tr>
        <tr>
          <td><strong>jspdf</strong></td>
          <td><code>^4.2.1</code></td>
          <td>Runtime</td>
          <td>Client-side PDF document generator producing police dossiers and Vahan RC certificates.</td>
          <td><code>new jsPDF()</code>, <code>doc.text()</code>, <code>doc.addImage()</code>, <code>doc.save()</code></td>
        </tr>
        <tr>
          <td><strong>tailwindcss</strong></td>
          <td><code>^4</code></td>
          <td>Dev / Build</td>
          <td>Modern utility-first CSS framework for building responsive, glassmorphic HUD styling.</td>
          <td>Tailwind utility classes (<code>bg-slate-900</code>, <code>backdrop-blur-md</code>, etc.)</td>
        </tr>
        <tr>
          <td><strong>typescript</strong></td>
          <td><code>^5</code></td>
          <td>Dev / Build</td>
          <td>Typed superset of JavaScript providing compile-time type safety across API payloads.</td>
          <td>Interfaces, type aliases, generics, <code>tsc</code> compiler</td>
        </tr>
        <tr>
          <td><strong>eslint</strong> / <strong>eslint-config-next</strong></td>
          <td><code>^9</code> / <code>16.3.4</code></td>
          <td>Dev / Tooling</td>
          <td>Static analysis tool enforcing React best practices and Next.js Core Web Vitals.</td>
          <td>ESLint configuration rules</td>
        </tr>
      </tbody>
    </table>
  </div>
</div>
"""
