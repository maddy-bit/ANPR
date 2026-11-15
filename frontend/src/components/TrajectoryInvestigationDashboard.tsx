"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import {
  ApiError,
  getGlobalTrajectory,
  getGlobalTrajectoryQuality,
  listGlobalIdentities,
  searchGlobalIdentity,
  type GlobalIdentityDto,
  type GlobalTrajectoryDto,
  type TrajectoryQualityDto,
} from "@/lib/api";
import { TrajectoryQualityPanel } from "./TrajectoryQualityPanel";

const TrajectoryInvestigationMap = dynamic(
  () => import("./TrajectoryInvestigationMap").then((mod) => mod.TrajectoryInvestigationMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[420px] w-full flex-col items-center justify-center rounded-md border border-slate-800 bg-slate-950 p-6 font-mono text-xs text-sky-400">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent mb-3" />
        LOADING VECTOR MAP ENGINE...
      </div>
    ),
  }
);

export function TrajectoryInvestigationDashboard() {
  const [identities, setIdentities] = useState<GlobalIdentityDto[]>([]);
  const [identitiesLoading, setIdentitiesLoading] = useState(true);
  const [selectedIdentityId, setSelectedIdentityId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);

  const [trajectory, setTrajectory] = useState<GlobalTrajectoryDto | null>(null);
  const [quality, setQuality] = useState<TrajectoryQualityDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [selectedObsId, setSelectedObsId] = useState<number | null>(null);

  // Stale request prevention: tracks monotonically increasing request token
  const activeRequestIdRef = useRef<number>(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Idiomatic React 19 pattern: Adjust state during render when selected identity changes
  const [prevSelectedId, setPrevSelectedId] = useState<string | null>(null);
  if (selectedIdentityId !== prevSelectedId) {
    setPrevSelectedId(selectedIdentityId);
    if (selectedIdentityId) {
      setLoading(true);
      setErrorMessage(null);
      setSelectedObsId(null);
    }
  }

  // Load recent global vehicle identities on mount
  useEffect(() => {
    let cancelled = false;
    listGlobalIdentities(0, 10)
      .then((page) => {
        if (!cancelled) {
          setIdentities(page.content || []);
          setIdentitiesLoading(false);
          if (page.content && page.content.length > 0) {
            setSelectedIdentityId((prev) => prev || page.content[0].id);
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setIdentitiesLoading(false);
          console.warn("Could not list identities from backend:", err);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch Trajectory & Quality when selectedIdentityId changes
  const loadIdentityData = useCallback((id: string) => {
    // 1. Cancel in-flight request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    // 2. Increment request ID to ignore stale responses
    const requestId = ++activeRequestIdRef.current;

    Promise.all([
      getGlobalTrajectory(id, { signal: controller.signal }),
      getGlobalTrajectoryQuality(id, { signal: controller.signal }),
    ])
      .then(([trajData, qualData]) => {
        if (activeRequestIdRef.current === requestId) {
          setTrajectory(trajData);
          setQuality(qualData);
          setLoading(false);
          setErrorMessage(null);
          if (trajData.observations.length > 0) {
            setSelectedObsId(trajData.observations[0].detectionId);
          }
        }
      })
      .catch((err: unknown) => {
        if (activeRequestIdRef.current === requestId) {
          if (err instanceof Error && err.name === "AbortError") {
            return;
          }
          setTrajectory(null);
          setQuality(null);
          setLoading(false);
          if (err instanceof ApiError) {
            if (err.isNotFound) {
              setErrorMessage(`Global vehicle identity '${id}' was not found in the database.`);
            } else if (err.status === 400) {
              setErrorMessage(`Malformed or invalid UUID format: '${id}'`);
            } else {
              setErrorMessage(err.message);
            }
          } else {
            setErrorMessage(err instanceof Error ? err.message : "Failed to load vehicle trajectory");
          }
        }
      });
  }, []);

  useEffect(() => {
    if (selectedIdentityId) {
      loadIdentityData(selectedIdentityId);
    }
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [selectedIdentityId, loadIdentityData]);

  // Handle Search Submission
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearchError(null);
    try {
      const match = await searchGlobalIdentity(searchQuery.trim());
      setSelectedIdentityId(match.id);
      setSearchQuery("");
    } catch (err: unknown) {
      if (err instanceof ApiError && err.isNotFound) {
        setSearchError(`No vehicle identity found matching query: '${searchQuery.trim()}'`);
      } else {
        setSearchError(err instanceof Error ? err.message : "Search failed");
      }
    }
  };

  return (
    <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6 bg-slate-100 min-h-screen text-slate-900 font-sans">
      {/* Search Bar & Identity Quick Switcher */}
      <div className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4 shadow-xs">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
              <span>ðŸ›°ï¸</span>
              <span>Multi-Camera Vehicle Trajectory Investigation</span>
            </h2>
            <p className="text-xs text-slate-500 font-mono mt-0.5">
              Authoritative trajectory reconstruction backed by multi-signal FastReID, OCR, and calibrated road topology.
            </p>
          </div>

          <form onSubmit={handleSearch} className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search UUID, label, or plate..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-72 sm:w-80 rounded-md border border-slate-300 bg-slate-50 px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-800 focus:bg-white focus:outline-none"
            />
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-4 py-1.5 font-mono text-xs font-bold text-white uppercase tracking-wider hover:bg-slate-800 cursor-pointer shadow-xs"
            >
              Search
            </button>
          </form>
        </div>

        {searchError && (
          <div className="rounded-xs border border-rose-300 bg-rose-50 px-3 py-1.5 font-mono text-xs text-rose-800">
            âš ï¸ {searchError}
          </div>
        )}

        {/* Quick Identity Pills */}
        <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-slate-100">
          <span className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider mr-1">
            Recent Identities:
          </span>
          {identitiesLoading ? (
            <span className="text-xs font-mono text-slate-400">Loading identities...</span>
          ) : identities.length === 0 ? (
            <span className="text-xs font-mono text-slate-400">No identities registered in database yet.</span>
          ) : (
            identities.map((gid) => {
              const isSelected = selectedIdentityId === gid.id;
              return (
                <button
                  key={gid.id}
                  type="button"
                  onClick={() => setSelectedIdentityId(gid.id)}
                  className={`rounded-xs px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer border ${
                    isSelected
                      ? "border-slate-900 bg-slate-900 text-white shadow-xs"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  <span>{gid.primaryPlate || gid.label}</span>
                  <span className={`ml-1.5 text-[9px] ${isSelected ? "text-slate-300" : "text-slate-500"}`}>
                    ({gid.detectionCount} obs)
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Loading Skeleton */}
      {loading && (
        <div className="flex flex-col items-center justify-center rounded-md border border-slate-300 bg-white p-12 shadow-xs">
          <div className="h-8 w-8 animate-spin rounded-full border-3 border-slate-900 border-t-transparent mb-3" />
          <div className="font-mono text-sm font-bold uppercase tracking-wider text-slate-800">
            Reconstructing Vehicle Trajectory...
          </div>
          <div className="font-mono text-xs text-slate-500 mt-1">
            Evaluating spatial-temporal transitions and multi-signal evidence dimensions
          </div>
        </div>
      )}

      {/* Error State */}
      {!loading && errorMessage && (
        <div className="flex flex-col items-center justify-center rounded-md border-2 border-rose-300 bg-rose-50 p-8 shadow-xs text-center font-mono">
          <span className="text-3xl mb-2">âš ï¸</span>
          <div className="text-sm font-bold uppercase text-rose-900 tracking-wider">
            Trajectory Reconstruction Error
          </div>
          <p className="text-xs text-rose-800 mt-1 max-w-lg">{errorMessage}</p>
          <button
            type="button"
            onClick={() => {
              if (identities.length > 0) {
                setSelectedIdentityId(identities[0].id);
              }
            }}
            className="mt-4 rounded-md bg-rose-800 px-4 py-1.5 text-xs font-bold text-white uppercase tracking-wider hover:bg-rose-900 cursor-pointer"
          >
            Select First Available Identity
          </button>
        </div>
      )}

      {/* Trajectory Main Workspace */}
      {!loading && !errorMessage && trajectory && quality && (
        <div className="flex flex-col gap-4">
          {/* Identity Summary Header Card */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3 rounded-md border border-slate-300 bg-white p-4 font-mono text-xs shadow-xs">
            <div className="flex flex-col col-span-2">
              <span className="text-[10px] uppercase text-slate-400 font-bold">Global Identity</span>
              <span className="text-sm font-bold text-slate-900">{trajectory.label}</span>
              <span className="text-[10px] text-slate-500 truncate">{trajectory.globalIdentityId}</span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-slate-400 font-bold">Vehicle / Plate</span>
              <span className="text-sm font-bold text-slate-900">{trajectory.primaryPlate || "N/A"}</span>
              <span className="text-[10px] text-slate-500 capitalize">{trajectory.vehicleClass || "Unknown Class"}</span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-slate-400 font-bold">Review Status</span>
              <span className="text-sm font-bold text-emerald-700">{trajectory.reviewStatus}</span>
              <span className="text-[10px] text-slate-500">
                {trajectory.hasImpossibleTransitions ? "âš ï¸ Disconnected" : "âœ“ Continuous"}
              </span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-slate-400 font-bold">Sightings & Cameras</span>
              <span className="text-sm font-bold text-slate-900">{trajectory.confirmedObservations} confirmed</span>
              <span className="text-[10px] text-slate-500">{quality.counts.distinctCameraCount} distinct cameras</span>
            </div>

            <div className="flex flex-col">
              <span className="text-[10px] uppercase text-slate-400 font-bold">Feasible Route</span>
              <span className="text-sm font-bold text-slate-900">
                {trajectory.totalFeasibleDistanceKm != null ? `${trajectory.totalFeasibleDistanceKm} km` : "N/A"}
              </span>
              <span className="text-[10px] text-slate-500">
                {trajectory.totalDurationSeconds != null ? `${trajectory.totalDurationSeconds}s elapsed` : "N/A"}
              </span>
            </div>
          </div>

          {/* Empty Trajectory State */}
          {trajectory.confirmedObservations === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-slate-300 bg-white p-12 text-center font-mono">
              <span className="text-3xl mb-2">ðŸ›°ï¸</span>
              <div className="text-sm font-bold uppercase text-slate-800">No Confirmed Sightings</div>
              <p className="text-xs text-slate-500 mt-1 max-w-md">
                This global identity has zero confirmed observations. Unverified or rejected sightings are strictly excluded.
              </p>
            </div>
          ) : (
            <>
              {/* Map & Quality Panel Side-by-Side Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Interactive Map (7 cols) */}
                <div className="lg:col-span-7 flex flex-col h-[520px]">
                  <TrajectoryInvestigationMap
                    observations={trajectory.observations}
                    transitions={trajectory.transitions}
                    segments={trajectory.segments}
                    selectedObservationId={selectedObsId}
                    onSelectObservation={(id: number) => setSelectedObsId(id)}
                  />
                </div>

                {/* Evidence Reliability & Quality Panel (5 cols) */}
                <div className="lg:col-span-5 flex flex-col">
                  <TrajectoryQualityPanel quality={quality} />
                </div>
              </div>

              {/* Chronological Timeline & Transitions Detail Section */}
              <div className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4 font-mono shadow-xs">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                    <span>â±ï¸</span>
                    <span>Chronological Sighting Timeline & Transition Audit</span>
                  </div>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {trajectory.observations.length} observations | {trajectory.transitions.length} transitions | {trajectory.segmentCount} segments
                  </span>
                </div>

                {/* Trajectory Segments Overview */}
                <div className="flex flex-col gap-2">
                  {trajectory.segments.map((seg) => (
                    <div
                      key={seg.segmentIndex}
                      className="rounded-xs border border-slate-200 bg-slate-50/70 p-2.5 text-xs flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-800">
                          Segment #{seg.segmentIndex}: {seg.segmentType}
                        </span>
                        <span className={`px-2 py-0.5 rounded-xs text-[10px] font-bold ${
                          seg.isFullyVerifiedRoadRoute
                            ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                            : "bg-amber-100 text-amber-800 border border-amber-300"
                        }`}>
                          {seg.isFullyVerifiedRoadRoute ? "VERIFIED ROAD ROUTE" : "PLAUSIBLE CHRONOLOGICAL SEQUENCE"}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 text-[11px] text-slate-600">
                        <span>Observations: {seg.observationCount}</span>
                        <span>Distance: {seg.totalDistanceKm} km</span>
                        <span>Duration: {seg.durationSeconds}s</span>
                      </div>
                      {seg.breakReason && (
                        <div className="mt-1 rounded-xs border border-rose-300 bg-rose-50 px-2 py-1 text-[10px] text-rose-800">
                          âš ï¸ {seg.breakReason}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Observation by Observation Timeline List */}
                <div className="flex flex-col gap-3 mt-2">
                  {trajectory.observations.map((obs, idx) => {
                    const isSelected = selectedObsId === obs.detectionId;
                    const transitionToNext = trajectory.transitions[idx]; // Transition from obs -> next obs

                    return (
                      <div key={obs.detectionId} className="flex flex-col gap-2">
                        {/* Sighting Observation Card */}
                        <div
                          onClick={() => setSelectedObsId(obs.detectionId)}
                          className={`rounded-md border p-3 text-xs transition-all cursor-pointer ${
                            isSelected
                              ? "border-sky-500 bg-sky-50/60 shadow-xs ring-1 ring-sky-400"
                              : "border-slate-200 bg-white hover:bg-slate-50"
                          }`}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-white text-[11px] font-bold">
                                {idx + 1}
                              </span>
                              <span className="font-bold text-slate-900 uppercase">
                                {obs.cameraId}
                              </span>
                              <span className="text-slate-600 font-sans">({obs.cameraName})</span>
                            </div>

                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-slate-500">
                                {obs.timestamp ? new Date(obs.timestamp).toLocaleString() : "Missing timestamp"}
                              </span>
                              {obs.hasCoordinates ? (
                                <span className="rounded-xs bg-slate-100 border border-slate-300 px-1.5 py-0.5 text-[10px] text-slate-600">
                                  {obs.latitude?.toFixed(4)}, {obs.longitude?.toFixed(4)}
                                </span>
                              ) : (
                                <span className="rounded-xs bg-amber-100 border border-amber-300 px-1.5 py-0.5 text-[10px] text-amber-800 font-bold">
                                  No GPS Coordinates
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-2 pt-2 border-t border-slate-100 text-[11px]">
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase block">Plate OCR</span>
                              <span className="font-bold text-slate-800">
                                {obs.plateText || "N/A"}
                              </span>
                              <span className="text-[9px] text-slate-500 ml-1">
                                ({obs.plateConfidence != null ? Math.round(obs.plateConfidence * 100) + "%" : "N/A"})
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 uppercase block">Detection Conf</span>
                              <span className="font-bold text-slate-800">
                                {obs.detectionConfidence != null ? Math.round(obs.detectionConfidence * 100) + "%" : "N/A"}
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 uppercase block">Provenance</span>
                              <span className="font-bold text-slate-800">
                                {obs.provenance?.isSeedObservation ? "Initial Seed" : obs.provenance?.associationDecision || "Confirmed"}
                              </span>
                              <span className="text-[9px] text-slate-500 ml-1">
                                [{obs.provenance?.associationReviewStatus || "SYSTEM"}]
                              </span>
                            </div>

                            <div>
                              <span className="text-[10px] text-slate-400 uppercase block">Re-ID Score</span>
                              <span className="font-bold text-slate-800">
                                {obs.provenance?.reidScore != null ? obs.provenance.reidScore.toFixed(3) : "N/A"}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Transition Card to Next Observation (if present) */}
                        {transitionToNext && (
                          <div className="ml-6 pl-4 border-l-2 border-dashed border-slate-300 py-1 flex flex-col gap-1 text-[11px]">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                Transition: {transitionToNext.fromCameraId} â†’ {transitionToNext.toCameraId}
                              </span>

                              <span className={`px-1.5 py-0.5 rounded-xs text-[9px] font-bold ${
                                transitionToNext.status === "FEASIBLE"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : transitionToNext.status === "IMPOSSIBLE"
                                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                                  : "bg-amber-100 text-amber-800 border border-amber-300"
                              }`}>
                                {transitionToNext.status}
                              </span>

                              <span className="px-1.5 py-0.5 rounded-xs text-[9px] font-bold bg-slate-100 text-slate-800 border border-slate-300">
                                {transitionToNext.connectivity}
                              </span>

                              {transitionToNext.distanceKm != null && (
                                <span className="text-slate-600">
                                  {transitionToNext.distanceKm.toFixed(2)} km in {transitionToNext.deltaSeconds?.toFixed(1)}s
                                </span>
                              )}

                              {transitionToNext.apparentSpeedKmh != null && (
                                <span className="text-slate-600">
                                  (Speed: {transitionToNext.apparentSpeedKmh.toFixed(1)} km/h)
                                </span>
                              )}
                            </div>

                            <p className="text-[10px] text-slate-500 italic">
                              {transitionToNext.reason}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}


