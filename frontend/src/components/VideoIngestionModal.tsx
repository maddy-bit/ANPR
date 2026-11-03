"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { uploadVideoFile, ingestCameraFootage, getIngestionJobStatus } from "@/lib/api";

interface VideoIngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTargetDetected?: (plate: string, vehicleType?: string, color?: string, videoUrls?: Record<string, string>) => void;
}

const AVAILABLE_CAMERAS = [
  { id: "CAM-01", name: "Shivajinagar Chowk", file: "CAM-01.mp4" },
  { id: "CAM-02", name: "FC Road Junction", file: "CAM-02.mp4" },
  { id: "CAM-03", name: "JM Road - Deccan Gymkhana", file: "CAM-03.mp4" },
  { id: "CAM-04", name: "Karve Road Bridge", file: "CAM-04.mp4" },
  { id: "CAM-05", name: "Swargate Junction", file: "CAM-05.mp4" },
  { id: "CAM-06", name: "Hadapsar Industrial Estate", file: "CAM-06.mp4" },
  { id: "CAM-07", name: "Kothrud Depot", file: "CAM-07.mp4" },
  { id: "CAM-08", name: "Baner Road", file: "CAM-08.mp4" },
  { id: "CAM-09", name: "Hinjewadi Phase 1", file: "CAM-09.mp4" },
  { id: "CAM-10", name: "Wakad Bridge", file: "CAM-10.mp4" },
  { id: "CAM-11", name: "Aundh - ITI Road", file: "CAM-11.mp4" },
];

