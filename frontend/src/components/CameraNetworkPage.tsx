"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCameras, type CameraDto } from "@/lib/api";

const CameraNetworkMap = dynamic(
  () => import("./CameraNetworkMap").then((module) => module.CameraNetworkMap),
  { ssr: false, loading: () => <div className="h-[620px] animate-pulse rounded-lg bg-slate-100" /> }
);

type SourceFilter = "ALL" | "PUBLIC_CATALOG" | "GOVERNMENT_API" | "LEGACY";
type CapabilityFilter = "ALL" | "LIVE_VIDEO" | "SNAPSHOT" | "ARCHIVE" | "EXTERNAL";

export function CameraNetworkPage() {
  const [cameras, setCameras] = useState<CameraDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("ALL");
  const [capabilityFilter, setCapabilityFilter] = useState<CapabilityFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selectedCamera, setSelectedCamera] = useState<CameraDto | null>(null);
  const [viewport, setViewport] = useState<{ west: number; south: number; east: number; north: number } | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!viewport) return;
    requestRef.current?.abort();
    const request = new AbortController();
    requestRef.current = request;
    setLoading(true);
    try {
      const items = await getCameras({ mode: "all", bbox: viewport, signal: request.signal });
      if (request.signal.aborted) return;
      setCameras(items);
      setError(null);
    } catch (loadError) {
      if (request.signal.aborted) return;
      setCameras([]);
      setError(loadError instanceof Error ? loadError.message : "Camera registry could not be loaded");
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }, [viewport]);

  const handleViewportChange = useCallback((bounds: { west: number; south: number; east: number; north: number }) => {
    setViewport((current) => {
      if (current && Math.abs(current.west - bounds.west) < 0.05 && Math.abs(current.south - bounds.south) < 0.05
        && Math.abs(current.east - bounds.east) < 0.05 && Math.abs(current.north - bounds.north) < 0.05) return current;
      return bounds;
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const filtered = useMemo(() => cameras.filter((camera) => {
    const sourceMatches = sourceFilter === "ALL" || (camera.sourceType || "LEGACY") === sourceFilter;
    const capabilityMatches =
      capabilityFilter === "ALL"
      || (capabilityFilter === "LIVE_VIDEO" && camera.liveVideo)
      || (capabilityFilter === "SNAPSHOT" && camera.liveSnapshot)
      || (capabilityFilter === "ARCHIVE" && camera.archiveAvailable)
      || (capabilityFilter === "EXTERNAL" && camera.externalPlayer);
    const searchText = [camera.id, camera.name, camera.region, camera.place, camera.sourceName, camera.sourceNetwork].filter(Boolean).join(" ").toLowerCase();
    return sourceMatches && capabilityMatches && searchText.includes(search.toLowerCase());
  }), [cameras, sourceFilter, capabilityFilter, search]);

  const publicCount = cameras.filter((camera) => camera.sourceType === "PUBLIC_CATALOG").length;
  const agencyCount = cameras.filter((camera) => camera.sourceType === "GOVERNMENT_API").length;
  const liveCount = cameras.filter((camera) => camera.liveVideo || camera.liveSnapshot).length;
  const publisherArchiveCount = cameras.filter((camera) => camera.archiveAvailable).length;

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-5 p-5 lg:p-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Camera infrastructure</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">Camera network</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">India camera inventory from imported public catalogues and configured agency integrations.</p>
        </div>
        <button type="button" onClick={() => void load()} className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Refresh inventory
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Cameras in map view", cameras.length],
          ["Public catalogue", publicCount],
          ["Government / agency", agencyCount],
          ["Live-capable entries", liveCount],
        ].map(([label, count]) => (
          <div key={String(label)} className="rounded-lg border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{String(label)}</p>
            <p className="mt-2 text-2xl font-semibold text-slate-950">{Number(count).toLocaleString()}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="min-w-[220px] flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
          placeholder="Search camera, place or source"
        />
        <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value as SourceFilter)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="ALL">All sources</option>
          <option value="PUBLIC_CATALOG">Public cameras</option>
          <option value="GOVERNMENT_API">Government cameras</option>
          <option value="LEGACY">Legacy / local</option>
        </select>
        <select value={capabilityFilter} onChange={(event) => setCapabilityFilter(event.target.value as CapabilityFilter)} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm">
          <option value="ALL">All capabilities</option>
          <option value="LIVE_VIDEO">Live video</option>
          <option value="SNAPSHOT">Live snapshot</option>
          <option value="ARCHIVE">Publisher archive</option>
          <option value="EXTERNAL">External player</option>
        </select>
        <span className="text-xs text-slate-500">{filtered.length.toLocaleString()} shown</span>
      </div>

      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Camera registry unavailable.</strong> {error}
          <p className="mt-1 text-xs">The source and feed-capability fields could not be loaded. Check database connectivity and migration status.</p>
        </div>
      )}

      {loading ? (
        <div className="h-[620px] animate-pulse rounded-lg bg-slate-100" />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Geographic inventory</h2>
                <p className="text-xs text-slate-500">Inventory is queried for the visible map bounds. Public markers are green; agency markers are blue; legacy/local markers are grey.</p>
              </div>
              <span className="text-xs text-slate-500">India view</span>
            </div>
            <div className="h-[min(72vh,820px)] min-h-[620px]">
              <CameraNetworkMap cameras={filtered} selectedCameraId={selectedCamera?.id || null} onSelectCamera={setSelectedCamera} onViewportChange={handleViewportChange} />
            </div>
          </div>

          <aside className="space-y-3">
            {selectedCamera ? (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Selected camera</p>
                    <h2 className="mt-1 font-semibold text-slate-950">{selectedCamera.name}</h2>
                    <p className="mt-1 break-all font-mono text-xs text-slate-500">{selectedCamera.id}</p>
                  </div>
                  <button type="button" onClick={() => setSelectedCamera(null)} className="text-xs text-slate-500 hover:text-slate-900">Close</button>
                </div>
                <dl className="mt-4 space-y-2 text-sm">
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Source</dt><dd className="text-right text-slate-900">{selectedCamera.sourceName || selectedCamera.sourceType || "Legacy"}{selectedCamera.sourceNetwork ? " · " + selectedCamera.sourceNetwork : ""}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Feed type</dt><dd className="text-right text-slate-900">{selectedCamera.feedType || "Unknown"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Country / region</dt><dd className="text-right text-slate-900">{[selectedCamera.countryCode, selectedCamera.region, selectedCamera.place].filter(Boolean).join(" · ") || "Not provided"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Source status</dt><dd className="text-right text-slate-900">{selectedCamera.sourceStatus || "Unknown"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Live video</dt><dd>{selectedCamera.liveVideo ? "Yes" : "No"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Live snapshot</dt><dd>{selectedCamera.liveSnapshot ? "Yes" : "No"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">Historical archive</dt><dd>{selectedCamera.archiveAvailable ? "Publisher archive" : "Not provided"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-slate-500">External player</dt><dd>{selectedCamera.externalPlayer ? "Available" : "No"}</dd></div>
                </dl>
                {selectedCamera.attribution && <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">Attribution: {selectedCamera.attribution}</p>}
                <div className="mt-3 flex flex-wrap gap-3">
                  {selectedCamera.streamUrl && <a href={selectedCamera.streamUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">Open published live feed</a>}
                  {selectedCamera.archiveUrl && selectedCamera.archiveAvailable && <a href={selectedCamera.archiveUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">Open publisher archive</a>}
                  {selectedCamera.pageUrl && <a href={selectedCamera.pageUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-blue-700 hover:underline">Open publisher page</a>}
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-500">A registered feed is not a confirmed working stream. Feed playback and automated AI processing are separate stages.</p>
              </section>
            ) : (
              <section className="rounded-lg border border-slate-200 bg-white p-4">
                <h2 className="font-semibold text-slate-900">Camera details</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Select a marker to inspect its publisher, feed capability and location metadata.</p>
              </section>
            )}

            <section className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="font-semibold text-slate-900">Feed capability summary</h2>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Live video / snapshot</span><strong>{liveCount}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Publisher archive</span><strong>{publisherArchiveCount}</strong></div>
                <div className="flex justify-between"><span className="text-slate-500">Public source records</span><strong>{publicCount}</strong></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">Historic investigation also uses detections and evidence already stored by SIH. A live-only public camera is not a historic video source.</p>
            </section>
          </aside>
        </div>
      )}
    </div>
  );
}
