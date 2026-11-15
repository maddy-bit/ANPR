"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
// NOTE: MapLibre CSS is imported in globals.css (not here) to avoid
// lightningcss native-binding crash on Linux CI runners.
import type { CameraDto, TrajectoryPointDto } from "@/lib/api";
import { fetchRoadRoute } from "@/lib/routing";

// OpenStreetMap-based CARTO raster styles with a dashed estimated road connection between observations.
const ROUTE_SOURCE_ID = "trajectory-route";

function createBasemapStyle(
  sourceKey: string,
  tiles: string[],
  layerKey: string,
): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [sourceKey]: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution: "Â© OpenStreetMap contributors Â© CARTO",
      },
      [ROUTE_SOURCE_ID]: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
    },
    layers: [
      {
        id: layerKey,
        type: "raster",
        source: sourceKey,
        minzoom: 0,
        maxzoom: 22,
      },
      {
        id: "trajectory-route-line",
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#2563a6",
          "line-width": 4,
          "line-opacity": 0.9,
          "line-dasharray": [1.5, 1.5],
        },
      },
    ],

  };
}

const STREETS_STYLE = createBasemapStyle(
  "carto-voyager",
  [
    "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png",
  ],
  "carto-voyager-layer",
);

const SATELLITE_STYLE = createBasemapStyle(
  "carto-dark",
  [
    "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
  ],
  "carto-dark-layer",
);

const LIGHT_STYLE = createBasemapStyle(
  "carto-light",
  [
    "https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png",
  ],
  "carto-light-layer",
);

const BASEMAP_STYLES: Record<"light" | "streets" | "satellite", maplibregl.StyleSpecification> = {
  streets: STREETS_STYLE,
  satellite: SATELLITE_STYLE,
  light: LIGHT_STYLE,
};

interface InvestigationMapProps {
  cameras: CameraDto[];
  points: TrajectoryPointDto[];
  selectedIndex: number | null;
  onSelectPoint: (index: number) => void;
  replayToken: number;
  onSelectCamera?: (camera: CameraDto) => void;
}

