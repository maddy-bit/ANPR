"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  evidenceImageUrl,
  getApiBaseUrl,
  getReadiness,
  getCameras,
  getVideoDetections,
  getVideoUploads,
  getVehicleTrajectory,
  listCameraSources,
  type CameraDto,
  type CameraSourceDto,
  type DetectionRecord,
  type TrajectoryResponseDto,
  type VideoUploadRecord,
  type ReadinessResponse,
} from "@/lib/api";
import { InteractiveTrajectoryPlayer } from "./InteractiveTrajectoryPlayer";
import { VideoIngestionModal } from "./VideoIngestionModal";

const InvestigationMap = dynamic(
  () => import("./InvestigationMap").then((module) => module.InvestigationMap),
  { ssr: false, loading: () => <div className="h-[560px] animate-pulse rounded-xl bg-slate-900" /> }
);

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value?: string | null): string {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Timestamp unavailable" : date.toLocaleString();
}

function isCompletePlate(value: string | null | undefined): boolean {
  const plate = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^(?:[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}|\d{2}BH\d{4}[A-Z]{1,2})$/.test(plate);
}

export function CityTrafficCommandCenter() {
  const [cameras, setCameras] = useState<CameraDto[]>([]);
  const [sources, setSources] = useState<CameraSourceDto[]>([]);
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [uploads, setUploads] = useState<VideoUploadRecord[]>([]);
  const [selectedUploadId, setSelectedUploadId] = useState<string | null>(null);
  const [detections, setDetections] = useState<DetectionRecord[]>([]);
  const [detectionsVideoId, setDetectionsVideoId] = useState<string | null>(null);
  const [selectedDetectionId, setSelectedDetectionId] = useState<number | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [trajectory, setTrajectory] = useState<TrajectoryResponseDto | null>(null);
  const [selectedTrajectoryIndex, setSelectedTrajectoryIndex] = useState<number | null>(null);
  const [plateInput, setPlateInput] = useState("");
  const [cameraFilter, setCameraFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isIngestionOpen, setIsIngestionOpen] = useState(false);
  const [replayToken, setReplayToken] = useState(0);

  const loadWorkspace = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [cameraResult, sourceResult, uploadResult, readinessResult] = await Promise.allSettled([
      getCameras({ mode: "all" }),
      listCameraSources(),
      getVideoUploads(0, 20),
      getReadiness(),
    ]);
    if (cameraResult.status === "fulfilled") setCameras(cameraResult.value);
    else setLoadError(cameraResult.reason instanceof Error ? cameraResult.reason.message : "Camera inventory unavailable");
    if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
    setReadiness(readinessResult.status === "fulfilled" ? readinessResult.value : null);
    if (uploadResult.status === "fulfilled") {
      const records = uploadResult.value.content || [];
      setUploads(records);
      setSelectedUploadId((current) => current && records.some((record) => record.id === current)
        ? current
        : records.find((record) => record.status === "COMPLETED")?.id || records[0]?.id || null);
    } else if (cameraResult.status === "fulfilled") {
      setLoadError(uploadResult.reason instanceof Error ? uploadResult.reason.message : "Recorded footage archive unavailable");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspace();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedUploadId) return;
    getVideoDetections(selectedUploadId, 0, 50)
      .then((page) => {
        if (cancelled) return;
        const rows = page.content || [];
        setDetections(rows);
        setDetectionsVideoId(selectedUploadId);
        setSelectedDetectionId((current) => current && rows.some((row) => row.id === current) ? current : rows[0]?.id ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setDetections([]);
          setDetectionsVideoId(selectedUploadId);
          setSelectedDetectionId(null);
        }
      });
    return () => { cancelled = true; };
  }, [selectedUploadId]);

  const selectedUpload = useMemo(
    () => uploads.find((upload) => upload.id === selectedUploadId) || null,
    [uploads, selectedUploadId]
  );
  const visibleDetections = useMemo(
    () => detectionsVideoId === selectedUploadId ? detections : [],
    [detectionsVideoId, selectedUploadId, detections]
  );
  const selectedDetection = useMemo(
    () => visibleDetections.find((detection) => detection.id === selectedDetectionId) || null,
    [visibleDetections, selectedDetectionId]
  );
  const effectiveSelectedCameraId = selectedCameraId || selectedUpload?.cameraId || null;
  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === effectiveSelectedCameraId) || null,
    [cameras, effectiveSelectedCameraId]
  );

  const cameraCounts = useMemo(() => ({
    total: cameras.length,
    liveDeclared: cameras.filter((camera) => camera.liveVideo).length,
    snapshots: cameras.filter((camera) => camera.liveSnapshot).length,
    archives: cameras.filter((camera) => camera.archiveAvailable).length,
  }), [cameras]);

  const filteredCameras = useMemo(() => {
    const needle = cameraFilter.trim().toLowerCase();
    if (!needle) return cameras;
    return cameras.filter((camera) =>
      [camera.id, camera.name, camera.place, camera.region, camera.sourceName]
        .filter(Boolean).join(" ").toLowerCase().includes(needle)
    );
  }, [cameras, cameraFilter]);

  const handleCameraSelect = useCallback((camera: CameraDto) => {
    setSelectedCameraId(camera.id);
    const matchingUpload = uploads.find((upload) => upload.cameraId === camera.id && upload.status === "COMPLETED");
    setSelectedUploadId(matchingUpload?.id ?? null);
  }, [uploads]);

  const handleTrajectorySelect = useCallback((index: number) => {
    setSelectedTrajectoryIndex(index);
    const point = trajectory?.points[index];
    if (!point) return;
    setSelectedCameraId(point.cameraId);
    const matchingUpload = uploads.find((upload) => upload.cameraId === point.cameraId && upload.status === "COMPLETED");
    setSelectedUploadId(matchingUpload?.id ?? null);
  }, [trajectory, uploads]);

  const handleSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const plate = plateInput.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!isCompletePlate(plate)) {
      setSearchError("Enter a complete registration number. Partial OCR text is not a valid vehicle identity.");
      return;
    }
    setSearching(true);
    setSearchError(null);
    setTrajectory(null);
    setSelectedTrajectoryIndex(null);
    try {
      const result = await getVehicleTrajectory(plate);
      setTrajectory(result);
      if (result.points.length > 0) {
        setSelectedTrajectoryIndex(0);
        setSelectedCameraId(result.points[0].cameraId);
        const firstUpload = uploads.find((upload) => upload.cameraId === result.points[0].cameraId && upload.status === "COMPLETED");
        setSelectedUploadId(firstUpload?.id ?? null);
      } else {
        setSearchError("No persisted camera sightings match this registration.");
      }
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Vehicle trajectory lookup failed");
    } finally {
      setSearching(false);
    }
  };

  const streamUrl = selectedUpload
    ? `${getApiBaseUrl()}/api/videos/${encodeURIComponent(selectedUpload.id)}/stream`
    : null;
  const evidenceUrl = evidenceImageUrl(selectedDetection?.imagePath);
  const totalTracks = new Set(visibleDetections.map((detection) => detection.trackId).filter((value) => value != null)).size;
  const selectedSource = selectedCamera?.sourceName || selectedCamera?.sourceType || "No source selected";

  return (
    <div className="min-h-[calc(100vh-64px)] space-y-4 p-3 sm:p-4 xl:p-5">
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/80 px-4 py-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-cyan-400">City AI Traffic / Operations</p>
          <h1 className="mt-1 text-lg font-semibold tracking-wide text-slate-100">City Traffic Command Center</h1>
          <p className="mt-0.5 text-xs text-slate-400">Camera inventory · Recorded video intelligence · Vehicle trajectory reconstruction</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
            readiness?.status === "ready"
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-200"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${readiness?.status === "ready" ? "bg-emerald-400" : "bg-amber-400"}`} />
            {readiness?.status === "ready" ? "Backend ready · DB + Redis" : "Backend unavailable"}
          </span>
          <button type="button" onClick={() => setIsIngestionOpen(true)} className="rounded-md border border-cyan-400/50 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20">
            + Ingest footage
          </button>
          <button type="button" onClick={() => void loadWorkspace()} className="rounded-md border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-cyan-500/60">
            Refresh
          </button>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Registered cameras", value: cameraCounts.total, note: "Imported inventory" },
          { label: "Live video declared", value: cameraCounts.liveDeclared, note: "Publisher metadata, unverified" },
          { label: "Snapshot sources", value: cameraCounts.snapshots, note: "Snapshot capability declared" },
          { label: "Recorded uploads", value: uploads.length, note: "Persisted video files" },
        ].map((item) => (
          <article key={item.label} className="rounded-lg border border-slate-800 bg-slate-900/75 p-3">
            <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">{item.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-100">{item.value.toLocaleString()}</p>
            <p className="mt-0.5 text-[10px] text-slate-500">{item.note}</p>
          </article>
        ))}
      </section>

      {loadError && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">{loadError}</div>
      )}

      <div className="grid items-start gap-3 2xl:grid-cols-[minmax(300px,0.82fr)_minmax(520px,1.65fr)_minmax(300px,0.82fr)] xl:grid-cols-[minmax(270px,0.8fr)_minmax(480px,1.5fr)_minmax(280px,0.82fr)]">
        <aside className="min-w-0 space-y-3">
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <div className="flex items-center justify-between border-b border-slate-800 px-3 py-2.5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">Camera footage</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">Recorded archive playback</p>
              </div>
              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-[9px] font-bold tracking-wide text-amber-300">ARCHIVE</span>
            </div>
            {selectedUpload && streamUrl ? (
              <>
                <div className="relative bg-black">
                  <video key={selectedUpload.id} controls playsInline muted className="aspect-video w-full bg-black object-contain" src={streamUrl}>
                    Your browser does not support this video format.
                  </video>
                  <span className="absolute left-2 top-2 rounded bg-black/80 px-2 py-1 text-[9px] font-mono text-cyan-300">{selectedUpload.cameraId || "UNASSIGNED CAMERA"}</span>
                </div>
                <div className="space-y-2 p-3">
                  <p className="truncate text-xs font-semibold text-slate-100" title={selectedUpload.originalFilename}>{selectedUpload.originalFilename}</p>
                  <div className="grid grid-cols-2 gap-2 text-[10px]">
                    <div><span className="block text-slate-500">File size</span><span className="text-slate-300">{formatBytes(selectedUpload.fileSize)}</span></div>
                    <div><span className="block text-slate-500">Processing</span><span className="text-slate-300">{selectedUpload.status}</span></div>
                    <div><span className="block text-slate-500">Uploaded</span><span className="text-slate-300">{formatDate(selectedUpload.createdAt)}</span></div>
                    <div><span className="block text-slate-500">Detections</span><span className="text-cyan-300">{selectedUpload.detectionsCount ?? visibleDetections.length}</span></div>
                  </div>
                  {selectedUpload.sha256Hash && <p className="truncate border-t border-slate-800 pt-2 font-mono text-[9px] text-slate-500" title={selectedUpload.sha256Hash}>SHA-256 {selectedUpload.sha256Hash}</p>}
                </div>
              </>
            ) : (
              <div className="flex aspect-video flex-col items-center justify-center gap-2 bg-black p-5 text-center">
                <span className="text-3xl text-slate-600">▣</span>
                <p className="text-xs font-semibold text-slate-300">No recorded footage selected</p>
                <p className="text-[10px] text-slate-500">Upload an authorized MP4/AVI/MOV/MKV file to run vehicle inference.</p>
                <button type="button" onClick={() => setIsIngestionOpen(true)} className="mt-1 rounded border border-cyan-500/50 px-3 py-1.5 text-[10px] font-semibold text-cyan-300">Upload recording</button>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">AI detections</h2>
              <span className="rounded bg-slate-900 px-2 py-1 text-[10px] font-mono text-cyan-300">{visibleDetections.length} events</span>
            </div>
            {selectedUploadId && detectionsVideoId !== selectedUploadId ? (
              <p className="py-5 text-center text-xs text-slate-500">Loading persisted detections…</p>
            ) : visibleDetections.length ? (
              <div className="mt-3 max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {visibleDetections.map((detection) => {
                  const active = selectedDetectionId === detection.id;
                  const completePlate = isCompletePlate(detection.plateTextNormalized);
                  return (
                    <button key={detection.id} type="button" onClick={() => setSelectedDetectionId(detection.id)} className={`flex w-full items-center gap-2 rounded-lg border p-2 text-left ${active ? "border-cyan-400/60 bg-cyan-400/10" : "border-slate-800 bg-slate-900/70 hover:border-slate-600"}`}>
                      {evidenceImageUrl(detection.imagePath) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={evidenceImageUrl(detection.imagePath) || undefined} alt="Vehicle evidence crop" className="h-12 w-16 rounded border border-slate-700 bg-black object-cover" />
                      ) : <span className="flex h-12 w-16 items-center justify-center rounded border border-slate-700 bg-black text-lg text-slate-600">▧</span>}
                      <span className="min-w-0 flex-1">
                        <span className="block text-[11px] font-semibold text-slate-200">{detection.vehicleClass || "Vehicle"} · Track {detection.trackId ?? "—"}</span>
                        <span className="mt-0.5 block text-[10px] text-slate-500">Frame {detection.frameNumber ?? "—"} · {Math.round(detection.detectionConfidence * 100)}% detection</span>
                        <span className={`mt-0.5 block truncate font-mono text-[10px] ${completePlate ? "text-emerald-300" : "text-amber-300"}`}>{detection.plateTextNormalized || "PLATE NOT READ"}{detection.plateTextNormalized && !completePlate ? " · partial OCR" : ""}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-slate-800 p-4 text-center text-[10px] text-slate-500">No persisted vehicle detections for this recording.</p>
            )}
            {selectedDetection && evidenceUrl && (
              <div className="mt-3 border-t border-slate-800 pt-3">
                <p className="mb-2 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-500">Selected evidence frame</p>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={evidenceUrl} alt="Selected vehicle evidence" className="max-h-44 w-full rounded-lg border border-slate-700 bg-black object-contain" />
                <p className="mt-1 text-[9px] text-slate-500">{formatDate(selectedDetection.timestamp)}</p>
              </div>
            )}
            <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-[10px] text-slate-500">
              <span>{totalTracks} per-video track IDs</span>
              <Link href="/evidence" className="font-semibold text-cyan-300 hover:text-cyan-200">Evidence vault →</Link>
            </div>
          </section>
        </aside>

        <main className="min-w-0 space-y-3">
          <section className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-3 py-2.5">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-100">Geospatial camera network</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">Imported camera locations and persisted vehicle sightings</p>
              </div>
              <div className="flex flex-wrap gap-2 text-[9px] text-slate-400">
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-400" /> Public</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-sky-400" /> Agency</span>
                <span className="inline-flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-amber-400" /> Sighting</span>
              </div>
            </div>
            <div className="p-2">
              <InvestigationMap cameras={cameras} points={trajectory?.points || []} selectedIndex={selectedTrajectoryIndex} onSelectPoint={handleTrajectorySelect} replayToken={replayToken} onSelectCamera={handleCameraSelect} />
            </div>
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">Vehicle trajectory</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">{trajectory ? `${trajectory.points.length} persisted checkpoints for ${trajectory.vehicle.plate}` : "Search a complete plate to reconstruct stored sightings"}</p>
              </div>
              {trajectory && trajectory.points.length > 1 && (
                <button type="button" onClick={() => setReplayToken((value) => value + 1)} className="rounded border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-[10px] font-semibold text-cyan-200">Replay route</button>
              )}
            </div>
            {trajectory && trajectory.points.length > 0 ? (
              <div className="mt-3 space-y-3">
                <InteractiveTrajectoryPlayer points={trajectory.points} selectedIndex={selectedTrajectoryIndex} onSelectPoint={handleTrajectorySelect} />
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {trajectory.points.map((point, index) => (
                    <button key={`${point.cameraId}-${point.timestamp}`} type="button" onClick={() => handleTrajectorySelect(index)} className={`min-w-[150px] rounded-lg border p-2 text-left ${selectedTrajectoryIndex === index ? "border-cyan-400/60 bg-cyan-400/10" : "border-slate-800 bg-slate-900/70"}`}>
                      <span className="block text-[10px] font-mono font-bold text-cyan-300">{point.cameraId}</span>
                      <span className="mt-1 block truncate text-[10px] text-slate-300">{point.cameraName}</span>
                      <span className="mt-1 block text-[9px] text-slate-500">{formatDate(point.timestamp)}</span>
                    </button>
                  ))}
                </div>
                {trajectory.warning && <p className="text-[10px] leading-4 text-amber-300">{trajectory.warning}</p>}
                <p className="text-[9px] leading-4 text-slate-500">Map road links are routing estimates between stored sightings, not proof of the vehicle&apos;s exact path or a live predicted location.</p>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-slate-800 p-4 text-center text-[10px] text-slate-500">No trajectory loaded. Enter a complete registration on the right. A route is drawn only from persisted sightings.</p>
            )}
          </section>
        </main>

        <aside className="min-w-0 space-y-3">
          <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">Vehicle search</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">Historic identity and sightings</p>
              </div>
              <span className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[9px] font-mono text-slate-400">ANPR</span>
            </div>
            <form onSubmit={handleSearch} className="mt-3 space-y-2">
              <input value={plateInput} onChange={(event) => setPlateInput(event.target.value.toUpperCase())} placeholder="Enter full registration" className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2.5 font-mono text-sm font-semibold tracking-wider text-slate-100 outline-none placeholder:font-sans placeholder:text-slate-600 focus:border-cyan-500" />
              <button type="submit" disabled={searching || !plateInput.trim()} className="w-full rounded-lg bg-cyan-500 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-950 hover:bg-cyan-400 disabled:cursor-not-allowed disabled:opacity-50">
                {searching ? "Reconstructing…" : "Find vehicle trajectory"}
              </button>
            </form>
            {searchError && <p className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] leading-4 text-amber-200">{searchError}</p>}
            {trajectory && (
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-3 text-[10px]">
                <div><span className="block text-slate-500">Target</span><span className="font-mono font-bold text-cyan-300">{trajectory.vehicle.plate}</span></div>
                <div><span className="block text-slate-500">Sightings</span><span className="text-slate-200">{trajectory.points.length}</span></div>
                <div><span className="block text-slate-500">Distance estimate</span><span className="text-slate-200">{trajectory.estimatedDistanceKm.toFixed(2)} km</span></div>
                <div><span className="block text-slate-500">Duration estimate</span><span className="text-slate-200">{trajectory.estimatedDurationMinutes.toFixed(0)} min</span></div>
              </div>
            )}
          </section>

          <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-200">Camera network</h2>
                <p className="mt-0.5 text-[10px] text-slate-500">{filteredCameras.length} of {cameras.length} nodes</p>
              </div>
              <Link href="/camera-network" className="text-[10px] font-semibold text-cyan-300">Full map →</Link>
            </div>
            <input value={cameraFilter} onChange={(event) => setCameraFilter(event.target.value)} placeholder="Search cameras or locations" className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-cyan-500" />
            <div className="mt-2 max-h-[380px] space-y-1 overflow-y-auto pr-1">
              {loading ? <p className="p-3 text-center text-[10px] text-slate-500">Loading camera registry…</p> : filteredCameras.map((camera) => {
                const active = selectedCameraId === camera.id;
                return (
                  <button key={camera.id} type="button" onClick={() => handleCameraSelect(camera)} className={`w-full rounded-lg border px-2.5 py-2 text-left ${active ? "border-cyan-500/60 bg-cyan-500/10" : "border-transparent bg-slate-900/60 hover:border-slate-700"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[10px] font-semibold text-slate-200">{camera.name || camera.id}</span>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${camera.sourceType === "PUBLIC_CATALOG" ? "bg-emerald-400" : camera.sourceType === "GOVERNMENT_API" ? "bg-sky-400" : "bg-slate-500"}`} />
                    </span>
                    <span className="mt-0.5 flex items-center justify-between gap-2 text-[9px] text-slate-500">
                      <span className="truncate">{camera.id} · {camera.place || camera.region || camera.countryCode || "Location metadata"}</span>
                      <span className="shrink-0">{camera.liveVideo ? "LIVE DECLARED" : camera.liveSnapshot ? "SNAPSHOT" : "METADATA"}</span>
                    </span>
                  </button>
                );
              })}
              {!loading && filteredCameras.length === 0 && <p className="p-3 text-center text-[10px] text-slate-500">No cameras match this filter.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-amber-500/25 bg-amber-500/5 p-3">
            <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-200">Feed verification</h3>
            <p className="mt-1 text-[10px] leading-4 text-amber-100/70">
              {cameraCounts.liveDeclared === 0
                ? "No imported camera record currently declares live video capability. Public catalogue entries are metadata/snapshot records, not confirmed playable video."
                : `${cameraCounts.liveDeclared} records declare live-video capability. Their stream endpoints have not been independently verified or connected to AI ingestion.`}
            </p>
            <p className="mt-2 text-[10px] text-slate-500">{cameraCounts.archives} publisher archives declared · {sources.length} registered sources.</p>
            <Link href="/data-sources" className="mt-2 inline-flex text-[10px] font-semibold text-cyan-300 hover:text-cyan-200">Configure API sources →</Link>
          </section>

          {selectedCamera && (
            <section className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-200">Selected camera</h3>
              <p className="mt-1 text-xs font-semibold text-slate-100">{selectedCamera.name}</p>
              <p className="mt-0.5 break-all font-mono text-[9px] text-slate-500">{selectedCamera.id}</p>
              <p className="mt-2 text-[10px] text-slate-400">{selectedSource}</p>
              <p className="mt-1 text-[10px] leading-4 text-slate-500">{selectedCamera.attribution || "No publisher attribution provided."}</p>
              {selectedCamera.pageUrl && <a href={selectedCamera.pageUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-[10px] font-semibold text-cyan-300">Publisher page ↗</a>}
            </section>
          )}
        </aside>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 px-1 pt-3 text-[9px] text-slate-500">
        <span>City AI Traffic · SIH26127 · India camera inventory</span>
        <span>{cameraCounts.snapshots} snapshot-capable · {cameraCounts.liveDeclared} live-declared (unverified) · {uploads.length} stored video uploads</span>
        <span>Camera coordinates and detections are persisted records; live ingestion is not active.</span>
      </section>

      <VideoIngestionModal
        isOpen={isIngestionOpen}
        cameraInventory={cameras}
        onClose={() => {
          setIsIngestionOpen(false);
          void loadWorkspace();
        }}
        onTargetDetected={(plate) => {
          setPlateInput(plate);
          void getVehicleTrajectory(plate).then((result) => {
            setTrajectory(result);
            setSelectedTrajectoryIndex(result.points.length ? 0 : null);
          }).catch((error) => setSearchError(error instanceof Error ? error.message : "Vehicle search failed"));
        }}
      />
    </div>
  );
}
