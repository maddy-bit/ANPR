"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import * as maplibregl from "maplibre-gl";
import type {
  TrajectoryObservationDto,
  TrajectoryTransitionDto,
  TrajectorySegmentDto,
} from "@/lib/api";

const GOOGLE_GLYPHS = "https://fonts.openmaptiles.org/{fontstack}/{range}.pbf";

const VERIFIED_SOURCE_ID = "verified-road-routes";
const GEODESIC_SOURCE_ID = "geodesic-routes";

function createBasemapStyle(
  sourceKey: string,
  tiles: string[],
  layerKey: string
): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      [sourceKey]: {
        type: "raster",
        tiles,
        tileSize: 256,
        attribution: "© Google Maps / OpenStreetMap | Traffic Intelligence Matrix",
      },
      [VERIFIED_SOURCE_ID]: {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      },
      [GEODESIC_SOURCE_ID]: {
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
      // Geodesic (Unverified) casing & line (Dashed Amber)
      {
        id: "geodesic-casing",
        type: "line",
        source: GEODESIC_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#451a03",
          "line-width": 8,
          "line-opacity": 0.8,
        },
      },
      {
        id: "geodesic-line",
        type: "line",
        source: GEODESIC_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#f59e0b",
          "line-width": 3.5,
          "line-dasharray": [3, 2],
          "line-opacity": 0.95,
        },
      },
      // Verified Road Network Line (Solid Emerald Glow)
      {
        id: "verified-casing",
        type: "line",
        source: VERIFIED_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#064e3b",
          "line-width": 9,
          "line-opacity": 0.9,
        },
      },
      {
        id: "verified-glow",
        type: "line",
        source: VERIFIED_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#10b981",
          "line-width": 5,
          "line-opacity": 1.0,
        },
      },
      {
        id: "verified-laser",
        type: "line",
        source: VERIFIED_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": "#34d399",
          "line-width": 2.5,
          "line-opacity": 1.0,
        },
      },
    ],
    glyphs: GOOGLE_GLYPHS,
  };
}

const BASEMAP_STYLES: Record<"streets" | "satellite" | "dark", maplibregl.StyleSpecification> = {
  streets: createBasemapStyle(
    "google-streets",
    ["https://mt0.google.com/vt/lyrs=m&x={x}&y={y}&z={z}"],
    "google-streets-layer"
  ),
  satellite: createBasemapStyle(
    "google-satellite",
    ["https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}"],
    "google-satellite-layer"
  ),
  dark: createBasemapStyle(
    "carto-dark",
    [
      "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
    ],
    "carto-dark-layer"
  ),
};

export interface TrajectoryInvestigationMapProps {
  observations: TrajectoryObservationDto[];
  transitions: TrajectoryTransitionDto[];
  segments: TrajectorySegmentDto[];
  selectedObservationId: number | null;
  onSelectObservation?: (id: number) => void;
}