export function VideoIngestionModal({ isOpen, onClose, onTargetDetected }: VideoIngestionModalProps) {
  const [mode, setMode] = useState<"CORRIDOR" | "UPLOAD">("CORRIDOR");
  const [selectedCamera, setSelectedCamera] = useState("CAM-01");
  const [enableDehaze, setEnableDehaze] = useState(false);
  const [targetPlate, setTargetPlate] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Job tracking state
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"IDLE" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED">("IDLE");
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Metrics from real AI execution
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [detectionsCount, setDetectionsCount] = useState(0);
  const [tracksCount, setTracksCount] = useState(0);
  const [recognizedPlates, setRecognizedPlates] = useState<string[]>([]);
  const [executedFps, setExecutedFps] = useState<number | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clean up polling interval and reset when component unmounts or opens
  useEffect(() => {
    if (isOpen) {
      resetJobState();
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen]);

  const resetJobState = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setJobId(null);
    setJobStatus("IDLE");
    setProgress(0);
    setStatusText("");
    setErrorMessage(null);
    setFramesProcessed(0);
    setTotalFrames(0);
    setDetectionsCount(0);
    setTracksCount(0);
    setRecognizedPlates([]);
    setExecutedFps(null);
  };

  const handleStartIngestion = async () => {
    resetJobState();
    setErrorMessage(null);

    let activeJobId = "";
    let activeCameraId = selectedCamera;

    try {
      if (mode === "UPLOAD") {
        if (!uploadFile) {
          setErrorMessage("Please select a valid video file to upload (.mp4, .avi, .mov, .mkv).");
          return;
        }
        if (uploadFile.size > 150 * 1024 * 1024) {
          setErrorMessage("Uploaded video exceeds the 150MB limit.");
          return;
        }
        setJobStatus("QUEUED");
        setStatusText("Uploading binary video to AI ingestion service...");
        const res = await uploadVideoFile(uploadFile, selectedCamera, enableDehaze);
        activeJobId = res.jobId;
        activeCameraId = selectedCamera;
      } else {
        setJobStatus("QUEUED");
        setStatusText(`Requesting corridor AI pipeline execution on ${selectedCamera} footage...`);
        const res = await ingestCameraFootage(selectedCamera, enableDehaze);
        activeJobId = res.jobId;
        activeCameraId = selectedCamera;
      }

      setJobId(activeJobId);
      setStatusText(`Job ${activeJobId} registered. Ingestion pipeline initializing...`);

      // Poll actual job status from backend / AI service
      pollIntervalRef.current = setInterval(async () => {
        try {
          const statusRes = await getIngestionJobStatus(activeJobId);
          setJobStatus(statusRes.status);
          setProgress(statusRes.progress || 0);

          if (statusRes.details) {
            if (typeof statusRes.details.frames_processed === "number") {
              setFramesProcessed(statusRes.details.frames_processed);
            }
            if (typeof statusRes.details.total_frames === "number") {
              setTotalFrames(statusRes.details.total_frames);
            }
            if (typeof statusRes.details.detections_count === "number") {
              setDetectionsCount(statusRes.details.detections_count);
            }
            const tracks = statusRes.details.tracks_count;
            if (typeof tracks === "number") {
              setTracksCount(tracks);
            }
            if (Array.isArray(statusRes.details.recognized_plates)) {
              setRecognizedPlates(statusRes.details.recognized_plates);
            }
            if (typeof statusRes.details.fps === "number") {
              setExecutedFps(statusRes.details.fps);
            }
          }

          if (statusRes.status === "PROCESSING") {
            const framesInfo = statusRes.details?.total_frames
              ? ` (${statusRes.details.frames_processed || 0}/${statusRes.details.total_frames} frames)`
              : "";
            setStatusText(`Running YOLOv8 vehicle detector & ByteTrack tracker${framesInfo}...`);
          } else if (statusRes.status === "COMPLETED") {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setProgress(100);
            setStatusText("AI Processing Pipeline execution completed successfully!");
          } else if (statusRes.status === "FAILED") {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            setStatusText("Job failed.");
            setErrorMessage(statusRes.details?.error || "AI pipeline encountered an error during frame processing.");
          }
        } catch (pollErr: any) {
          // If polling fails temporarily, log and continue polling
          console.warn("Job status poll error:", pollErr);
        }
      }, 600);
    } catch (err: any) {
      setJobStatus("FAILED");
      setErrorMessage(err.message || "Failed to start video ingestion job.");
    }
  };

  const handleApplyPlateToInvestigation = (plateToUse: string) => {
    const videoUrls: Record<string, string> = {};
    if (mode === "UPLOAD" && uploadFile) {
      try {
        videoUrls[selectedCamera] = URL.createObjectURL(uploadFile);
      } catch {
        videoUrls[selectedCamera] = `/videos/${selectedCamera}.mp4`;
      }
    } else {
      videoUrls[selectedCamera] = `/videos/${selectedCamera}.mp4`;
    }

    if (onTargetDetected) {
      onTargetDetected(plateToUse.trim().toUpperCase(), undefined, undefined, videoUrls);
    }
    onClose();
  };

  const isWorking = jobStatus === "QUEUED" || jobStatus === "PROCESSING";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-2xl border border-slate-300 bg-white p-6 shadow-2xl rounded-xl max-h-[90vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-300 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white font-bold text-lg">
                  📹
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-950 tracking-tight uppercase">
                    CCTV Video Ingestion & AI Pipeline
                  </h2>
                  <p className="text-xs text-slate-700 font-mono font-semibold tracking-wider">
                    YOLOV8 • BYTETRACK • EASYOCR • RE-ID EMBEDDINGS • EVIDENCE
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isWorking}
                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold uppercase text-slate-700 hover:bg-slate-50 shadow-xs transition-all cursor-pointer disabled:opacity-50"
              >
                ✕ Close
              </button>
            </div>

            {/* Ingestion Source Tabs */}
            <div className="mt-4 flex rounded-lg border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => {
                  if (!isWorking) setMode("CORRIDOR");
                }}
                disabled={isWorking}
                className={`flex-1 rounded-md py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                  mode === "CORRIDOR" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🎥 Recorded Corridor Camera Footage
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isWorking) setMode("UPLOAD");
                }}
                disabled={isWorking}
                className={`flex-1 rounded-md py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                  mode === "UPLOAD" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                📁 Upload Custom Video (MP4 / AVI)
              </button>
            </div>

            {/* Ingestion Parameters Form */}
            <div className="mt-4 space-y-4 font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Camera Node Selection */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                    Target Camera Node
                  </label>
                  <select
                    value={selectedCamera}
                    onChange={(e) => {
                      setSelectedCamera(e.target.value);
                      resetJobState();
                    }}
                    disabled={isWorking}
                    className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-slate-900"
                  >
                    {AVAILABLE_CAMERAS.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.id} — {cam.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Plate Filter (Optional) */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                    Filter Target Plate (Optional)
                  </label>
                  <input
                    type="text"
                    value={targetPlate}
                    onChange={(e) => setTargetPlate(e.target.value.toUpperCase())}
                    placeholder="e.g. MH12DE1433"
                    disabled={isWorking}
                    className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs font-mono font-bold text-slate-950 focus:outline-none focus:border-slate-900 uppercase"
                  >
                  </input>
                </div>
              </div>

              {/* Mode-specific Input */}
              {mode === "UPLOAD" ? (
                <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                  <input
                    type="file"
                    id="video-upload-file"
                    accept=".mp4,.avi,.mov,.mkv"
                    disabled={isWorking}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        setUploadFile(e.target.files[0]);
                        resetJobState();
                      }
                    }}
                    className="hidden"
                  />
                  <label
                    htmlFor="video-upload-file"
                    className="cursor-pointer flex flex-col items-center justify-center gap-1.5"
                  >
                    <span className="text-2xl">📤</span>
                    <span className="text-xs font-bold text-slate-800 uppercase">
                      {uploadFile ? uploadFile.name : "Click to select video file for ingestion"}
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {uploadFile
                        ? `Size: ${(uploadFile.size / (1024 * 1024)).toFixed(2)} MB • Ready for AI pipeline`
                        : "Supports MP4, AVI, MOV, MKV up to 150MB"}
                    </span>
                  </label>
                  {uploadFile && !isWorking && (
                    <button
                      type="button"
                      onClick={() => {
                        setUploadFile(null);
                        resetJobState();
                      }}
                      className="mt-2 text-[11px] text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                    >
                      Clear Selection
                    </button>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-bold text-slate-900">Footage Archive:</span>
                    <span>videos/{selectedCamera}.mp4</span>
                  </div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold uppercase">
                    Archive Available
                  </span>
                </div>
              )}

              {/* Dark Channel Prior Dehazing Option */}
              <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <input
                  type="checkbox"
                  id="enable-dehaze"
                  checked={enableDehaze}
                  onChange={(e) => setEnableDehaze(e.target.checked)}
                  disabled={isWorking}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
                <label htmlFor="enable-dehaze" className="text-xs text-slate-800 cursor-pointer">
                  <span className="font-bold">Dark Channel Prior (DCP) Dehazing</span>
                  <p className="text-[11px] text-slate-500 font-sans mt-0.5">
                    Preprocesses frames with He et al. transmission map estimation to recover contrast from smog, fog, or nighttime CCTV glare before feeding to YOLOv8.
                  </p>
                </label>
              </div>

              {/* Real-time Job Progress & Execution Telemetry */}
              {jobStatus !== "IDLE" && (
                <div className="rounded-md border border-slate-300 bg-slate-50 p-3.5 space-y-3">
                  <div className="flex items-center justify-between text-xs font-mono font-bold">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                          jobStatus === "COMPLETED"
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : jobStatus === "FAILED"
                            ? "bg-rose-100 text-rose-800 border border-rose-300"
                            : "bg-blue-100 text-blue-800 border border-blue-300 animate-pulse"
                        }`}
                      >
                        {jobStatus}
                      </span>
                      {jobId && <span className="text-slate-500 text-[11px]">{jobId}</span>}
                    </div>
                    <span className="text-slate-900">{progress}%</span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 border border-slate-300">
                    <motion.div
                      className={`h-full ${jobStatus === "FAILED" ? "bg-rose-600" : "bg-slate-900"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${progress}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>

                  <div className="text-[11px] text-slate-700">{statusText}</div>

                  {/* Real Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-slate-200 text-[11px]">
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block text-[9px] uppercase font-bold">Frames</span>
                      <span className="font-bold text-slate-900">
                        {framesProcessed} {totalFrames > 0 ? `/ ${totalFrames}` : ""}
                      </span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block text-[9px] uppercase font-bold">Detections</span>
                      <span className="font-bold text-slate-900">{detectionsCount}</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block text-[9px] uppercase font-bold">ByteTrack Tracks</span>
                      <span className="font-bold text-slate-900">{tracksCount}</span>
                    </div>
                    <div className="bg-white p-2 rounded border border-slate-200">
                      <span className="text-slate-500 block text-[9px] uppercase font-bold">Throughput</span>
                      <span className="font-bold text-slate-900">
                        {executedFps !== null ? `${executedFps} FPS` : isWorking ? "Calculating..." : "-"}
                      </span>
                    </div>
                  </div>

                  {/* Recognized Plates */}
                  {recognizedPlates.length > 0 && (
                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      <span className="text-slate-600 text-[10px] font-bold uppercase block">
                        Recognized Vehicle Plates ({recognizedPlates.length}):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {recognizedPlates.map((plate) => (
                          <button
                            key={plate}
                            type="button"
                            onClick={() => setTargetPlate(plate)}
                            className={`px-2 py-0.5 rounded text-xs font-bold border transition-colors cursor-pointer ${
                              targetPlate === plate
                                ? "bg-slate-900 text-white border-slate-900"
                                : "bg-white text-slate-800 border-slate-300 hover:bg-slate-100"
                            }`}
                          >
                            {plate}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Error Notification */}
                  {errorMessage && (
                    <div className="rounded border border-rose-300 bg-rose-50 p-2.5 text-xs text-rose-800 flex items-start gap-2">
                      <span className="font-bold">⚠</span>
                      <span>{errorMessage}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="mt-6 flex items-center justify-between border-t border-slate-300 pt-4">
              <div>
                {jobStatus === "COMPLETED" && (
                  <span className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                    <span>✔</span> Pipeline execution finished
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isWorking}
                  className="rounded-md border border-slate-300 bg-white px-4 py-2 text-xs font-bold uppercase text-slate-700 hover:bg-slate-50 shadow-xs transition-all cursor-pointer disabled:opacity-50"
                >
                  {jobStatus === "COMPLETED" ? "Close" : "Cancel"}
                </button>

                {jobStatus === "COMPLETED" ? (
                  <button
                    type="button"
                    onClick={() => handleApplyPlateToInvestigation(targetPlate || recognizedPlates[0] || "")}
                    className="neo-btn px-5 py-2 text-xs font-bold uppercase cursor-pointer flex items-center gap-2"
                  >
                    <span>🔍</span>
                    <span>
                      {targetPlate || recognizedPlates[0]
                        ? `Investigate ${targetPlate || recognizedPlates[0]}`
                        : "View Results in Dashboard"}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isWorking}
                    onClick={handleStartIngestion}
                    className="neo-btn px-5 py-2 text-xs font-bold uppercase cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>⚙</span>
                    <span>{isWorking ? "AI Processing In Progress..." : "Start AI Processing Pipeline"}</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
