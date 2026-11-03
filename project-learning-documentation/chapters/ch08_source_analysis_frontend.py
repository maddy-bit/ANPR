"""
Chapter 8: Detailed Source Code Analysis — Next.js 16 Frontend & MapLibre GIS.
"""

def get_content() -> str:
    return """
<div class="page-break"></div>

<div class="content-section" id="ch-frontend-core">
  <div class="section-header-tag">CHAPTER 15</div>
  <h2 class="section-title">Detailed Source Code Analysis: Next.js Frontend &amp; Reactive State</h2>

  <h3>1. File: <code>frontend/src/app/page.tsx</code> (Master Shell &amp; Header HUD)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>frontend/src/app/page.tsx</code><br>
    <strong>Architectural Layer:</strong> Presentation Tier / Root Page Router<br>
    <strong>Lines of Code:</strong> 90 lines &bull; <strong>Directive:</strong> <code>"use client"</code><br>
    <strong>Components Used:</strong> <code>SystemStatusBar</code>, <code>InvestigationDashboard</code>, <code>AnalyticsDashboard</code>, <code>SystemBootLoader</code>
  </div>

  <h4>Code Walkthrough &amp; State Switching</h4>
  <p>The root page manages top-level view routing between target vehicle investigation and city-wide traffic analytics using React state (Lines 11–15):</p>
  <pre><code class="language-typescript">"use client";

import { useState } from "react";
import { SystemStatusBar } from "@/components/SystemStatusBar";
import { InvestigationDashboard } from "@/components/InvestigationDashboard";
import { AnalyticsDashboard } from "@/components/AnalyticsDashboard";
import { SystemBootLoader } from "@/components/SystemBootLoader";

type View = "investigation" | "analytics";

export default function DashboardPage() {
  const [view, setView] = useState<View>("investigation");
  const [showBootLoader, setShowBootLoader] = useState(false);

  return (
    <div className="flex flex-1 flex-col min-h-screen text-black">
      <SystemBootLoader isOpen={showBootLoader} onComplete={() => setShowBootLoader(false)} />
      {/* Header with Segmented Tab Switcher & SystemStatusBar */}
      <main className="flex flex-1 flex-col">
        {view === "investigation" ? <InvestigationDashboard /> : <AnalyticsDashboard />}
      </main>
    </div>
  );
}
</code></pre>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-frontend-gis">
  <div class="section-header-tag">CHAPTER 16</div>
  <h2 class="section-title">Detailed Source Code Analysis: Interactive MapLibre GL JS Map</h2>

  <h3>1. File: <code>frontend/src/components/InvestigationMap.tsx</code></h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>frontend/src/components/InvestigationMap.tsx</code><br>
    <strong>Architectural Layer:</strong> Presentation Tier / WebGL GIS Canvas<br>
    <strong>Lines of Code:</strong> 450 lines &bull; <strong>Dependencies:</strong> <code>maplibre-gl</code>
  </div>

  <h4>Why MapLibre GL JS Instead of Mapbox GL JS?</h4>
  <p>While the original project specification called for Mapbox GL JS, Mapbox requires a paid-tier credit card API token. MapLibre GL JS is the open-source community fork maintaining the identical WebGL rendering engine, GeoJSON API, and coordinate matrix without any commercial tokens or vendor lock-in. The basemap uses CARTO's free <code>dark_all</code> raster tiles.</p>

  <h4>Key Architectural Implementations</h4>

  <h4>A. Dynamic GeoJSON Trajectory Line &amp; Camera Layers</h4>
  <p>When trajectory data loads, the component dynamically injects a GeoJSON <code>LineString</code> source and applies a glowing cyan line layer:</p>
  <pre><code class="language-typescript">if (!map.getSource("trajectory-line")) {
  map.addSource("trajectory-line", {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.longitude, p.latitude]),
      },
      properties: {},
    },
  });

  map.addLayer({
    id: "trajectory-line-layer",
    type: "line",
    source: "trajectory-line",
    paint: {
      "line-color": "#06b6d4",        // Cyan glow
      "line-width": 4,
      "line-opacity": 0.9,
    },
  });
}
</code></pre>

  <h4>B. Interactive Numbered HTML Markers with Synchronized Selection</h4>
  <p>For each camera visit, an interactive DOM marker is added to the map. Clicking a marker invokes <code>onSelectPoint(index)</code> and animates the camera view via <code>map.flyTo()</code>:</p>
  <pre><code class="language-typescript">const el = document.createElement("div");
el.className = `marker-badge ${isSelected ? "marker-active" : ""}`;
el.innerHTML = `<span>${index + 1}</span>`;

el.addEventListener("click", () => {
  onSelectPoint(index);
  map.flyTo({
    center: [point.longitude, point.latitude],
    zoom: 15,
    duration: 1500,
  });
});

new maplibregl.Marker({ element: el })
  .setLngLat([point.longitude, point.latitude])
  .addTo(map);
</code></pre>

  <h4>C. Kinematic Replay Animation Engine</h4>
  <p>Clicking <strong>Replay Trajectory</strong> does not merely step through points at a uniform speed. It computes the actual elapsed minutes between consecutive camera sightings, scales the animation intervals proportionally (capping the total replay duration to 6 seconds for user engagement), and smoothly interpolates a moving vehicle marker along the route.</p>
</div>

<div class="page-break"></div>

<div class="content-section" id="ch-frontend-lib">
  <div class="section-header-tag">CHAPTER 17</div>
  <h2 class="section-title">Detailed Source Code Analysis: API Client &amp; Live WebSocket Client</h2>

  <h3>1. File: <code>frontend/src/lib/api.ts</code> (Resilient Fetch Client &amp; Fallbacks)</h3>
  <div class="meta-box">
    <strong>Relative Path:</strong> <code>frontend/src/lib/api.ts</code><br>
    <strong>Lines of Code:</strong> 705 lines &bull; <strong>Exports:</strong> 12 API functions, 8 TypeScript DTO interfaces
  </div>

  <h4>Smart City Fallback Resilience Pattern</h4>
  <p>To ensure law enforcement presentations and hackathon demonstrations never fail due to intermittent local backend restarts, every fetch method wraps network requests in a fallback block. If <code>fetch()</code> throws a network error, <code>api.ts</code> seamlessly serves verified demo scenario records (e.g. target vehicle <code>ET3633P</code> / <code>MH12AB1234</code> passing CAM-01 &rarr; CAM-03 &rarr; CAM-07 &rarr; CAM-11):</p>

  <pre><code class="language-typescript">export async function getVehicleTrajectory(plate: string): Promise<TrajectoryResponseDto> {
  try {
    return await apiFetch<TrajectoryResponseDto>(`/vehicles/${encodeURIComponent(plate)}/trajectory`);
  } catch {
    const clean = plate.toUpperCase().replace(/\\s+/g, "");
    if (clean === "ET3633P" || clean === "MH12AB1234") {
      return DEMO_TRAJECTORY; // Verified fallback route
    }
    throw new ApiError("Trajectory unavailable", 404);
  }
}
</code></pre>

  <h3>2. File: <code>frontend/src/lib/liveClient.ts</code> (Native WebSocket Wrapper)</h3>
  <p>Implements a clean object-oriented WebSocket connection manager handling the native browser WebSocket lifecycle, automatic connection status reporting, and event parsing:</p>

  <pre><code class="language-typescript">export class LiveTrackingClient {
  private ws: WebSocket | null = null;

  connect(plate: string, callbacks: LiveTrackingCallbacks) {
    const wsUrl = `ws://localhost:8080/ws/live/${encodeURIComponent(plate)}`;
    this.ws = new WebSocket(wsUrl);

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "connected") callbacks.onConnected?.(msg.totalEvents);
        else if (msg.type === "detection") callbacks.onDetection?.(msg.index, msg.total, msg.point);
        else if (msg.type === "complete") callbacks.onComplete?.(msg);
        else if (msg.type === "error") callbacks.onError?.(msg.message);
      } catch (err) {
        callbacks.onError?.("Failed to parse live event frame");
      }
    };
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
</code></pre>
</div>
"""
