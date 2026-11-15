"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import {
  ApiError,
  getCameras,
  getVehicleSummary,
  getVehicleTrajectory,
  type CameraDto,
  type TrajectoryResponseDto,
  type VehicleSummaryDto,
} from "@/lib/api";
import { connectLiveTracking } from "@/lib/liveClient";
import dynamic from "next/dynamic";
import { VehicleSearchPanel, type SearchMode } from "./VehicleSearchPanel";
import { VehicleIntelligencePanel } from "./VehicleIntelligencePanel";
import { DetectionTimeline } from "./DetectionTimeline";
import { EvidenceViewer } from "./EvidenceViewer";

const InvestigationMap = dynamic(
  () => import("./InvestigationMap").then((mod) => mod.InvestigationMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full flex-col items-center justify-center bg-slate-950 p-6 font-mono text-xs text-sky-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent mb-3" />
        INITIALIZING VECTOR MAP ENGINE...
      </div>
    ),
  }
);

type SearchState = "idle" | "searching" | "found" | "not-found" | "error";
type LiveStatus = "idle" | "connecting" | "streaming" | "complete" | "error";

import { SecurityWatchlistModal } from "./SecurityWatchlistModal";
import { PdfReportExporter } from "./PdfReportExporter";
import { InteractiveTrajectoryPlayer } from "./InteractiveTrajectoryPlayer";
import { VideoIngestionModal } from "./VideoIngestionModal";
import { VehicleRegistrySection } from "./VehicleRegistrySection";
import { VehicleRegistryModal } from "./VehicleRegistryModal";

