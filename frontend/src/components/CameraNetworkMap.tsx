"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import type { CameraDto } from "@/lib/api";

interface CameraNetworkMapProps {
  cameras: CameraDto[];
  selectedCameraId: string | null;
  onSelectCamera: (camera: CameraDto) => void;
  onViewportChange: (bounds: { west: number; south: number; east: number; north: number }) => void;
}

const SOURCE_ID = "sih-camera-inventory";
const CLUSTER_LAYER = "sih-camera-clusters";
const CLUSTER_COUNT_LAYER = "sih-camera-cluster-count";
const CAMERA_LAYER = "sih-camera-points";
const SELECTED_LAYER = "sih-camera-selected";

type CameraFeatureProperties = {
  cameraId: string;
  sourceType: string;
  name: string;
};

function toFeatureCollection(cameras: CameraDto[]): GeoJSON.FeatureCollection<GeoJSON.Point, CameraFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: cameras
      .filter((camera) => Number.isFinite(camera.latitude) && Number.isFinite(camera.longitude)
        && camera.latitude >= -90 && camera.latitude <= 90
        && camera.longitude >= -180 && camera.longitude <= 180)
      .map((camera) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [camera.longitude, camera.latitude],
        },
        properties: {
          cameraId: camera.id,
          sourceType: camera.sourceType || "LEGACY",
          name: camera.name,
        },
      })),
  };
}

export function CameraNetworkMap({ cameras, selectedCameraId, onSelectCamera, onViewportChange }: CameraNetworkMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const camerasRef = useRef(cameras);
  const selectedIdRef = useRef(selectedCameraId);
  const onSelectRef = useRef(onSelectCamera);
  const onViewportChangeRef = useRef(onViewportChange);

  useEffect(() => {
    camerasRef.current = cameras;
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    if (source) source.setData(toFeatureCollection(cameras));
    const positioned = cameras.filter((camera) => Number.isFinite(camera.latitude)
      && Number.isFinite(camera.longitude)
      && camera.latitude >= -90 && camera.latitude <= 90
      && camera.longitude >= -180 && camera.longitude <= 180);
    if (positioned.length === 1) {
      map.easeTo({ center: [positioned[0].longitude, positioned[0].latitude], zoom: 12 });
    } else if (positioned.length > 1) {
      const bounds = new maplibregl.LngLatBounds();
      positioned.forEach((camera) => bounds.extend([camera.longitude, camera.latitude]));
      map.fitBounds(bounds, { padding: 48, maxZoom: 13 });
    }
  }, [cameras]);

  useEffect(() => {
    selectedIdRef.current = selectedCameraId;
    const map = mapRef.current;
    if (!map) return;
    const selectedLayer = map.getLayer(SELECTED_LAYER);
    if (selectedLayer) {
      map.setFilter(SELECTED_LAYER, selectedCameraId
        ? ["==", ["get", "cameraId"], selectedCameraId]
        : ["==", ["get", "cameraId"], "__no_camera_selected__"]);
    }
  }, [selectedCameraId]);

  useEffect(() => {
    onSelectRef.current = onSelectCamera;
  }, [onSelectCamera]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const initialCamera = camerasRef.current.find((camera) => Number.isFinite(camera.latitude)
      && Number.isFinite(camera.longitude)
      && camera.latitude >= -90 && camera.latitude <= 90
      && camera.longitude >= -180 && camera.longitude <= 180);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          "city-dark-basemap": {
            type: "raster",
            tiles: ["https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "Â© OpenStreetMap contributors Â© CARTO",
          },
        },
        layers: [{
          id: "city-dark-basemap-layer",
          type: "raster",
          source: "city-dark-basemap",
          minzoom: 0,
          maxzoom: 22,
        }],
      },
      ...(initialCamera ? { center: [initialCamera.longitude, initialCamera.latitude], zoom: 12 } : {}),
      zoom: initialCamera ? 12 : 4.3,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");
    mapRef.current = map;

    const handleClusterClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      if (!feature) return;
      const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      map.easeTo({ center: coordinates, zoom: Math.min(map.getZoom() + 2, 15), duration: 350 });
    };

    const handleCameraClick = (event: maplibregl.MapLayerMouseEvent) => {
      const feature = event.features?.[0];
      const cameraId = feature?.properties?.cameraId;
      if (typeof cameraId !== "string") return;
      const camera = camerasRef.current.find((item) => item.id === cameraId);
      if (camera) onSelectRef.current(camera);
    };

    const setPointerCursor = () => {
      map.getCanvas().style.cursor = "pointer";
    };
    const resetPointerCursor = () => {
      map.getCanvas().style.cursor = "";
    };

    const publishViewport = () => {
      const bounds = map.getBounds();
      onViewportChangeRef.current({
        west: Math.max(-180, bounds.getWest()),
        south: Math.max(-90, bounds.getSouth()),
        east: Math.min(180, bounds.getEast()),
        north: Math.min(90, bounds.getNorth()),
      });
    };

    const addCameraLayers = () => {
      if (map.getSource(SOURCE_ID)) return;

      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: toFeatureCollection(camerasRef.current),
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 48,
      });

      map.addLayer({
        id: CLUSTER_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#334155",
          "circle-radius": ["step", ["get", "point_count"], 15, 20, 19, 100, 24, 500, 29],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: "symbol",
        source: SOURCE_ID,
        filter: ["has", "point_count"],
        layout: {
          "text-field": ["get", "point_count_abbreviated"],
          "text-font": ["Open Sans Semibold", "Arial Unicode MS Bold"],
          "text-size": 11,
        },
        paint: { "text-color": "#ffffff" },
      });

      map.addLayer({
        id: CAMERA_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match", ["get", "sourceType"],
            "PUBLIC_CATALOG", "#16835d",
            "GOVERNMENT_API", "#2563a6",
            "#64748b",
          ],
          "circle-stroke-width": 1.8,
          "circle-stroke-color": "#ffffff",
        },
      });

      map.addLayer({
        id: SELECTED_LAYER,
        type: "circle",
        source: SOURCE_ID,
        filter: ["==", ["get", "cameraId"], selectedIdRef.current || "__no_camera_selected__"],
        paint: {
          "circle-radius": 11,
          "circle-color": "rgba(15,23,42,0)",
          "circle-stroke-width": 2.5,
          "circle-stroke-color": "#0f172a",
        },
      });

      map.on("click", CLUSTER_LAYER, handleClusterClick);
      map.on("click", CAMERA_LAYER, handleCameraClick);
      map.on("mouseenter", CLUSTER_LAYER, setPointerCursor);
      map.on("mouseenter", CAMERA_LAYER, setPointerCursor);
      map.on("mouseleave", CLUSTER_LAYER, resetPointerCursor);
      map.on("mouseleave", CAMERA_LAYER, resetPointerCursor);
    };

    map.on("load", addCameraLayers);
    map.on("load", publishViewport);
    map.on("moveend", publishViewport);

    return () => {
      map.off("load", addCameraLayers);
      map.off("load", publishViewport);
      map.off("moveend", publishViewport);
      map.off("click", CLUSTER_LAYER, handleClusterClick);
      map.off("click", CAMERA_LAYER, handleCameraClick);
      map.off("mouseenter", CLUSTER_LAYER, setPointerCursor);
      map.off("mouseenter", CAMERA_LAYER, setPointerCursor);
      map.off("mouseleave", CLUSTER_LAYER, resetPointerCursor);
      map.off("mouseleave", CAMERA_LAYER, resetPointerCursor);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div ref={containerRef} className="h-full min-h-[520px] w-full bg-slate-100" aria-label="Camera network map" />;
}

