"use client";

import { useState, useEffect } from "react";
import { TiltCard3D } from "./TiltCard3D";
import { getRecentVehicles, type VehicleDto } from "@/lib/api";

export type SearchMode = "historical" | "live" | "combined";

interface VehicleSearchPanelProps {
  onSearch: (plate: string, mode: SearchMode) => void;
  isSearching: boolean;
}

const MODES: { value: SearchMode; label: string; desc: string }[] = [
  { value: "historical", label: "Historic", desc: "Stored SIH records" },
  { value: "live", label: "Live", desc: "Available live sources" },
  { value: "combined", label: "Hybrid", desc: "Stored + incoming" },
];

export function VehicleSearchPanel({ onSearch, isSearching }: VehicleSearchPanelProps) {
  const [plate, setPlate] = useState("");
  const [mode, setMode] = useState<SearchMode>("historical");
  const [recentVehicles, setRecentVehicles] = useState<VehicleDto[]>([]);
  const [isLoadingRecent, setIsLoadingRecent] = useState(true);
  const [recentError, setRecentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRecentVehicles()
      .then((vehicles) => {
        if (!cancelled) {
          setRecentVehicles(vehicles);
          setIsLoadingRecent(false);
          setRecentError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setRecentVehicles([]);
          setIsLoadingRecent(false);
          setRecentError(err instanceof Error ? err.message : "Target registry unreachable");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!plate.trim()) return;
    onSearch(plate.trim(), mode);
  }

  function handleSelectRecentPlate(selectedPlate: string) {
    setPlate(selectedPlate);
    onSearch(selectedPlate, mode);
  }

  return (
    <TiltCard3D>
      <form
        onSubmit={handleSubmit}
        className="neo-box overflow-hidden"
      >
        {/* Dedicated Box Header Strip */}
        <div className="neo-header">
          <h2 className="text-sm sm:text-base font-bold uppercase tracking-wide text-slate-950 whitespace-nowrap">
            Target Search
          </h2>
          <span className="text-xs font-mono font-bold text-slate-800 shrink-0">ANPR</span>
        </div>

        <div className="p-4 space-y-3.5">
          <div>
            <label className="block text-xs font-mono font-bold uppercase tracking-wider text-slate-800 mb-1.5">
              Registration Plate Number
            </label>

            {/* High-Contrast Indian HSRP Plate Frame */}
            <div className="plate-box relative flex items-center overflow-hidden rounded-md border-2 border-slate-500 bg-white focus-within:border-slate-900 transition-all">
              {/* IND Blue Badge */}
              <div className="relative flex flex-col items-center justify-center bg-[#1e3a8a] px-3 py-2 text-white select-none border-r-2 border-slate-500 shrink-0">
                <span className="text-[10px] font-black tracking-tighter leading-none text-white">IND</span>
                <div className="my-0.5 h-2.5 w-2.5 rounded-full border border-white flex items-center justify-center bg-blue-950">
                  <div className="h-1 w-1 rounded-full bg-white" />
                </div>
                <span className="text-[7px] font-mono font-bold text-blue-100 leading-none">HSRP</span>
              </div>

              {/* Input with JetBrains Mono */}
              <input
                value={plate}
                onChange={(e) => setPlate(e.target.value.toUpperCase())}
                placeholder="ENTER VEHICLE NUMBER"
                spellCheck={false}
                className="w-full bg-transparent px-3 py-2 font-mono text-base sm:text-lg font-bold tracking-widest text-slate-950 placeholder-slate-400 outline-none uppercase min-w-0"
              />

              {/* Security Hologram & Clear Button */}
              <div className="flex items-center gap-1.5 pr-2.5 shrink-0">
                <div
                  title="HSRP Security Chip"
                  className="hidden sm:flex h-6 w-6 rounded-xs items-center justify-center bg-amber-400 text-xs border border-amber-500 font-bold select-none text-slate-950"
                >
                  🇮🇳
                </div>
                {plate && (
                  <button
                    type="button"
                    onClick={() => setPlate("")}
                    className="rounded-xs p-1 text-sm font-bold text-slate-600 hover:text-slate-950 hover:bg-slate-200 transition-colors cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Genuinely Ingested Target Plates (or Honest Empty State) */}
          <div>
            <div className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800 mb-1.5 flex items-center justify-between">
              <span>Recently Detected Targets:</span>
              <span className="text-[10px] text-slate-500 font-normal">
                {recentVehicles.length > 0 ? `${recentVehicles.length} persisted` : "0 in database"}
              </span>
            </div>

            {isLoadingRecent ? (
              <div className="p-3 text-center font-mono text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-md">
                Checking database for detected targets...
              </div>
            ) : recentError ? (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-center text-xs text-amber-900 font-mono">
                <span className="font-bold">⚠ Target registry unavailable</span>
                <p className="text-[10px] text-amber-800 mt-0.5">{recentError}</p>
              </div>
            ) : recentVehicles.length > 0 ? (
              <div className="flex flex-col gap-1.5 max-h-36 overflow-y-auto">
                {recentVehicles.map((v) => (
                  <button
                    key={v.plate}
                    type="button"
                    onClick={() => handleSelectRecentPlate(v.plate)}
                    className={`group flex items-center justify-between rounded-md border px-3 py-1.5 text-left transition-all cursor-pointer ${
                      plate === v.plate
                        ? "border-slate-800 bg-slate-100 text-slate-950 font-bold"
                        : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 hover:border-slate-400 font-semibold"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-mono font-bold text-slate-950 text-xs sm:text-sm shrink-0">
                        {v.plate}
                      </span>
                      <span className="text-[11px] text-slate-600 truncate">
                        {[v.color, v.vehicleType || v.make].filter(Boolean).join(" ") || "Detected Vehicle"}
                      </span>
                    </div>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-xs bg-slate-200 text-slate-800 border border-slate-300 font-bold uppercase shrink-0 ml-1.5">
                      DETECTED
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed border-slate-300 bg-slate-50/80 p-3 text-center">
                <p className="text-xs font-mono text-slate-600 font-medium">
                  No vehicles detected in database yet.
                </p>
                <p className="text-[10px] font-mono text-slate-500 mt-1">
                  Upload traffic footage using &ldquo;Ingest Video Feed&rdquo; to detect and track targets.
                </p>
              </div>
            )}
          </div>

          {/* Tracking Mode */}
          <div>
            <div className="text-xs font-mono font-bold uppercase tracking-wider text-slate-800 mb-1.5">
              Reconstruction Mode:
            </div>
            <div className="grid grid-cols-3 gap-2">
              {MODES.map((m) => (
                <button
                  key={m.value}
                  type="button"
                  onClick={() => setMode(m.value)}
                  className={`h-11 sm:h-12 flex flex-col items-center justify-center rounded-md border px-1.5 py-1 text-center transition-all cursor-pointer ${
                    mode === m.value
                      ? "border-slate-900 bg-slate-900 text-white font-bold"
                      : "border-slate-300 bg-white text-slate-900 hover:bg-slate-50 hover:border-slate-400 font-semibold"
                  }`}
                >
                  <span className="text-xs sm:text-sm font-bold tracking-tight leading-tight truncate max-w-full">
                    {m.label}
                  </span>
                  <span className={`text-[9px] font-mono font-semibold leading-tight truncate max-w-full mt-0.5 ${mode === m.value ? "text-slate-200" : "text-slate-600"}`}>
                    {m.desc}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Tactical Popped-Up Push Button */}
          <button
            type="submit"
            disabled={isSearching || !plate.trim()}
            className="neo-btn mt-1 flex w-full items-center justify-center gap-2 py-3 sm:py-3.5 text-xs sm:text-sm font-bold uppercase tracking-wider cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSearching ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                <span>Scanning Sensor Mesh…</span>
              </>
            ) : (
              <>
                <span>Search investigation</span>
              </>
            )}
          </button>
        </div>
      </form>
    </TiltCard3D>
  );
}