export function InvestigationDashboard() {
  const [cameras, setCameras] = useState<CameraDto[]>([]);
  const [searchState, setSearchState] = useState<SearchState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [summary, setSummary] = useState<VehicleSummaryDto | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryResponseDto | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [replayToken] = useState(0);
  const [liveStatus, setLiveStatus] = useState<LiveStatus>("idle");
  const [isVideoIngestOpen, setIsVideoIngestOpen] = useState(false);
  const [isRegistryModalOpen, setIsRegistryModalOpen] = useState(false);
  const [customVideoUrls, setCustomVideoUrls] = useState<Record<string, string>>({});
  const liveCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCameras({ mode: "all" })
      .then((cams) => {
        if (!cancelled) setCameras(cams);
      })
      .catch(() => {
        if (!cancelled) setCameras([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => liveCleanupRef.current?.();
  }, []);

  function stopLive() {
    liveCleanupRef.current?.();
    liveCleanupRef.current = null;
  }

  function startLive(plate: string, mode: Extract<SearchMode, "live" | "combined">) {
    setLiveStatus("connecting");
    liveCleanupRef.current = connectLiveTracking(plate, {
      onMessage: (message) => {
        if (message.type === "connected") {
          setLiveStatus("streaming");
        } else if (message.type === "detection") {
          if (mode === "live") {
            setTrajectory((prev) =>
              prev
                ? { ...prev, points: [...prev.points, message.point] }
                : {
                    vehicle: summary?.vehicle ?? { plate, vehicleType: null, color: null, make: null, model: null },
                    points: [message.point],
                    overallConfidence: null,
                    estimatedDistanceKm: 0,
                    estimatedDurationMinutes: 0,
                    warning: null,
                  },
            );
          }
          setSelectedIndex(message.index);
        } else if (message.type === "complete") {
          setTrajectory((prev) =>
            prev
              ? {
                  ...prev,
                  overallConfidence: message.overallConfidence,
                  estimatedDistanceKm: message.estimatedDistanceKm,
                  estimatedDurationMinutes: message.estimatedDurationMinutes,
                }
              : prev,
          );
          setLiveStatus("complete");
        } else if (message.type === "error") {
          setLiveStatus("error");
          setErrorMessage(message.message);
        }
      },
      onError: () => setLiveStatus("error"),
    });
  }

  async function handleSearch(
    plate: string,
    mode: SearchMode,
    overrideVehicleType?: string,
    overrideColor?: string,
    overrideVideoUrls?: Record<string, string>,
  ) {
    if (overrideVideoUrls) {
      setCustomVideoUrls(overrideVideoUrls);
    }
    stopLive();
    setSearchState("searching");
    setErrorMessage(null);
    setSummary(null);
    setTrajectory(null);
    setSelectedIndex(null);
    setLiveStatus("idle");

    try {
      const cameraMode = mode === "historical" ? "historic" : mode === "combined" ? "hybrid" : "live";
      const modeCameras = await getCameras({ mode: cameraMode });
      setCameras(modeCameras);
      let summaryResult: VehicleSummaryDto;
      try {
        summaryResult = await getVehicleSummary(plate);
      } catch (lookupError) {
        if (!(lookupError instanceof ApiError && lookupError.isNotFound) || mode === "historical") {
          throw lookupError;
        }
        summaryResult = {
          vehicle: {
            plate,
            vehicleType: null,
            color: null,
            make: null,
            model: null,
          },
          firstSeen: null,
          lastSeen: null,
          cameraCount: 0,
          camerasVisited: [],
          detectionCount: 0,
        };
      }
      if (overrideVehicleType) {
        summaryResult.vehicle.vehicleType = overrideVehicleType;
      }
      if (overrideColor) {
        summaryResult.vehicle.color = overrideColor;
      }
      setSummary(summaryResult);

      if (mode === "historical" || mode === "combined") {
        try {
          const trajectoryResult = await getVehicleTrajectory(plate);
          if (overrideVehicleType) {
            trajectoryResult.vehicle.vehicleType = overrideVehicleType;
          }
          if (overrideColor) {
            trajectoryResult.vehicle.color = overrideColor;
          }
          setTrajectory(trajectoryResult);
          if (trajectoryResult.points.length > 0) setSelectedIndex(0);
        } catch {
          setTrajectory(null);
        }
      }

      setSearchState("found");

      if (mode === "live" || mode === "combined") {
        startLive(plate, mode);
      }
    } catch (err) {
      if (err instanceof ApiError && err.isNotFound) {
        setSearchState("not-found");
      } else {
        setSearchState("error");
        setErrorMessage(err instanceof Error ? err.message : "Search failed");
      }
    }
  }

  const points = trajectory?.points ?? [];
  const selectedPoint = selectedIndex !== null ? points[selectedIndex] ?? null : null;
  const isLive = liveStatus === "connecting" || liveStatus === "streaming";

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Investigation actions */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
        <div>
          <h1 className="text-base font-semibold text-slate-950">Vehicle investigation</h1>
          <p className="mt-0.5 text-xs text-slate-500">Case-scoped search across stored sightings and configured camera sources.</p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setIsVideoIngestOpen(true)}
            className="neo-btn-accent flex items-center gap-2 px-4 py-2.5 text-sm font-mono font-bold uppercase cursor-pointer"
          >
            <span>Recorded footage</span>
          </button>
          <Link
            href="/camera-network"
            className="inline-flex items-center gap-2 rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Camera network{cameras.length > 0 ? ` (${cameras.length})` : ""}
          </Link>
          <button
            type="button"
            onClick={() => setIsRegistryModalOpen(true)}
            className="neo-btn-secondary flex items-center gap-2 px-4 py-2.5 text-sm font-mono font-bold uppercase cursor-pointer"
          >
            <span>🏛️</span>
            <span>VAHAN Registry</span>
          </button>
        </div>
      </div>

      {/* Main 3-Column Layout */}
      <div className="grid flex-1 grid-cols-1 items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Left Column: Target Search & Surveillance Controls */}
        <div className="flex flex-col gap-4">
          <VehicleSearchPanel onSearch={handleSearch} isSearching={searchState === "searching"} />

          <SecurityWatchlistModal />

          <AnimatePresence mode="wait">
            {searchState === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="neo-box p-4 bg-white"
              >
                <div className="flex items-center gap-2 text-slate-950 font-bold text-base mb-1.5 uppercase tracking-wide">
                  <span className="flex h-2.5 w-2.5 rounded-full bg-slate-700" />
                  <span>Ready for Target Input</span>
                </div>
                <p className="text-sm text-slate-800 leading-relaxed font-medium">
                  Enter a vehicle registration number and select an investigation mode. Live processing requires accessible, supported camera feeds.
                </p>
              </motion.div>
            )}

            {searchState === "not-found" && (
              <motion.div
                key="not-found"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="neo-box p-4 border border-slate-300"
              >
                <div className="flex items-center gap-2 text-amber-600 font-bold text-sm mb-1">
                  <span>⚠</span>
                  <span className="uppercase tracking-wide font-mono">TARGET RECORD NOT FOUND</span>
                </div>
                <p className="text-sm text-slate-700 font-medium">
                  No camera detections match this registration plate. Ingest video footage containing this vehicle or verify the plate entered.
                </p>
              </motion.div>
            )}

            {searchState === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="neo-box bg-rose-50 p-4 border border-rose-300"
              >
                <div className="flex items-center gap-2 font-bold mb-1 font-mono text-sm text-rose-700">
                  <span>⛔</span>
                  <span>ENGINE RECONNECTION</span>
                </div>
                <p className="font-medium text-sm text-rose-800">{errorMessage ?? "Unable to connect to trajectory engine."}</p>
              </motion.div>
            )}

            {searchState === "found" && summary && (
              <motion.div
                key="found"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex flex-col gap-3.5"
              >
                {isLive && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3 text-sm font-semibold text-amber-950">
                    <div className="flex items-center gap-2">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                      </span>
                      <span>
                        {liveStatus === "connecting" ? "Connecting to live detection events…" : "Live detection event channel connected"}
                      </span>
                    </div>
                    <span className="rounded bg-white px-2 py-0.5 text-[10px] font-semibold text-amber-900">EVENTS</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-amber-900">
                      This channel receives detections already processed by SIH. It does not itself connect to camera feeds or start AI processing. Manage source access in Data Sources and camera availability in Camera Network.
                    </p>
                  </div>
                )}
                <VehicleIntelligencePanel summary={summary} trajectory={trajectory} />
                <PdfReportExporter summary={summary} trajectory={trajectory} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Map-first investigation workspace */}
        <div className="min-h-[70vh] flex flex-col gap-4">
          <InvestigationMap
            cameras={cameras}
            points={points}
            selectedIndex={selectedIndex}
            onSelectPoint={setSelectedIndex}
            replayToken={replayToken}
          />
          <p className="px-1 text-xs leading-5 text-slate-500">
            Dashed map line, when present, is an estimated road-network connection between stored sightings. It is not evidence of the vehicle&apos;s exact path.
          </p>
          {points.length > 0 && (
            <InteractiveTrajectoryPlayer
              points={points}
              selectedIndex={selectedIndex}
              onSelectPoint={setSelectedIndex}
            />
          )}
          {summary && (
            <VehicleRegistrySection plateNumber={summary.vehicle.plate} />
          )}
        </div>

        {/* Right Column: Timeline & Forensic CCTV Viewer */}
        <div className="flex flex-col gap-4 p-1 lg:col-span-2 lg:grid lg:grid-cols-2 lg:items-start">
          <DetectionTimeline points={points} selectedIndex={selectedIndex} onSelect={setSelectedIndex} />
          {points.length > 0 && selectedPoint ? (
            <EvidenceViewer
              point={selectedPoint}
              targetPlate={summary?.vehicle.plate ?? ""}
              vehicleType={summary?.vehicle.vehicleType ?? trajectory?.vehicle.vehicleType ?? "Sedan"}
              vehicleColor={summary?.vehicle.color ?? trajectory?.vehicle.color ?? "Silver"}
              customVideoUrls={customVideoUrls}
              selectedIndex={selectedIndex}
              totalPoints={points.length}
              onNextCheckpoint={() => {
                if (selectedIndex !== null && selectedIndex < points.length - 1) {
                  setSelectedIndex(selectedIndex + 1);
                }
              }}
              onPrevCheckpoint={() => {
                if (selectedIndex !== null && selectedIndex > 0) {
                  setSelectedIndex(selectedIndex - 1);
                }
              }}
            />
          ) : null}
        </div>
      </div>

      {/* CCTV Video Feed Ingestion Modal */}
      <VideoIngestionModal
        isOpen={isVideoIngestOpen}
        onClose={() => setIsVideoIngestOpen(false)}
        onTargetDetected={(plate, vType, vColor, vUrls) => {
          if (vUrls) setCustomVideoUrls(vUrls);
          handleSearch(plate, "historical", vType, vColor, vUrls);
        }}
      />

      {/* Indian Vehicle Registry VAHAN Modal */}
      <VehicleRegistryModal
        key={`${isRegistryModalOpen ? "open" : "closed"}:${summary?.vehicle.plate ?? ""}`}
        isOpen={isRegistryModalOpen}
        onClose={() => setIsRegistryModalOpen(false)}
        initialPlate={summary?.vehicle.plate ?? ""}
      />
    </div>
  );
}