export function TrajectoryInvestigationMap({
  observations,
  transitions,
  segments,
  selectedObservationId,
  onSelectObservation,
}: TrajectoryInvestigationMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [activeLayer, setActiveLayer] = useState<"streets" | "satellite" | "dark">("streets");

  // Filter observations that possess genuine, valid coordinates (NEVER fabricate positions)
  const validObservations = useMemo(() => {
    return observations.filter(
      (o) =>
        o.hasCoordinates &&
        o.latitude != null &&
        o.longitude != null &&
        !isNaN(o.latitude) &&
        !isNaN(o.longitude) &&
        (Math.abs(o.latitude) > 1e-4 || Math.abs(o.longitude) > 1e-4)
    );
  }, [observations]);

  // Observations with missing/unconfigured coordinates (strictly kept off the map)
  const missingCoordsCount = observations.length - validObservations.length;

  // Initialize MapLibre
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCenter: [number, number] =
      validObservations.length > 0
        ? [validObservations[0].longitude!, validObservations[0].latitude!]
        : [73.8567, 18.5204]; // Pune fallback center

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLES[activeLayer],
      center: initialCenter,
      zoom: 13,
      pitch: 30,
      bearing: 0,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      setMapReady(true);
      mapRef.current = map;
    });

    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Update basemap style if switched
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setStyle(BASEMAP_STYLES[activeLayer]);
  }, [activeLayer, mapReady]);

  // Update Route GeoJSON Lines & Markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    // 1. Clear old markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    // Map detectionId -> Observation for coordinate lookup
    const obsMap = new Map<number, TrajectoryObservationDto>();
    observations.forEach((o) => obsMap.set(o.detectionId, o));

    // 2. Build GeoJSON features for transitions
    // RULES:
    // - Verified road edge -> VERIFIED_SOURCE_ID (solid green)
    // - Unverified geodesic -> GEODESIC_SOURCE_ID (dashed amber)
    // - Impossible or Unknown transitions -> DO NOT DRAW as confirmed travel route! Disconnect segments!
    const verifiedFeatures: GeoJSON.Feature[] = [];
    const geodesicFeatures: GeoJSON.Feature[] = [];

    for (const t of transitions) {
      // Discard impossible or unknown transitions from confirmed route drawing
      if (t.status === "IMPOSSIBLE" || t.status === "FEASIBILITY_UNKNOWN") {
        continue;
      }

      const o1 = obsMap.get(t.fromDetectionId);
      const o2 = obsMap.get(t.toDetectionId);

      if (
        o1?.hasCoordinates &&
        o2?.hasCoordinates &&
        o1.longitude != null &&
        o1.latitude != null &&
        o2.longitude != null &&
        o2.latitude != null
      ) {
        // Skip same-camera transitions for route lines
        if (t.connectivity === "SAME_CAMERA") {
          continue;
        }

        const feature: GeoJSON.Feature = {
          type: "Feature",
          properties: {
            fromCam: t.fromCameraId,
            toCam: t.toCameraId,
            connectivity: t.connectivity,
            distanceKm: t.distanceKm,
            apparentSpeedKmh: t.apparentSpeedKmh,
          },
          geometry: {
            type: "LineString",
            coordinates: [
              [o1.longitude, o1.latitude],
              [o2.longitude, o2.latitude],
            ],
          },
        };

        if (t.connectivity === "VERIFIED_ROAD_EDGE") {
          verifiedFeatures.push(feature);
        } else {
          // UNVERIFIED_GEODESIC
          geodesicFeatures.push(feature);
        }
      }
    }

    // Set Data on GeoJSON Sources
    const verifiedSrc = map.getSource(VERIFIED_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (verifiedSrc) {
      verifiedSrc.setData({
        type: "FeatureCollection",
        features: verifiedFeatures,
      });
    }

    const geodesicSrc = map.getSource(GEODESIC_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (geodesicSrc) {
      geodesicSrc.setData({
        type: "FeatureCollection",
        features: geodesicFeatures,
      });
    }

    // 3. Render Camera Markers for valid observations
    validObservations.forEach((obs, idx) => {
      const isSelected = selectedObservationId === obs.detectionId;
      const el = document.createElement("div");
      el.className = `cursor-pointer transition-transform duration-200 ${
        isSelected ? "scale-125 z-50" : "hover:scale-110 z-10"
      }`;

      el.innerHTML = `
        <div class="relative flex items-center justify-center">
          <div class="flex h-8 w-8 items-center justify-center rounded-full border-2 ${
            isSelected
              ? "border-amber-400 bg-amber-500 shadow-lg shadow-amber-500/50 text-slate-950 font-black"
              : "border-sky-400 bg-slate-900 shadow-md text-sky-300 font-bold"
          } text-xs font-mono">
            ${idx + 1}
          </div>
          <div class="absolute -bottom-4 whitespace-nowrap rounded-xs bg-slate-950/90 px-1 py-0.5 text-[9px] font-mono text-slate-200 border border-slate-700 shadow-xs">
            ${obs.cameraId}
          </div>
        </div>
      `;

      el.addEventListener("click", () => {
        onSelectObservation?.(obs.detectionId);
      });

      const popup = new maplibregl.Popup({ offset: 25, closeButton: false }).setHTML(`
        <div class="p-2 font-mono text-xs text-slate-900">
          <div class="font-bold text-sky-800 uppercase tracking-wider">#${idx + 1} ${obs.cameraId}</div>
          <div class="text-[11px] text-slate-700">${obs.cameraName}</div>
          <div class="mt-1 text-[10px] text-slate-600">Timestamp: ${obs.timestamp ? new Date(obs.timestamp).toLocaleTimeString() : "N/A"}</div>
          <div class="text-[10px] text-slate-600">Plate: ${obs.plateText || "N/A"} (${obs.plateConfidence != null ? Math.round(obs.plateConfidence * 100) + "%" : "N/A"})</div>
          <div class="text-[10px] text-slate-600">Confidence: ${obs.detectionConfidence != null ? Math.round(obs.detectionConfidence * 100) + "%" : "N/A"}</div>
        </div>
      `);

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([obs.longitude!, obs.latitude!])
        .setPopup(popup)
        .addTo(map);

      markersRef.current.push(marker);
    });

    // 4. Auto-fit bounds if valid coordinates exist
    if (validObservations.length > 0) {
      const bounds = new maplibregl.LngLatBounds();
      validObservations.forEach((o) => bounds.extend([o.longitude!, o.latitude!]));
      map.fitBounds(bounds, { padding: 60, maxZoom: 16, duration: 800 });
    }
  }, [validObservations, transitions, segments, selectedObservationId, mapReady]);

  return (
    <div className="relative flex flex-col h-full w-full overflow-hidden rounded-md border border-slate-300 bg-slate-950">
      {/* MapLibre WebGL Canvas Container */}
      <div ref={containerRef} className="h-full w-full min-h-[420px]" />

      {/* Floating Basemap Selector */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-900/90 p-1 backdrop-blur-md shadow-md">
        {(["streets", "satellite", "dark"] as const).map((layer) => (
          <button
            key={layer}
            type="button"
            onClick={() => setActiveLayer(layer)}
            className={`rounded-xs px-2.5 py-1 text-xs font-mono uppercase tracking-wider transition-all cursor-pointer ${
              activeLayer === layer
                ? "bg-sky-500 text-slate-950 font-bold shadow-xs"
                : "text-slate-300 hover:bg-slate-800"
            }`}
          >
            {layer}
          </button>
        ))}
      </div>

      {/* Strict Provenance & Topology Legend */}
      <div className="absolute bottom-3 left-3 z-20 flex flex-col gap-1.5 rounded-md border border-slate-700/80 bg-slate-950/90 p-3 font-mono text-xs text-slate-300 backdrop-blur-md shadow-lg max-w-sm">
        <div className="text-[11px] font-bold text-sky-400 uppercase tracking-wider flex items-center justify-between">
          <span>Route Topology Legend</span>
          <span className="text-[9px] text-slate-400 font-normal">MapLibre GL</span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="h-2.5 w-6 rounded-xs bg-emerald-500 shadow-xs shadow-emerald-500/50" />
          <span>Verified Road Edge (Calibrated)</span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="h-1 w-6 border-b-2 border-dashed border-amber-400" />
          <span className="text-amber-300">
            Unverified Geodesic <span className="text-[9px] text-slate-400">(Straight-line estimate)</span>
          </span>
        </div>

        <div className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 rounded-full border border-rose-500 bg-rose-600" />
          <span className="text-rose-300">
            Impossible Transit <span className="text-[9px] text-slate-400">(Route broken / not drawn)</span>
          </span>
        </div>

        {missingCoordsCount > 0 && (
          <div className="mt-1 flex items-center gap-1.5 rounded-xs border border-amber-500/50 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-300">
            <span>⚠️</span>
            <span>{missingCoordsCount} observation(s) missing coordinates; visible in timeline only.</span>
          </div>
        )}
      </div>
    </div>
  );
}