export function InvestigationMap({
  cameras,
  points,
  selectedIndex,
  onSelectPoint,
  replayToken,
  onSelectCamera,
}: InvestigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const vehicleMarkerRef = useRef<maplibregl.Marker | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const cameraMarkersRef = useRef<maplibregl.Marker[]>([]);
  const checkpointElementsRef = useRef<{ el: HTMLButtonElement; index: number }[]>([]);
  const isInitialReconstructRef = useRef<boolean>(true);
  const roadCoordinatesRef = useRef<[number, number][]>([]);
  const animationFrameRef = useRef<number | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState<"light" | "streets" | "satellite">("satellite");
  const [hoveredCamera, setHoveredCamera] = useState<CameraDto | null>(null);

  // Dynamically resolve points coordinates against active cameras array
  // so that moving or updating any camera immediately updates trajectory points & route
  const effectivePoints = useMemo(() => {
    return points.map((p) => {
      const matchingCam = cameras.find((c) => c.id === p.cameraId);
      if (matchingCam) {
        return {
          ...p,
          latitude: matchingCam.latitude,
          longitude: matchingCam.longitude,
        };
      }
      return p;
    });
  }, [points, cameras]);

  // Initialize map with robust raster tile config & 3D pitch capability
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialObservation = effectivePoints.find((point) => Number.isFinite(point.latitude)
      && Number.isFinite(point.longitude)
      && point.latitude >= -90 && point.latitude <= 90
      && point.longitude >= -180 && point.longitude <= 180);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLES[activeLayer],
      ...(initialObservation ? { center: [initialObservation.longitude, initialObservation.latitude] } : {}),
      zoom: initialObservation ? 12 : 4.4,
      pitch: 0,
      bearing: 0,
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    let isReadyFired = false;
    const markReady = () => {
      if (isReadyFired) return;
      isReadyFired = true;
      map.resize();
      setMapReady(true);
    };

    map.on("load", markReady);
    map.on("style.load", markReady);
    map.on("styledata", markReady);
    map.on("error", (e) => {
      console.warn("MapLibre load note:", e);
      markReady();
    });

    const safetyTimer = setTimeout(markReady, 100);

    mapRef.current = map;
    if (typeof window !== "undefined") {
      (window as unknown as { __MAP__?: maplibregl.Map }).__MAP__ = map;
    }

    // ResizeObserver so map canvas redraws if the container size changes
    const ro = new ResizeObserver(() => {
      map.resize();
    });
    ro.observe(containerRef.current);
    resizeObserverRef.current = ro;

    return () => {
      clearTimeout(safetyTimer);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle layer switch with proper styledata lifecycle in MapLibre
  const handleLayerSwitch = (styleKey: "light" | "streets" | "satellite") => {
    if (styleKey === activeLayer) return;
    isInitialReconstructRef.current = false;
    setActiveLayer(styleKey);
    setMapReady(false);
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(BASEMAP_STYLES[styleKey]);

    const restoreRouteLayers = () => {
      if (!map.isStyleLoaded()) return;
      try {
        const validCoords =
          roadCoordinatesRef.current.length >= 2
            ? roadCoordinatesRef.current
            : [];

        const initialData: GeoJSON.GeoJSON =
          validCoords.length >= 2
            ? {
                type: "FeatureCollection",
                features: [
                  {
                    type: "Feature",
                    geometry: {
                      type: "LineString",
                      coordinates: validCoords,
                    },
                    properties: {},
                  },
                ],
              }
            : {
                type: "FeatureCollection",
                features: [],
              };

        const setOrQueueInitialRoute = () => {
          const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData(initialData);
            return true;
          }
          if (map.isStyleLoaded()) {
            try {
              map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data: initialData });
              if (!map.getLayer("trajectory-route-line")) {
                map.addLayer({
                  id: "trajectory-route-line",
                  type: "line",
                  source: ROUTE_SOURCE_ID,
                  layout: { "line-join": "round", "line-cap": "round" },
                  paint: {
                    "line-color": "#2563a6",
                    "line-width": 3,
                    "line-opacity": 0.9,
                    "line-dasharray": [1.5, 1.5],
                  },
                });
              }
              return true;
            } catch (err) {
              console.error("Error creating route source on demand:", err);
            }
          }
          return false;
        };

        if (!setOrQueueInitialRoute()) {
          map.once("styledata", () => setOrQueueInitialRoute());
          setTimeout(() => setOrQueueInitialRoute(), 200);
        }

      } catch (err) {
        console.error("Error restoring route layers after style switch:", err);
      }
      map.resize();
      setMapReady(true);

      // Re-attach DOM markers to map after style swap
      markersRef.current.forEach((m) => m.addTo(map));
      cameraMarkersRef.current.forEach((m) => m.addTo(map));
    };

    const onStyleReady = () => {
      if (map.isStyleLoaded()) {
        map.off("styledata", onStyleReady);
        restoreRouteLayers();
      }
    };

    if (map.isStyleLoaded()) {
      restoreRouteLayers();
    } else {
      map.on("styledata", onStyleReady);
    }
  };

  // Render independent camera locations
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // Clear old camera markers
    cameraMarkersRef.current.forEach((m) => m.remove());
    cameraMarkersRef.current = [];

    // Camera locations are independent observations. Never connect adjacent array entries:
    // a line is drawn only when a persisted, validated trajectory or route edge exists.

    // Render camera markers for cameras not already represented by trajectory checkpoints
    const activeCameraIds = new Set(effectivePoints.map((p) => p.cameraId));

    cameras.forEach((camera) => {
      if (activeCameraIds.has(camera.id)) return; // Checkpoint badge rendered separately

      const el = document.createElement("button");
      el.type = "button";
      el.className = "investigation-camera-marker";
      el.title = camera.name;
      el.setAttribute("aria-label", "Select camera " + camera.name);

      const markerDot = document.createElement("span");
      markerDot.className = "investigation-camera-marker-dot";
      markerDot.style.backgroundColor =
        camera.sourceType === "PUBLIC_CATALOG" ? "#16835d"
        : camera.sourceType === "GOVERNMENT_API" ? "#2563a6"
        : "#64748b";

      const markerLabel = document.createElement("span");
      markerLabel.className = "investigation-camera-marker-label";
      markerLabel.textContent = camera.id;

      el.append(markerDot, markerLabel);

      el.addEventListener("mouseenter", () => {
        setHoveredCamera((prev) => (prev?.id === camera.id ? prev : camera));
      });
      el.addEventListener("mouseleave", () => {
        setHoveredCamera((prev) => (prev?.id === camera.id ? null : prev));
      });
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        setHoveredCamera(camera);
        onSelectCamera?.(camera);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([camera.longitude, camera.latitude])
        .addTo(map);

      cameraMarkersRef.current.push(marker);
    });
  }, [cameras, effectivePoints, mapReady, activeLayer, onSelectCamera]);

  // Render trajectory route line along real roads and numbered checkpoint badges
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    checkpointElementsRef.current = [];

    if (effectivePoints.length === 0) {
      roadCoordinatesRef.current = [];
      if (map.getSource(ROUTE_SOURCE_ID)) {
        (map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [],
        });
      }
      return;
    }

    const rawWaypoints: [number, number][] = effectivePoints.map((p) => [p.longitude, p.latitude]);

    const applyRouteGeojson = (coordinates: [number, number][]) => {
      roadCoordinatesRef.current = coordinates;

      const data: GeoJSON.GeoJSON = coordinates.length >= 2
        ? {
            type: "FeatureCollection",
            features: [{
              type: "Feature",
              geometry: { type: "LineString", coordinates },
              properties: { routeType: "EXTERNAL_ROUTING_ESTIMATE" },
            }],
          }
        : { type: "FeatureCollection", features: [] };

      const setRouteData = () => {
        try {
          const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData(data);
          } else if (map.isStyleLoaded()) {
            map.addSource(ROUTE_SOURCE_ID, { type: "geojson", data });
          }


        } catch (err) {
          console.error("Error setting route data:", err);
        }
      };

      setRouteData();

      // If style is still loading, MapLibre will overwrite sources when it finishes.
      // Re-apply route data once style is fully ready.
      if (!map.isStyleLoaded()) {
        map.once("style.load", setRouteData);
        map.once("load", setRouteData);
        map.once("styledata", setRouteData);
      }
      setTimeout(setRouteData, 250);
      setTimeout(setRouteData, 600);
      setTimeout(setRouteData, 1200);
    };

    // Render a route only when the routing provider returns an actual road-network path.
    // No straight-line or synthetic fallback is presented as a vehicle route.
    applyRouteGeojson([]);

    // Fetch an estimated road-network connection asynchronously
    let isCancelled = false;
    fetchRoadRoute(rawWaypoints).then((roadCoords) => {
      if (isCancelled || !mapRef.current) return;
      applyRouteGeojson(roadCoords);

    });

    // Timestamped vehicle sightings, numbered in chronological order
    effectivePoints.forEach((point, index) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "cursor-pointer z-20 select-none";
      el.setAttribute("aria-label", "Select vehicle sighting " + (index + 1) + " at camera " + point.cameraId);

      const badge = document.createElement("span");
      badge.className = "checkpoint-badge flex items-center gap-2 rounded-md border border-slate-300 bg-white px-2 py-1 shadow-sm";

      const number = document.createElement("span");
      number.className = "flex h-5 w-5 items-center justify-center rounded-full bg-slate-900 text-xs font-semibold text-white";
      number.textContent = String(index + 1);

      const text = document.createElement("span");
      text.className = "flex max-w-[110px] flex-col text-left leading-tight";

      const cameraIdLabel = document.createElement("span");
      cameraIdLabel.className = "font-mono text-[10px] font-semibold text-slate-900";
      cameraIdLabel.textContent = point.cameraId;

      const cameraNameLabel = document.createElement("span");
      cameraNameLabel.className = "max-w-[100px] truncate text-[9px] text-slate-500";
      cameraNameLabel.textContent = (point.cameraName || "Camera").split(" - ")[0];

      text.append(cameraIdLabel, cameraNameLabel);
      badge.append(number, text);
      el.append(badge);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        isInitialReconstructRef.current = false;
        onSelectPoint(index);
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([point.longitude, point.latitude])
        .addTo(map);

      markersRef.current.push(marker);
      checkpointElementsRef.current.push({ el, index });
    });

    // Auto-fit bounds to encompass all checkpoints cleanly on initial target reconstruct
    if (effectivePoints.length > 1 && isInitialReconstructRef.current) {
      isInitialReconstructRef.current = false;
      const bounds = new maplibregl.LngLatBounds();
      effectivePoints.forEach((p) => bounds.extend([p.longitude, p.latitude]));
      map.fitBounds(bounds, {
        padding: { top: 85, bottom: 85, left: 75, right: 75 },
        maxZoom: 13.2,
        duration: 700,
      });
    }

    return () => {
      isCancelled = true;
    };
  }, [effectivePoints, cameras, mapReady, activeLayer, onSelectPoint]);

  // Update checkpoint visual active state without re-creating DOM markers (zero jitter)
  useEffect(() => {
    checkpointElementsRef.current.forEach(({ el, index }) => {
      const isSelected = selectedIndex === index;
      const ping = el.querySelector(".radar-ping");
      const badge = el.querySelector(".checkpoint-badge");
      if (ping) {
        if (isSelected) {
          ping.classList.remove("hidden");
        } else {
          ping.classList.add("hidden");
        }
      }
      if (badge) {
        if (isSelected) {
          badge.className =
            "checkpoint-badge flex items-center gap-1.5 rounded-2xl border-2 border-white px-2.5 py-1 shadow-xl transition-all duration-200 bg-gradient-to-r from-sky-600 via-blue-600 to-indigo-600 text-white scale-110 shadow-sky-500/50 ring-2 ring-sky-300";
        } else {
          badge.className =
            "checkpoint-badge flex items-center gap-1.5 rounded-2xl border-2 border-white px-2.5 py-1 shadow-xl transition-all duration-200 bg-gradient-to-r from-blue-700 to-sky-700 text-white shadow-blue-500/40";
        }
      }
    });
  }, [selectedIndex]);

  // Pan to selected checkpoint smoothly on deliberate user interaction
  useEffect(() => {
    const map = mapRef.current;
    if (!map || selectedIndex === null || !effectivePoints[selectedIndex]) return;
    if (isInitialReconstructRef.current) return;
    const target = effectivePoints[selectedIndex];
    map.easeTo({
      center: [target.longitude, target.latitude],
      duration: 500,
    });
  }, [selectedIndex, effectivePoints]);

  // Replay only an external road-network estimate; no synthetic path is generated.
  useEffect(() => {
    if (replayToken === 0 || effectivePoints.length < 2) return;
    const map = mapRef.current;
    if (!map || roadCoordinatesRef.current.length < 2) return;

    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    if (!vehicleMarkerRef.current) {
      const el = document.createElement("div");
      el.className = "flex h-8 w-8 items-center justify-center rounded-full border-2 border-white bg-slate-900 text-base text-white shadow-md";
      el.setAttribute("aria-label", "Estimated replay position");
      el.textContent = "ðŸš—";
      vehicleMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([effectivePoints[0].longitude, effectivePoints[0].latitude])
        .addTo(map);
    }

    const durationMs = 5000;
    const startTime = performance.now();

    function animate(time: number) {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / durationMs, 1);

      const pathCoords = roadCoordinatesRef.current;
      if (pathCoords.length < 2) {
        vehicleMarkerRef.current?.remove();
        vehicleMarkerRef.current = null;
        return;
      }

      const totalSegments = pathCoords.length - 1;
      const currentSegmentFloat = progress * totalSegments;
      const segmentIndex = Math.min(Math.floor(currentSegmentFloat), totalSegments - 1);
      const segmentProgress = currentSegmentFloat - segmentIndex;

      const p1 = pathCoords[segmentIndex];
      const p2 = pathCoords[segmentIndex + 1];

      if (!p1 || !p2) {
        vehicleMarkerRef.current?.remove();
        vehicleMarkerRef.current = null;
        return;
      }

      const lng = p1[0] + (p2[0] - p1[0]) * segmentProgress;
      const lat = p1[1] + (p2[1] - p1[1]) * segmentProgress;

      vehicleMarkerRef.current?.setLngLat([lng, lat]);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        setTimeout(() => {
          vehicleMarkerRef.current?.remove();
          vehicleMarkerRef.current = null;
        }, 1200);
      }
    }

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [replayToken, effectivePoints]);

  const handleResetView = () => {
    const map = mapRef.current;
    if (!map || effectivePoints.length === 0) return;
    if (effectivePoints.length === 1) {
      const point = effectivePoints[0];
      map.easeTo({ center: [point.longitude, point.latitude], zoom: 13, duration: 900 });
      return;
    }
    const bounds = new maplibregl.LngLatBounds();
    effectivePoints.forEach((point) => bounds.extend([point.longitude, point.latitude]));
    map.fitBounds(bounds, {
      padding: { top: 85, bottom: 85, left: 75, right: 75 },
      maxZoom: 13.5,
      duration: 900,
    });
  };

  return (
    <div className="flex flex-col gap-2.5 w-full">
      {/* Map controls */}
      <div className="flex items-center justify-between gap-3 rounded-lg border-1.5 border-slate-400 bg-white px-3.5 py-2">
        {/* Camera inventory status */}
        <div className="flex items-center gap-2">
          <span className="flex h-2.5 w-2.5 rounded-full bg-slate-700" />
          <div className="flex items-center gap-1.5 font-mono leading-none">
            <span className="text-[11px] font-semibold tracking-wide text-slate-900">
              CAMERA NETWORK
            </span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-800 border border-slate-300 font-bold">
              {cameras.length} CAMERAS
            </span>
          </div>
        </div>

        {/* Basemap and view controls */}
        <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap">
          {/* Basemap Styles */}
          <div className="flex items-center gap-1 rounded-md border border-slate-300 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => handleLayerSwitch("streets")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === "streets"
                  ? "bg-slate-900 text-white font-bold"
                  : "text-slate-800 hover:bg-slate-200/70"
              }`}
            >
              Street
            </button>
            <button
              type="button"
              onClick={() => handleLayerSwitch("satellite")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === "satellite"
                  ? "bg-slate-900 text-white font-bold"
                  : "text-slate-800 hover:bg-slate-200/70"
              }`}
            >
              Dark
            </button>
            <button
              type="button"
              onClick={() => handleLayerSwitch("light")}
              className={`rounded px-2.5 py-1 text-xs font-semibold transition-all cursor-pointer ${
                activeLayer === "light"
                  ? "bg-slate-900 text-white font-bold"
                  : "text-slate-800 hover:bg-slate-200/70"
              }`}
            >
              Light
            </button>
          </div>

          <div className="h-4 w-px bg-slate-300 mx-0.5" />

          <button
            type="button"
            onClick={handleResetView}
            title="Fit Route to Bounds"
            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-800 hover:bg-slate-100 transition-all cursor-pointer"
          >
            ðŸŽ¯ Fit
          </button>
        </div>
      </div>

      {/* Main Map Box / Square Section */}
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border-1.5 border-slate-400 bg-slate-100"
        style={{ height: "min(70vh, 760px)", minHeight: "520px" }}
      >
        {/* Map overlay */}
        <div className="pointer-events-none absolute top-2 left-2 z-10 h-3.5 w-3.5 border-t-2 border-l-2 border-slate-600" />
        <div className="pointer-events-none absolute top-2 right-2 z-10 h-3.5 w-3.5 border-t-2 border-r-2 border-slate-600" />
        <div className="pointer-events-none absolute bottom-2 left-2 z-10 h-3.5 w-3.5 border-b-2 border-l-2 border-slate-600" />
        <div className="pointer-events-none absolute bottom-2 right-2 z-10 h-3.5 w-3.5 border-b-2 border-r-2 border-slate-600" />
        {/* Route and camera-network overlay */}




      {/* Selected camera details */}
      {hoveredCamera && (
        <div className="pointer-events-none absolute bottom-5 left-5 z-20 w-72 rounded-lg border border-slate-200 bg-white p-4 shadow-md">
          <div className="flex items-center justify-between border-b border-slate-100 pb-2">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-slate-500" />
              <span className="font-mono text-xs font-semibold text-slate-900">{hoveredCamera.id}</span>
            </div>
            <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-700">
              {hoveredCamera.sourceStatus || hoveredCamera.status || "Unknown"}
            </span>
          </div>

          <div className="mt-2 text-xs font-bold text-slate-800">{hoveredCamera.name}</div>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5 rounded-md border border-slate-200 bg-slate-50 p-2.5 text-[10px] text-slate-600">
            <div>Facing: <span className="font-medium text-slate-800">{hoveredCamera.direction || "Unknown"}</span></div>
            <div>Lat: <span className="text-slate-700">{hoveredCamera.latitude.toFixed(4)}</span></div>
            <div>Lng: <span className="text-slate-700">{hoveredCamera.longitude.toFixed(4)}</span></div>
          </div>
        </div>
      )}

      {/* Stored sightings count; road connection is an external routing estimate */}
      {points.length > 0 && (
        <div className="absolute bottom-5 right-5 z-10 flex items-center gap-2.5 rounded-md border-1.5 border-slate-400 bg-white px-3.5 py-2 text-xs font-mono text-slate-900">
          <span className="h-2 w-2 rounded-full bg-slate-800" />
          <span className="font-semibold text-slate-900">{points.length} stored sightings</span>
        </div>
      )}
      </div>
    </div>
  );
}

