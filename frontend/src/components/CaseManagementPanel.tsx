"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  listInvestigations,
  createInvestigation,
  updateInvestigation,
  addInvestigationNote,
  getInvestigation,
  discoverCaseCameraCandidates,
  InvestigationDto,
  CameraDiscoveryCandidate,
} from "@/lib/api";

export function CaseManagementPanel() {
  const [cases, setCases] = useState<InvestigationDto[]>([]);
  const [selectedCase, setSelectedCase] = useState<InvestigationDto | null>(null);
  const selectedCaseIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Case Form State
  const [newTitle, setNewTitle] = useState("");
  const [newTargetPlate, setNewTargetPlate] = useState("");
  const [newPriority, setNewPriority] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("HIGH");
  const [newOfficer, setNewOfficer] = useState("Authorized investigator");
  const [newDescription, setNewDescription] = useState("");
  const [searchCenterLat, setSearchCenterLat] = useState("");
  const [searchCenterLon, setSearchCenterLon] = useState("");
  const [searchRadiusKm, setSearchRadiusKm] = useState("10");
  const [searchStartAt, setSearchStartAt] = useState("");
  const [searchEndAt, setSearchEndAt] = useState("");

  // New Note State
  const [newNote, setNewNote] = useState("");
  const [selectedDetectionId, setSelectedDetectionId] = useState("");
  const [cameraCandidates, setCameraCandidates] = useState<CameraDiscoveryCandidate[]>([]);
  const [discoveryLoading, setDiscoveryLoading] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);

  const loadCases = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listInvestigations(statusFilter || undefined);
      setCases(data);
      const preferredId = selectedCaseIdRef.current;
      const target = (preferredId && data.find((item) => item.id === preferredId)) || data[0];
      if (target) {
        selectedCaseIdRef.current = target.id;
        try {
          setSelectedCase(await getInvestigation(target.id));
        } catch {
          setSelectedCase(target);
        }
      } else {
        selectedCaseIdRef.current = null;
        setSelectedCase(null);
      }
    } catch (err) {
      console.error("Failed to load cases", err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadCases();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCases]);

  const handleCreateCase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim()) return;

    try {
      const created = await createInvestigation({
        title: newTitle,
        targetPlate: newTargetPlate.trim() ? newTargetPlate.toUpperCase() : undefined,
        priority: newPriority,
        assignedOfficer: newOfficer,
        description: newDescription,
        status: "OPEN",
        searchCenterLat: searchCenterLat.trim() ? Number(searchCenterLat) : undefined,
        searchCenterLon: searchCenterLon.trim() ? Number(searchCenterLon) : undefined,
        searchRadiusKm: searchRadiusKm.trim() ? Number(searchRadiusKm) : undefined,
        searchStartAt: searchStartAt ? new Date(searchStartAt).toISOString() : undefined,
        searchEndAt: searchEndAt ? new Date(searchEndAt).toISOString() : undefined,
      });

      selectedCaseIdRef.current = created.id;
      setShowCreateModal(false);
      setNewTitle("");
      setNewTargetPlate("");
      setNewDescription("");
      setSearchCenterLat("");
      setSearchCenterLon("");
      setSearchRadiusKm("10");
      setSearchStartAt("");
      setSearchEndAt("");
      await loadCases();
      try {
        setSelectedCase(await getInvestigation(created.id));
      } catch {
        setSelectedCase(created);
      }
    } catch (err: unknown) {
      alert("Failed to create case: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleSelectCase = async (caseItem: InvestigationDto) => {
    selectedCaseIdRef.current = caseItem.id;
    setSelectedCase(caseItem);
    setSelectedDetectionId("");
    setCameraCandidates([]);
    setDiscoveryError(null);
    try {
      setSelectedCase(await getInvestigation(caseItem.id));
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Could not load case sightings");
    }
  };

  const handleDiscoverCameras = async () => {
    if (!selectedCase || !selectedDetectionId) return;
    setDiscoveryLoading(true);
    setDiscoveryError(null);
    setCameraCandidates([]);
    try {
      const result = await discoverCaseCameraCandidates(selectedCase.id, Number(selectedDetectionId), selectedCase.searchRadiusKm || 10);
      setCameraCandidates(result.candidates);
    } catch (err) {
      setDiscoveryError(err instanceof Error ? err.message : "Camera discovery failed");
    } finally {
      setDiscoveryLoading(false);
    }
  };

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCase || !newNote.trim()) return;

    try {
      const updated = await addInvestigationNote(selectedCase.id, {
        officer: selectedCase.assignedOfficer || "Investigator",
        note: newNote,
      });
      setSelectedCase(updated);
      setNewNote("");
      await loadCases();
    } catch (err: unknown) {
      alert("Failed to add note: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const handleStatusChange = async (newStatus: "OPEN" | "ACTIVE" | "CLOSED" | "ARCHIVED") => {
    if (!selectedCase) return;
    try {
      const updated = await updateInvestigation(selectedCase.id, { status: newStatus });
      setSelectedCase(updated);
      await loadCases();
    } catch (err: unknown) {
      alert("Failed to update status: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-4.5rem)] bg-slate-50 p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-1 max-w-7xl w-full mx-auto gap-6 overflow-hidden">
        {/* Left Side: Case List */}
        <div className="w-1/3 flex flex-col bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wider">Active Investigations</h2>
              <p className="text-xs text-slate-400">Formal vehicle case files & evidence records</p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              + New Case
            </button>
          </div>

          <div className="p-3 bg-slate-100 border-b border-slate-200 flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 text-slate-800 font-medium"
            >
              <option value="">All Statuses</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="OPEN">OPEN</option>
              <option value="CLOSED">CLOSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
            {loading ? (
              <div className="p-6 text-center text-slate-500 text-xs">Loading case filesâ€¦</div>
            ) : cases.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-xs">No cases found. Create a new case to begin tracking.</div>
            ) : (
              cases.map((c) => (
                <div
                  key={c.id}
                  onClick={() => void handleSelectCase(c)}
                  className={`p-4 cursor-pointer transition-colors ${
                    selectedCase?.id === c.id ? "bg-blue-50/70 border-l-4 border-l-blue-600" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs font-bold text-slate-700">{c.caseNumber}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                        c.priority === "CRITICAL"
                          ? "bg-red-100 text-red-700 border border-red-200"
                          : c.priority === "HIGH"
                          ? "bg-amber-100 text-amber-800 border border-amber-200"
                          : "bg-slate-100 text-slate-700 border border-slate-200"
                      }`}
                    >
                      {c.priority}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold text-slate-900 line-clamp-1">{c.title}</h3>
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                    <span className="font-mono font-bold text-slate-800">{c.targetPlate || "No plate"}</span>
                    <span className="text-[11px] font-medium">{c.status}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Side: Case Details & Timeline */}
        <div className="flex-1 flex flex-col bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
          {selectedCase ? (
            <div className="flex flex-col flex-1 overflow-hidden">
              {/* Header */}
              <div className="p-5 border-b border-slate-200 bg-slate-50 flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-sm font-bold text-slate-600">{selectedCase.caseNumber}</span>
                    <span
                      className={`text-xs font-bold px-2.5 py-0.5 rounded uppercase ${
                        selectedCase.status === "ACTIVE"
                          ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                          : "bg-slate-200 text-slate-700"
                      }`}
                    >
                      {selectedCase.status}
                    </span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 mt-1">{selectedCase.title}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{selectedCase.description || "No description provided."}</p>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedCase.status}
                    onChange={(e) => handleStatusChange(e.target.value as "OPEN" | "ACTIVE" | "CLOSED" | "ARCHIVED")}
                    className="text-xs bg-white border border-slate-300 rounded px-2.5 py-1.5 font-semibold text-slate-800"
                  >
                    <option value="ACTIVE">Mark ACTIVE</option>
                    <option value="OPEN">Mark OPEN</option>
                    <option value="CLOSED">Mark CLOSED</option>
                    <option value="ARCHIVED">Mark ARCHIVED</option>
                  </select>
                </div>
              </div>

              {/* Meta Grid */}
              <div className="grid grid-cols-4 gap-4 p-4 border-b border-slate-200 bg-white text-xs">
                <div>
                  <span className="text-slate-400 block font-mono">TARGET PLATE</span>
                  <span className="font-mono font-bold text-slate-900 text-sm">
                    {selectedCase.targetPlate || "UNASSIGNED"}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block font-mono">ASSIGNED OFFICER</span>
                  <span className="font-semibold text-slate-800">{selectedCase.assignedOfficer || "Unassigned"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-mono">PRIORITY</span>
                  <span className="font-bold text-slate-800">{selectedCase.priority}</span>
                </div>
                <div>
                  <span className="text-slate-400 block font-mono">CREATED</span>
                  <span className="text-slate-700">{new Date(selectedCase.createdAt).toLocaleDateString()}</span>
                </div>
              </div>

              <section className="border-b border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900">Route-aware camera discovery</h3>
                    <p className="mt-1 text-xs text-slate-500">
                      Link a target plate and configure the case area and complete time window. Then select a persisted sighting to find relevant live-capable cameras.
                    </p>
                  </div>
                  <span className="rounded bg-slate-100 px-2 py-1 text-[10px] font-semibold uppercase text-slate-600">
                    {selectedCase.searchCenterLat != null && selectedCase.searchCenterLon != null
                      ? "Area bounded"
                      : "Scope incomplete"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <select
                    value={selectedDetectionId}
                    onChange={(event) => setSelectedDetectionId(event.target.value)}
                    className="min-w-[220px] flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800"
                  >
                    <option value="">Choose a stored vehicle sighting</option>
                    {(selectedCase.sightings || []).map((sighting) => (
                      <option key={sighting.id} value={sighting.id}>
                        {sighting.cameraName || sighting.cameraId} Â· {new Date(sighting.timestamp).toLocaleString()}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleDiscoverCameras()}
                    disabled={!selectedCase.targetPlate || !selectedDetectionId || selectedCase.searchCenterLat == null || selectedCase.searchCenterLon == null || !selectedCase.searchStartAt || !selectedCase.searchEndAt || discoveryLoading}
                    className="rounded bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {discoveryLoading ? "Finding camerasâ€¦" : "Find route cameras"}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  {selectedCase.sightings?.length || 0} stored sightings Â· Search radius {selectedCase.searchRadiusKm || 10} km Â·
                  {selectedCase.searchStartAt && selectedCase.searchEndAt
                    ? " case time window enforced"
                    : " complete case time window required"}
                </p>
                {discoveryError && <p className="mt-2 text-xs text-rose-700">{discoveryError}</p>}
                {cameraCandidates.length > 0 && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {cameraCandidates.map((camera) => (
                      <article key={camera.id} className="rounded border border-slate-200 bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-semibold text-slate-900">{camera.name}</p>
                            <p className="mt-0.5 truncate text-[10px] text-slate-500">{camera.id} Â· {camera.sourceName || camera.sourceType || "Legacy source"}</p>
                          </div>
                          <span className="shrink-0 rounded bg-white px-2 py-1 text-[9px] font-semibold uppercase text-slate-600">{camera.priority}</span>
                        </div>
                        <p className="mt-2 text-[11px] text-slate-600">
                          {camera.routeRelation === "VERIFIED_ROUTE_NETWORK" ? "Verified multi-camera route link" : "Nearby alternative Â· route unverified"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-600">
                          {(camera.geodesicDistanceMeters / 1000).toFixed(2)} km Â· {camera.feedType || "Unknown feed"} Â· {camera.processingCapability === "FEED_METADATA_ONLY" ? "Feed listed; AI connection not verified" : "External player only"}
                        </p>
                        {camera.estimatedArrivalWindowSeconds && (
                          <p className="mt-1 text-[10px] text-slate-500">
                            Recorded edge travel range: {camera.estimatedArrivalWindowSeconds.minimum}â€“{camera.estimatedArrivalWindowSeconds.maximum}s
                          </p>
                        )}
                      </article>
                    ))}
                  </div>
                )}
                {cameraCandidates.length > 0 && (
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">
                    Route-first and fallback are evidence tiers, not percentages. This view discovers candidate cameras only; it does not watch feeds or automatically expand after a no-sighting result.
                  </p>
                )}
                {selectedDetectionId && !discoveryLoading && !discoveryError && cameraCandidates.length === 0 && (
                  <p className="mt-3 text-xs text-slate-500">No eligible camera candidates returned for this sighting and case scope.</p>
                )}
              </section>

              {/* Notes & Activity Timeline */}
              <div className="flex-1 p-5 overflow-y-auto space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Case Activity Log ({selectedCase.notes?.length || 0} Entries)
                </h4>

                <div className="space-y-3">
                  {selectedCase.notes?.map((n, i) => (
                    <div key={i} className="p-3 bg-slate-50 border border-slate-200 rounded text-xs">
                      <div className="flex items-center justify-between text-slate-500 mb-1">
                        <span className="font-semibold text-slate-800">{n.officer}</span>
                        <span className="font-mono text-[11px]">{new Date(n.timestamp).toLocaleString()}</span>
                      </div>
                      <p className="text-slate-700 leading-relaxed">{n.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Add Note Input */}
              <div className="p-4 bg-slate-50 border-t border-slate-200">
                <form onSubmit={handleAddNote} className="flex gap-2">
                  <input
                    type="text"
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    placeholder="Enter case note or evidence findings..."
                    className="flex-1 text-xs px-3 py-2 bg-white border border-slate-300 rounded focus:outline-none focus:ring-1 focus:ring-slate-800 text-slate-900"
                  />
                  <button
                    type="submit"
                    disabled={!newNote.trim()}
                    className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded hover:bg-slate-800 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    Add Note
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Select or create an investigation case.
            </div>
          )}
        </div>
      </div>

      {/* New Case Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg border border-slate-300 shadow-xl max-w-2xl max-h-[90vh] w-full p-6 overflow-y-auto">
            <h3 className="text-base font-bold text-slate-900 mb-4">Create New Case Investigation</h3>
            <form onSubmit={handleCreateCase} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Case Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g., Suspicious Vehicle BOLO - North Corridor"
                  className="w-full px-3 py-2 border border-slate-300 rounded text-slate-900"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Target Plate Number</label>
                <input
                  type="text"
                  value={newTargetPlate}
                  onChange={(e) => setNewTargetPlate(e.target.value)}
                  placeholder="Enter target plate"
                  className="w-full px-3 py-2 border border-slate-300 rounded font-mono uppercase text-slate-900"
                />
              </div>

              <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <h4 className="font-semibold text-slate-800">Investigation search scope</h4>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">A centre, radius and complete time window are required before camera discovery can run. Cases can still be saved without them for historic record review.</p>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <label className="space-y-1">
                    <span className="block font-semibold text-slate-700">Centre latitude</span>
                    <input type="number" min="-90" max="90" step="any" value={searchCenterLat} onChange={(event) => setSearchCenterLat(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-slate-900" placeholder="e.g. 28.6139"/>
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold text-slate-700">Centre longitude</span>
                    <input type="number" min="-180" max="180" step="any" value={searchCenterLon} onChange={(event) => setSearchCenterLon(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-slate-900" placeholder="e.g. 77.2090"/>
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold text-slate-700">Search radius (km)</span>
                    <input type="number" min="1" max="100" step="1" value={searchRadiusKm} onChange={(event) => setSearchRadiusKm(event.target.value)} className="w-full rounded border border-slate-300 px-3 py-2 text-slate-900"/>
                  </label>
                  <div className="space-y-1">
                    <span className="block font-semibold text-slate-700">Country scope</span>
                    <div className="rounded border border-slate-200 bg-white px-3 py-2 text-slate-700">India</div>
                  </div>
                  <label className="space-y-1">
                    <span className="block font-semibold text-slate-700">From</span>
                    <input type="datetime-local" value={searchStartAt} onChange={(event) => setSearchStartAt(event.target.value)} className="w-full rounded border border-slate-300 px-2 py-2 text-slate-900"/>
                  </label>
                  <label className="space-y-1">
                    <span className="block font-semibold text-slate-700">To</span>
                    <input type="datetime-local" value={searchEndAt} onChange={(event) => setSearchEndAt(event.target.value)} className="w-full rounded border border-slate-300 px-2 py-2 text-slate-900"/>
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Priority</label>
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL")}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-slate-900 font-semibold"
                  >
                    <option value="LOW">LOW</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="HIGH">HIGH</option>
                    <option value="CRITICAL">CRITICAL</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Assigned Officer</label>
                  <input
                    type="text"
                    value={newOfficer}
                    onChange={(e) => setNewOfficer(e.target.value)}
                    className="w-full px-3 py-2 border border-slate-300 rounded text-slate-900"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Description / Brief</label>
                <textarea
                  rows={3}
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Initial incident context, camera sightings, or investigation brief..."
                  className="w-full px-3 py-2 border border-slate-300 rounded text-slate-900"
                />
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 border border-slate-300 rounded text-slate-700 font-semibold hover:bg-slate-100"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-slate-900 text-white rounded font-semibold hover:bg-slate-800"
                >
                  Create Case
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

