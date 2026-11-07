"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  uploadVideoFile,
  ingestCameraFootage,
  getIngestionJobStatus,
  uploadVideoToStorage,
  getVideoUploads,
  deleteVideoUpload,
  processVideoUpload,
  getVideoDetections,
  VideoUploadRecord,
  DetectionRecord,
  getApiBaseUrl,
} from "@/lib/api";

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

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

export function VideoIngestionModal({ isOpen, onClose, onTargetDetected }: VideoIngestionModalProps) {
  const [mode, setMode] = useState<"CORRIDOR" | "UPLOAD">("UPLOAD");
  const [selectedCamera, setSelectedCamera] = useState("CAM-01");
  const [enableDehaze, setEnableDehaze] = useState(false);
  const [targetPlate, setTargetPlate] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Storage Pipeline State (Phase A3)
  const [uploadStatus, setUploadStatus] = useState<"IDLE" | "UPLOADING" | "UPLOADED" | "FAILED">("IDLE");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadLoadedBytes, setUploadLoadedBytes] = useState(0);
  const [uploadTotalBytes, setUploadTotalBytes] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmedUpload, setConfirmedUpload] = useState<VideoUploadRecord | null>(null);
  const [uploadHistory, setUploadHistory] = useState<VideoUploadRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null);

  // Real persisted detections state (Phase A4)
  const [persistedDetections, setPersistedDetections] = useState<DetectionRecord[]>([]);
  const [isLoadingDetections, setIsLoadingDetections] = useState(false);
  const [activeDetectionsVideoId, setActiveDetectionsVideoId] = useState<string | null>(null);

  // AI Pipeline Execution Tracking State
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<"IDLE" | "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED">("IDLE");
  const [aiProgress, setAiProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Telemetry metrics from real AI execution
  const [framesProcessed, setFramesProcessed] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [detectionsCount, setDetectionsCount] = useState(0);
  const [tracksCount, setTracksCount] = useState(0);
  const [recognizedPlates, setRecognizedPlates] = useState<string[]>([]);
  const [executedFps, setExecutedFps] = useState<number | null>(null);

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch upload history from backend
  const fetchUploadHistory = useCallback(async () => {
    setIsLoadingHistory(true);
    setHistoryError(null);
    try {
      const page = await getVideoUploads(0, 10);
      setUploadHistory(page.content || []);
    } catch (err: any) {
      setHistoryError(err.message || "Failed to load upload history from backend.");
    } finally {
      setIsLoadingHistory(false);
    }
  }, []);

  const loadDetectionsForVideo = useCallback(async (uploadId: string) => {
    setIsLoadingDetections(true);
    setActiveDetectionsVideoId(uploadId);
    try {
      const page = await getVideoDetections(uploadId, 0, 50);
      setPersistedDetections(page.content || []);
    } catch (err: any) {
      console.warn("Failed to load video detections:", err);
    } finally {
      setIsLoadingDetections(false);
    }
  }, []);

  // Reset state on open/close
  useEffect(() => {
    if (isOpen) {
      fetchUploadHistory();
      resetJobState();
    }
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [isOpen, fetchUploadHistory]);

  const resetJobState = () => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setJobId(null);
    setJobStatus("IDLE");
    setAiProgress(0);
    setStatusText("");
    setErrorMessage(null);
    setFramesProcessed(0);
    setTotalFrames(0);
    setDetectionsCount(0);
    setTracksCount(0);
    setRecognizedPlates([]);
    setExecutedFps(null);
  };

  // Phase A3: Real Video Upload to Durable Storage
  const handleUploadToStorage = async () => {
    if (!uploadFile) {
      setUploadError("Please select a valid video file to upload (.mp4, .avi, .mov, .mkv).");
      return;
    }

    setUploadStatus("UPLOADING");
    setUploadError(null);
    setUploadProgress(0);
    setUploadLoadedBytes(0);
    setUploadTotalBytes(uploadFile.size);
    setConfirmedUpload(null);

    try {
      const record = await uploadVideoToStorage(
        uploadFile,
        selectedCamera,
        (percent, loaded, total) => {
          setUploadProgress(percent);
          setUploadLoadedBytes(loaded);
          setUploadTotalBytes(total);
        }
      );
      setConfirmedUpload(record);
      setUploadStatus("UPLOADED");
      setUploadProgress(100);
      // Refresh persistent history list
      fetchUploadHistory();
    } catch (err: any) {
      setUploadStatus("FAILED");
      setUploadError(err.message || "Video upload failed. Check connection to backend storage.");
    }
  };

  // Delete video from storage
  const handleDeleteUpload = async (id: string) => {
    if (!confirm("Are you sure you want to permanently delete this video from storage?")) {
      return;
    }
    try {
      await deleteVideoUpload(id);
      if (confirmedUpload?.id === id) {
        setConfirmedUpload(null);
        setUploadStatus("IDLE");
      }
      if (previewVideoUrl?.includes(id)) {
        setPreviewVideoUrl(null);
      }
      await fetchUploadHistory();
    } catch (err: any) {
      alert("Delete failed: " + err.message);
    }
  };

  // Start polling AI job status
  const startAiPolling = (activeJobId: string, uploadIdForDetections?: string) => {
    pollIntervalRef.current = setInterval(async () => {
      try {
        const statusRes = await getIngestionJobStatus(activeJobId);
        setJobStatus(statusRes.status);
        setAiProgress(statusRes.progress || 0);

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
          setAiProgress(100);
          setStatusText("AI Processing Pipeline execution completed successfully!");
          fetchUploadHistory();
          if (uploadIdForDetections) {
            loadDetectionsForVideo(uploadIdForDetections);
          }
        } else if (statusRes.status === "FAILED") {
          if (pollIntervalRef.current) {
            clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
          setStatusText("Job failed.");
          setErrorMessage(statusRes.details?.error || "AI pipeline encountered an error during frame processing.");
          fetchUploadHistory();
        }
      } catch (pollErr: any) {
        console.warn("Job status poll error:", pollErr);
      }
    }, 600);
  };

  // Trigger Corridor Ingestion (Pre-stored corridor files)
  const handleStartCorridorIngestion = async () => {
    resetJobState();
    setErrorMessage(null);
    setJobStatus("QUEUED");
    setStatusText(`Requesting corridor AI pipeline execution on ${selectedCamera} footage...`);

    try {
      const res = await ingestCameraFootage(selectedCamera, enableDehaze);
      setJobId(res.jobId);
      setStatusText(`Job ${res.jobId} registered. Ingestion pipeline initializing...`);
      startAiPolling(res.jobId);
    } catch (err: any) {
      setJobStatus("FAILED");
      setErrorMessage(err.message || "Failed to start video ingestion job.");
    }
  };

  // Trigger AI pipeline on uploaded custom video
  const handleStartUploadedAiPipeline = async (targetUploadId?: string) => {
    const uploadIdToRun = targetUploadId || confirmedUpload?.id;
    if (!uploadIdToRun) {
      setErrorMessage("Please select or upload a video file first.");
      return;
    }
    resetJobState();
    setErrorMessage(null);
    setJobStatus("QUEUED");
    setStatusText(`Triggering AI inference pipeline for video upload ${uploadIdToRun}...`);

    try {
      const res = await processVideoUpload(uploadIdToRun, { enableDehaze, frameStride: 5 });
      setJobId(res.job_id);
      setStatusText(`Job ${res.job_id} registered. Ingestion pipeline running YOLOv8 vehicle detector & plate OCR...`);
      startAiPolling(res.job_id, uploadIdToRun);
    } catch (err: any) {
      setJobStatus("FAILED");
      setErrorMessage(err.message || "Failed to start AI processing pipeline.");
    }
  };

  const handleApplyPlateToInvestigation = (plateToUse: string) => {
    const videoUrls: Record<string, string> = {};
    if (mode === "UPLOAD" && confirmedUpload) {
      const baseUrl = getApiBaseUrl();
      videoUrls[selectedCamera] = `${baseUrl}/api/videos/${confirmedUpload.id}/stream`;
    } else if (mode === "UPLOAD" && uploadFile) {
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

  const isUploading = uploadStatus === "UPLOADING";
  const isAiWorking = jobStatus === "QUEUED" || jobStatus === "PROCESSING";
  const isBusy = isUploading || isAiWorking;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-xs">
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            className="relative w-full max-w-3xl border border-slate-300 bg-white p-6 shadow-2xl rounded-xl max-h-[92vh] overflow-y-auto"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-300 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-white font-bold text-lg">
                  📹
                </div>
                <div>
                  <h2 className="text-base font-bold text-slate-950 tracking-tight uppercase">
                    CCTV Video Ingestion & Storage Pipeline
                  </h2>
                  <p className="text-xs text-slate-700 font-mono font-semibold tracking-wider">
                    DURABLE STORAGE • POSTGRESQL METADATA • STREAMING • PIPELINE
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isBusy}
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
                  if (!isBusy) setMode("UPLOAD");
                }}
                disabled={isBusy}
                className={`flex-1 rounded-md py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                  mode === "UPLOAD" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                📁 Video Upload & Storage Pipeline
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isBusy) setMode("CORRIDOR");
                }}
                disabled={isBusy}
                className={`flex-1 rounded-md py-1.5 text-xs font-mono font-bold transition-all cursor-pointer ${
                  mode === "CORRIDOR" ? "bg-white text-slate-950 shadow-xs" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                🎥 Recorded Corridor Camera Feeds
              </button>
            </div>

            {/* Ingestion Parameters Form */}
            <div className="mt-4 space-y-4 font-mono">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {/* Camera Node Selection */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-slate-800 mb-1">
                    Associate Camera Node
                  </label>
                  <select
                    value={selectedCamera}
                    onChange={(e) => {
                      setSelectedCamera(e.target.value);
                      resetJobState();
                    }}
                    disabled={isBusy}
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
                    Target Plate Filter (Optional)
                  </label>
                  <input
                    type="text"
                    value={targetPlate}
                    onChange={(e) => setTargetPlate(e.target.value.toUpperCase())}
                    placeholder="e.g. MH12DE1433"
                    disabled={isBusy}
                    className="w-full rounded-md border border-slate-300 bg-white p-2 text-xs font-mono font-bold text-slate-950 focus:outline-none focus:border-slate-900 uppercase"
                  />
                </div>
              </div>

              {/* Mode-specific Input & Storage Workflow */}
              {mode === "UPLOAD" ? (
                <div className="space-y-3">
                  {/* Dropzone / File Picker */}
                  <div className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                    <input
                      type="file"
                      id="video-upload-file"
                      accept=".mp4,.avi,.mov,.mkv"
                      disabled={isBusy}
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setUploadFile(e.target.files[0]);
                          setUploadStatus("IDLE");
                          setUploadError(null);
                          setConfirmedUpload(null);
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
                        {uploadFile ? uploadFile.name : "Click to select video file for durable storage"}
                      </span>
                      <span className="text-[11px] text-slate-500">
                        {uploadFile
                          ? `Size: ${formatBytes(uploadFile.size)} • Format: ${uploadFile.type || "binary stream"}`
                          : "Supports MP4, AVI, MOV, MKV up to 500 MB (Magic-byte verified)"}
                      </span>
                    </label>
                    {uploadFile && !isBusy && (
                      <div className="mt-3 flex items-center justify-center gap-3">
                        <button
                          type="button"
                          onClick={() => {
                            setUploadFile(null);
                            setUploadStatus("IDLE");
                            setConfirmedUpload(null);
                            setUploadError(null);
                            resetJobState();
                          }}
                          className="text-[11px] text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                        >
                          Clear Selection
                        </button>
                        {uploadStatus !== "UPLOADED" && (
                          <button
                            type="button"
                            onClick={handleUploadToStorage}
                            className="rounded bg-slate-900 px-3 py-1 text-[11px] font-bold text-white hover:bg-slate-800 cursor-pointer shadow-xs"
                          >
                            Upload to Storage Pipeline
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Real Byte Upload Progress Indicator */}
                  {isUploading && (
                    <div className="rounded-md border border-blue-200 bg-blue-50/50 p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <span className="text-blue-900 flex items-center gap-1.5">
                          <span className="animate-spin">⏳</span> Uploading to Durable Storage...
                        </span>
                        <span className="text-blue-950 font-mono">{uploadProgress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-blue-200">
                        <motion.div
                          className="h-full bg-blue-700"
                          initial={{ width: 0 }}
                          animate={{ width: `${uploadProgress}%` }}
                          transition={{ duration: 0.1 }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-blue-700 font-mono">
                        <span>{formatBytes(uploadLoadedBytes)} / {formatBytes(uploadTotalBytes)}</span>
                        <span>Streaming directly to Spring Boot storage service</span>
                      </div>
                    </div>
                  )}

                  {/* Upload Failure Banner + Retry Action */}
                  {uploadStatus === "FAILED" && (
                    <div className="rounded-md border border-rose-300 bg-rose-50 p-3 space-y-2">
                      <div className="flex items-start gap-2 text-xs text-rose-900">
                        <span className="font-bold text-rose-600">⚠</span>
                        <div className="flex-1">
                          <span className="font-bold">Upload Failed: </span>
                          <span>{uploadError}</span>
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={handleUploadToStorage}
                          className="rounded bg-rose-700 px-3 py-1 text-[11px] font-bold text-white hover:bg-rose-800 cursor-pointer"
                        >
                          Retry Upload
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Confirmed Upload Metadata Card (Phase A3) */}
                  {confirmedUpload && (
                    <div className="rounded-md border border-emerald-300 bg-emerald-50/60 p-3 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white text-[11px] font-bold">
                            ✓
                          </span>
                          <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                            Video Durably Persisted
                          </span>
                        </div>
                        <span className="rounded bg-emerald-200 px-2 py-0.5 text-[10px] font-bold text-emerald-900 uppercase">
                          {confirmedUpload.status} • {confirmedUpload.storageProvider}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
                        <div className="bg-white p-2 rounded border border-emerald-200">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Storage Key</span>
                          <span className="font-bold text-slate-900 truncate block" title={confirmedUpload.storageKey}>
                            {confirmedUpload.storageKey.split("/").pop()}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded border border-emerald-200">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Size</span>
                          <span className="font-bold text-slate-900">{formatBytes(confirmedUpload.fileSize)}</span>
                        </div>
                        <div className="bg-white p-2 rounded border border-emerald-200">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">SHA-256 Checksum</span>
                          <span className="font-bold text-slate-900 truncate block" title={confirmedUpload.sha256Hash || "N/A"}>
                            {confirmedUpload.sha256Hash ? confirmedUpload.sha256Hash.substring(0, 12) + "..." : "Computed"}
                          </span>
                        </div>
                        <div className="bg-white p-2 rounded border border-emerald-200">
                          <span className="text-slate-500 block text-[9px] uppercase font-bold">Assigned Node</span>
                          <span className="font-bold text-slate-900">{confirmedUpload.cameraId || selectedCamera}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-emerald-200/60">
                        <button
                          type="button"
                          onClick={() => {
                            const baseUrl = getApiBaseUrl();
                            setPreviewVideoUrl(`${baseUrl}/api/videos/${confirmedUpload.id}/stream`);
                          }}
                          className="text-[11px] font-bold text-emerald-800 hover:text-emerald-950 underline cursor-pointer"
                        >
                          ▶ Stream / Preview Video
                        </button>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDeleteUpload(confirmedUpload.id)}
                            className="text-[11px] text-rose-600 hover:text-rose-800 font-bold cursor-pointer"
                          >
                            Delete Video
                          </button>
                          <button
                            type="button"
                            onClick={() => handleStartUploadedAiPipeline()}
                            disabled={isAiWorking}
                            className="rounded bg-slate-900 px-3 py-1 text-[11px] font-bold text-white hover:bg-slate-800 cursor-pointer disabled:opacity-50"
                          >
                            Run AI Detection on this Video →
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Persistent Storage Archive / History Table */}
                  <div className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-800">
                        Stored Video Archive ({uploadHistory.length})
                      </span>
                      <button
                        type="button"
                        onClick={fetchUploadHistory}
                        disabled={isLoadingHistory}
                        className="text-[11px] text-slate-600 hover:text-slate-900 font-bold cursor-pointer"
                      >
                        {isLoadingHistory ? "Refreshing..." : "↻ Refresh"}
                      </button>
                    </div>

                    {historyError && (
                      <div className="text-[11px] text-rose-600 bg-rose-50 p-2 rounded border border-rose-200">
                        {historyError}
                      </div>
                    )}

                    {uploadHistory.length === 0 && !isLoadingHistory && (
                      <div className="text-[11px] text-slate-500 py-3 text-center border border-dashed border-slate-200 rounded">
                        No videos stored in persistent database yet. Upload a CCTV clip above.
                      </div>
                    )}

                    {uploadHistory.length > 0 && (
                      <div className="divide-y divide-slate-100 max-h-48 overflow-y-auto">
                        {uploadHistory.map((video) => (
                          <div
                            key={video.id}
                            className="py-2 flex items-center justify-between text-[11px] font-mono hover:bg-slate-50 px-1 rounded transition-colors"
                          >
                            <div className="flex items-center gap-2.5 overflow-hidden">
                              <span className="text-slate-400">📹</span>
                              <div className="truncate">
                                <span className="font-bold text-slate-900 block truncate" title={video.originalFilename}>
                                  {video.originalFilename}
                                </span>
                                <span className="text-slate-500 text-[10px]">
                                  {formatBytes(video.fileSize)} • {video.cameraId || "Unassigned"} •{" "}
                                  {new Date(video.createdAt).toLocaleString()}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0 ml-2">
                              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 uppercase">
                                {video.status}
                              </span>
                              <button
                                type="button"
                                onClick={() => handleStartUploadedAiPipeline(video.id)}
                                disabled={isBusy}
                                className="text-slate-900 hover:text-black font-bold cursor-pointer text-[10px]"
                              >
                                {video.status === "COMPLETED" ? "Re-Run AI" : "Run AI"}
                              </button>
                              <button
                                type="button"
                                onClick={() => loadDetectionsForVideo(video.id)}
                                className="text-emerald-700 hover:text-emerald-900 font-bold cursor-pointer text-[10px]"
                              >
                                Detections ({video.detectionsCount ?? 0})
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const baseUrl = getApiBaseUrl();
                                  setPreviewVideoUrl(`${baseUrl}/api/videos/${video.id}/stream`);
                                }}
                                className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer text-[10px]"
                              >
                                Play
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUpload(video.id)}
                                className="text-rose-600 hover:text-rose-800 font-bold cursor-pointer text-[10px]"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Persisted Detections Table (Phase A4) */}
                  {activeDetectionsVideoId && (
                    <div className="rounded-md border border-slate-300 bg-slate-50 p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                          <span>🎯 Persisted Detections ({persistedDetections.length})</span>
                          <span className="text-[10px] text-slate-500 font-normal">Video: {activeDetectionsVideoId.substring(0, 8)}...</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveDetectionsVideoId(null)}
                          className="text-[11px] text-slate-500 hover:text-slate-800 font-bold cursor-pointer"
                        >
                          ✕ Close Detections
                        </button>
                      </div>

                      {isLoadingDetections && (
                        <div className="text-[11px] text-slate-500 py-2 text-center">
                          Loading persisted detections from PostgreSQL...
                        </div>
                      )}

                      {!isLoadingDetections && persistedDetections.length === 0 && (
                        <div className="text-[11px] text-slate-500 py-3 text-center border border-dashed border-slate-300 rounded bg-white">
                          No detections recorded for this video yet. Run the AI pipeline above.
                        </div>
                      )}

                      {!isLoadingDetections && persistedDetections.length > 0 && (
                        <div className="max-h-56 overflow-y-auto border border-slate-200 rounded bg-white">
                          <table className="w-full text-left text-[11px] font-mono">
                            <thead className="bg-slate-100 text-[10px] uppercase text-slate-700 sticky top-0">
                              <tr>
                                <th className="p-1.5">Frame</th>
                                <th className="p-1.5">Class / Conf</th>
                                <th className="p-1.5">Bounding Box</th>
                                <th className="p-1.5">Plate (OCR)</th>
                                <th className="p-1.5">Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {persistedDetections.map((det) => (
                                <tr key={det.id} className="hover:bg-slate-50">
                                  <td className="p-1.5 font-bold text-slate-800">#{det.frameNumber ?? det.trackId}</td>
                                  <td className="p-1.5">
                                    <span className="font-bold text-slate-900">{det.vehicleClass}</span>
                                    <span className="text-slate-500 text-[10px] ml-1">
                                      ({(det.detectionConfidence * 100).toFixed(1)}%)
                                    </span>
                                  </td>
                                  <td className="p-1.5 text-slate-600 truncate max-w-[120px]" title={det.bbox || "N/A"}>
                                    {det.bbox || "N/A"}
                                  </td>
                                  <td className="p-1.5">
                                    {det.plateTextNormalized ? (
                                      <span className="rounded bg-slate-900 px-1.5 py-0.5 text-white font-bold text-[10px]">
                                        {det.plateTextNormalized}
                                      </span>
                                    ) : (
                                      <span className="text-slate-400 italic text-[10px]">No plate</span>
                                    )}
                                  </td>
                                  <td className="p-1.5">
                                    {det.plateTextNormalized && (
                                      <button
                                        type="button"
                                        onClick={() => handleApplyPlateToInvestigation(det.plateTextNormalized!)}
                                        className="text-blue-600 hover:text-blue-800 font-bold cursor-pointer text-[10px]"
                                      >
                                        Investigate →
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                /* Corridor Archive Mode */
                <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                    <span className="font-bold text-slate-900">Corridor Footage Archive:</span>
                    <span>videos/{selectedCamera}.mp4</span>
                  </div>
                  <span className="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold uppercase">
                    Ready for Ingestion
                  </span>
                </div>
              )}

              {/* Video Streaming Preview Player Modal / Embed */}
              {previewVideoUrl && (
                <div className="rounded-md border border-slate-300 bg-black p-3 space-y-2">
                  <div className="flex items-center justify-between text-white text-xs">
                    <span className="font-bold">Streaming Media Player (/api/videos/.../stream)</span>
                    <button
                      type="button"
                      onClick={() => setPreviewVideoUrl(null)}
                      className="text-slate-400 hover:text-white font-bold cursor-pointer"
                    >
                      ✕ Close Stream
                    </button>
                  </div>
                  <video
                    controls
                    autoPlay
                    src={previewVideoUrl}
                    className="w-full max-h-60 rounded bg-black"
                  >
                    Your browser does not support HTML5 video streaming.
                  </video>
                </div>
              )}

              {/* Dark Channel Prior Dehazing Option */}
              <div className="flex items-start gap-2.5 rounded-md border border-slate-200 bg-slate-50 p-2.5">
                <input
                  type="checkbox"
                  id="enable-dehaze"
                  checked={enableDehaze}
                  onChange={(e) => setEnableDehaze(e.target.checked)}
                  disabled={isBusy}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer"
                />
                <label htmlFor="enable-dehaze" className="text-xs text-slate-800 cursor-pointer">
                  <span className="font-bold">Dark Channel Prior (DCP) Dehazing</span>
                  <p className="text-[11px] text-slate-500 font-sans mt-0.5">
                    Preprocesses frames with He et al. transmission map estimation to recover contrast from smog, fog, or nighttime CCTV glare before feeding to YOLOv8.
                  </p>
                </label>
              </div>

              {/* Real-time AI Processing Progress & Execution Telemetry */}
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
                    <span className="text-slate-900">{aiProgress}%</span>
                  </div>

                  {/* Progress bar */}
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 border border-slate-300">
                    <motion.div
                      className={`h-full ${jobStatus === "FAILED" ? "bg-rose-600" : "bg-slate-900"}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${aiProgress}%` }}
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
                        {executedFps !== null ? `${executedFps} FPS` : isAiWorking ? "Calculating..." : "-"}
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
                    <span>✔</span> AI Pipeline execution completed
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isBusy}
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
                ) : mode === "CORRIDOR" ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={handleStartCorridorIngestion}
                    className="neo-btn px-5 py-2 text-xs font-bold uppercase cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>⚙</span>
                    <span>{isAiWorking ? "AI Processing In Progress..." : "Run Corridor AI Pipeline"}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={isBusy || !uploadFile}
                    onClick={uploadStatus === "UPLOADED" ? () => handleStartUploadedAiPipeline() : handleUploadToStorage}
                    className="neo-btn px-5 py-2 text-xs font-bold uppercase cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    <span>{uploadStatus === "UPLOADED" ? "⚙" : "📤"}</span>
                    <span>
                      {isUploading
                        ? `Uploading (${uploadProgress}%)...`
                        : uploadStatus === "UPLOADED"
                        ? "Run AI Detection on Video"
                        : "Upload Video to Storage"}
                    </span>
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
