"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { CameraDto } from "@/lib/api";
import { ingestCameraFootage, getIngestionJobStatus } from "@/lib/api";

interface LiveCameraGridModalProps {
  isOpen: boolean;
  onClose: () => void;
  cameras: CameraDto[];
  targetVehicleType?: string | null;
  onTargetDetected?: (plate: string) => void;
}

const AVAILABLE_ARCHIVES = new Set([
  "CAM-01", "CAM-02", "CAM-03", "CAM-04", "CAM-05",
  "CAM-06", "CAM-07", "CAM-08", "CAM-09", "CAM-10", "CAM-11"
]);

export function LiveCameraGridModal({
  isOpen,
  onClose,
  cameras,
  targetVehicleType,
  onTargetDetected,
}: LiveCameraGridModalProps) {
  const [selectedFilter, setSelectedFilter] = useState<"ALL" | "ARCHIVED" | "STANDBY">("ALL");
  const [expandedCam, setExpandedCam] = useState<CameraDto | null>(null);

  // In-modal AI pipeline execution state for expanded camera
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"IDLE" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED">("IDLE");
  const [jobProgress, setJobProgress] = useState(0);
  const [jobDetails, setJobDetails] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [enableDehaze, setEnableDehaze] = useState(false);

  const pollRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const resetJob = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    setJobId(null);
    setJobStatus("IDLE");
    setJobProgress(0);
    setJobDetails(null);
    setErrorMessage(null);
  };

  const handleRunPipeline = async (camId: string) => {
    resetJob();
    try {
      setJobStatus("QUEUED");
      const res = await ingestCameraFootage(camId, enableDehaze);
      const activeJobId = res.jobId;
      setJobId(activeJobId);

      pollRef.current = setInterval(async () => {
        try {
          const statusRes = await getIngestionJobStatus(activeJobId);
          setJobStatus(statusRes.status);
          setJobProgress(statusRes.progress || 0);
          if (statusRes.details) {
            setJobDetails(statusRes.details);
          }

          if (statusRes.status === "COMPLETED" || statusRes.status === "FAILED") {
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            if (statusRes.status === "FAILED") {
              setErrorMessage(statusRes.details?.error || "AI pipeline execution failed.");
            }
          }
        } catch (pollErr: any) {
          console.warn("Poll error for camera pipeline:", pollErr);
        }
      }, 600);
    } catch (err: any) {
      setJobStatus("FAILED");
      setErrorMessage(err.message || "Failed to trigger AI pipeline for camera.");
    }
  };

  const filteredCameras = cameras.filter((c) => {
    const hasArchive = AVAILABLE_ARCHIVES.has(c.id);
    if (selectedFilter === "ARCHIVED") return hasArchive;
    if (selectedFilter === "STANDBY") return !hasArchive;
    return true;
  });

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 backdrop-blur-xl bg-slate-900/60">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="relative flex h-[90vh] w-full max-w-7xl flex-col rounded-xl border border-slate-300 bg-white shadow-2xl overflow-hidden"
          >
            {/* Top Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-3.5">
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 rounded-full bg-blue-500" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-xs bg-blue-50 text-blue-700 border border-blue-200 font-bold uppercase">
                      {cameras.length}-NODE MATRIX
                    </span>
                    <span className="text-[10px] font-mono font-semibold text-slate-500">
                      CCTV SURVEILLANCE & RE-ID WALL
                    </span>
                  </div>
                  <h2 className="text-base font-bold tracking-tight text-slate-900 flex items-center gap-2 uppercase">
                    <span>Corridor Camera Feed Matrix</span>
                  </h2>
                </div>
              </div>

              {/* Filter Tabs & Close Button */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 p-0.5 shadow-xs">
                  {(["ALL", "ARCHIVED", "STANDBY"] as const).map((filter) => (
                    <button
                      key={filter}
                      type="button"
                      onClick={() => setSelectedFilter(filter)}
                      className={`rounded-xs px-2.5 py-1 text-xs font-mono font-bold transition-all cursor-pointer ${
                        selectedFilter === filter
                          ? "bg-slate-900 text-white shadow-xs"
                          : "text-slate-700 hover:bg-slate-200/70"
                      }`}
                    >
                      {filter}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 transition-all cursor-pointer font-bold shadow-xs"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Camera Grid Matrix */}
            <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-slate-50">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filteredCameras.map((cam) => {
                  const hasArchive = AVAILABLE_ARCHIVES.has(cam.id);

                  return (
                    <motion.div
                      key={cam.id}
                      whileHover={{ scale: 1.015 }}
                      className="relative flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs group hover:border-slate-400 hover:shadow-md transition-all cursor-pointer"
                      onClick={() => {
                        resetJob();
                        setExpandedCam(cam);
                      }}
                    >
                      {/* Camera Header */}
                      <div className="flex items-center justify-between bg-white px-3 py-2 border-b border-slate-100 text-xs font-mono">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              hasArchive ? "bg-emerald-500" : "bg-amber-400"
                            }`}
                          />
                          <span className="font-bold text-slate-900">{cam.id}</span>
                        </div>
                        <span className="text-[10px] text-slate-500 font-semibold truncate max-w-[140px]">
                          {cam.name}
                        </span>
                      </div>

                      {/* Video Feed Viewport */}
                      <div className="relative h-44 w-full bg-slate-950 flex items-center justify-center overflow-hidden">
                        {hasArchive ? (
                          <video
                            src={`/videos/${cam.id}.mp4`}
                            autoPlay
                            loop
                            muted
                            playsInline
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-500 gap-1 font-mono text-xs">
                            <span className="text-2xl">📡</span>
                            <span>STANDBY</span>
                            <span className="text-[10px] text-slate-600">Awaiting Feed Stream</span>
                          </div>
                        )}

                        {/* Viewfinder crosshairs */}
                        <div className="absolute top-2 left-2 h-2 w-2 border-t-2 border-l-2 border-slate-400/60" />
                        <div className="absolute top-2 right-2 h-2 w-2 border-t-2 border-r-2 border-slate-400/60" />
                        <div className="absolute bottom-2 left-2 h-2 w-2 border-b-2 border-l-2 border-slate-400/60" />
                        <div className="absolute bottom-2 right-2 h-2 w-2 border-b-2 border-r-2 border-slate-400/60" />

                        {/* Telemetry info watermark */}
                        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 text-[9px] font-mono text-zinc-300 bg-slate-950/80 px-1.5 py-0.5 rounded">
                          <span className="text-cyan-400 font-bold">{cam.direction || "SE"}</span>
                          <span>• {cam.id}</span>
                        </div>

                        <div className="absolute bottom-2 right-2 text-[9px] font-mono font-bold bg-slate-950/80 px-1.5 py-0.5 rounded">
                          <span className={hasArchive ? "text-emerald-400" : "text-amber-400"}>
                            {hasArchive ? "FOOTAGE READY" : "NO ARCHIVE"}
                          </span>
                        </div>
                      </div>

                      {/* Camera Footer Telemetry */}
                      <div className="flex items-center justify-between bg-slate-50 px-3 py-1.5 text-[10px] font-mono text-slate-500 border-t border-slate-100">
                        <span>Lat: {cam.latitude.toFixed(4)}</span>
                        <span>Lng: {cam.longitude.toFixed(4)}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* Expanded Camera Modal View */}
            {expandedCam && (
              <div className="absolute inset-0 z-30 flex flex-col bg-white/95 p-6 backdrop-blur-2xl overflow-y-auto">
                <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                  <div className="flex items-center gap-3">
                    <span
                      className={`h-3 w-3 rounded-full ${
                        AVAILABLE_ARCHIVES.has(expandedCam.id) ? "bg-emerald-500" : "bg-amber-400"
                      }`}
                    />
                    <div>
                      <h3 className="text-base font-bold text-slate-900 font-mono">
                        {expandedCam.id} {"//"} {expandedCam.name}
                      </h3>
                      <div className="text-xs font-mono font-semibold text-slate-500">
                        TRAFFIC CORRIDOR SURVEILLANCE & INVESTIGATION NODE
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      resetJob();
                      setExpandedCam(null);
                    }}
                    className="rounded-xl border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                  >
                    Back to Grid
                  </button>
                </div>

                {/* Expanded Video and Pipeline Panel */}
                <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1">
                  {/* Left: Video Player */}
                  <div className="lg:col-span-2 flex flex-col justify-center rounded-2xl border border-slate-300 bg-black overflow-hidden shadow-xl min-h-[360px]">
                    {AVAILABLE_ARCHIVES.has(expandedCam.id) ? (
                      <video
                        src={`/videos/${expandedCam.id}.mp4`}
                        controls
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="w-full max-h-[500px] object-contain"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-12 text-slate-400 font-mono text-sm">
                        <span className="text-4xl mb-2">📹</span>
                        <div className="font-bold text-white">No Recorded Footage File</div>
                        <div className="text-xs text-slate-500 mt-1">
                          Corridor video for {expandedCam.id} is not present in videos/ directory.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Right: Telemetry & Ingestion Actions */}
                  <div className="flex flex-col gap-4 font-mono text-xs">
                    {/* Node Metadata */}
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2">
                      <h4 className="font-bold uppercase tracking-wider text-slate-900 text-xs">
                        Camera Telemetry
                      </h4>
                      <div className="space-y-1.5 text-slate-700">
                        <div className="flex justify-between">
                          <span className="text-slate-500">Identifier:</span>
                          <span className="font-bold text-slate-900">{expandedCam.id}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Junction Name:</span>
                          <span className="font-bold text-slate-900 truncate max-w-[160px]">
                            {expandedCam.name}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">GPS Coordinates:</span>
                          <span className="font-bold text-slate-900">
                            {expandedCam.latitude.toFixed(4)}, {expandedCam.longitude.toFixed(4)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Corridor Heading:</span>
                          <span className="font-bold text-slate-900">{expandedCam.direction || "SE"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Archive Source:</span>
                          <span className="font-bold text-slate-900">
                            {AVAILABLE_ARCHIVES.has(expandedCam.id)
                              ? `videos/${expandedCam.id}.mp4`
                              : "None"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Pipeline Trigger & Execution Status */}
                    {AVAILABLE_ARCHIVES.has(expandedCam.id) && (
                      <div className="rounded-xl border border-slate-300 bg-white p-4 space-y-3 shadow-xs">
                        <h4 className="font-bold uppercase tracking-wider text-slate-900 text-xs">
                          AI Pipeline Execution
                        </h4>

                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id="expanded-dehaze"
                            checked={enableDehaze}
                            onChange={(e) => setEnableDehaze(e.target.checked)}
                            disabled={jobStatus === "QUEUED" || jobStatus === "PROCESSING"}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <label htmlFor="expanded-dehaze" className="text-[11px] text-slate-700 font-sans cursor-pointer">
                            Enable DCP Dehazing preprocessing
                          </label>
                        </div>

                        {jobStatus === "IDLE" ? (
                          <button
                            type="button"
                            onClick={() => handleRunPipeline(expandedCam.id)}
                            className="neo-btn w-full py-2.5 text-xs font-bold uppercase cursor-pointer flex items-center justify-center gap-2"
                          >
                            <span>⚡</span>
                            <span>Run AI Pipeline on {expandedCam.id}</span>
                          </button>
                        ) : (
                          <div className="space-y-2.5">
                            <div className="flex items-center justify-between text-xs">
                              <span
                                className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                                  jobStatus === "COMPLETED"
                                    ? "bg-emerald-100 text-emerald-800"
                                    : jobStatus === "FAILED"
                                    ? "bg-rose-100 text-rose-800"
                                    : "bg-blue-100 text-blue-800 animate-pulse"
                                }`}
                              >
                                {jobStatus}
                              </span>
                              <span className="font-bold">{jobProgress}%</span>
                            </div>

                            <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                              <motion.div
                                className="h-full bg-slate-900"
                                initial={{ width: 0 }}
                                animate={{ width: `${jobProgress}%` }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>

                            {/* Job Telemetry Metrics */}
                            {jobDetails && (
                              <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                                <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-500 block">Detections:</span>
                                  <span className="font-bold text-slate-900">
                                    {jobDetails.detections_count ?? 0}
                                  </span>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded border border-slate-200">
                                  <span className="text-slate-500 block">Tracks:</span>
                                  <span className="font-bold text-slate-900">
                                    {jobDetails.tracks_count ?? jobDetails.active_tracks ?? 0}
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Recognized Plates */}
                            {jobDetails?.recognized_plates && jobDetails.recognized_plates.length > 0 && (
                              <div className="pt-2 border-t border-slate-200">
                                <span className="text-[10px] font-bold text-slate-600 block mb-1">
                                  Recognized Plates ({jobDetails.recognized_plates.length}):
                                </span>
                                <div className="flex flex-wrap gap-1">
                                  {jobDetails.recognized_plates.map((plate: string) => (
                                    <button
                                      key={plate}
                                      type="button"
                                      onClick={() => {
                                        if (onTargetDetected) onTargetDetected(plate);
                                        onClose();
                                      }}
                                      className="rounded bg-slate-100 border border-slate-300 px-2 py-0.5 text-xs font-bold text-slate-900 hover:bg-slate-900 hover:text-white transition-colors cursor-pointer"
                                    >
                                      {plate}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}

                            {errorMessage && (
                              <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded border border-rose-200">
                                {errorMessage}
                              </div>
                            )}

                            {jobStatus === "COMPLETED" && (
                              <button
                                type="button"
                                onClick={() => handleRunPipeline(expandedCam.id)}
                                className="mt-2 w-full rounded border border-slate-300 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                              >
                                Re-run Analysis
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
