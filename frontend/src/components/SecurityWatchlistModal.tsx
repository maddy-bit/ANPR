"use client";

import { useEffect, useState } from "react";
import { getSecurityAlerts, getWatchlist, addWatchlistEntry, type SecurityAlertDto } from "@/lib/api";

export function SecurityWatchlistModal() {
  const [alerts, setAlerts] = useState<SecurityAlertDto[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [alertsError, setAlertsError] = useState<string | null>(null);

  const [watchlist, setWatchlist] = useState<{ plateNumber: string; reason: string; severity: string }[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(true);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"alerts" | "watchlist">("alerts");
  const [showAddForm, setShowAddForm] = useState(false);

  // Form states
  const [newPlate, setNewPlate] = useState("");
  const [newReason, setNewReason] = useState("HIGH_VALUE_STOLEN_VEHICLE");
  const [newSeverity, setNewSeverity] = useState<"LOW" | "MEDIUM" | "HIGH" | "CRITICAL">("CRITICAL");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getSecurityAlerts()
      .then((data) => {
        if (!cancelled) {
          setAlerts(data);
          setAlertsLoading(false);
          setAlertsError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAlerts([]);
          setAlertsLoading(false);
          setAlertsError(err instanceof Error ? err.message : "Security alert service unavailable");
        }
      });

    getWatchlist()
      .then((data) => {
        if (!cancelled) {
          setWatchlist(data);
          setWatchlistLoading(false);
          setWatchlistError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setWatchlist([]);
          setWatchlistLoading(false);
          setWatchlistError(err instanceof Error ? err.message : "Watchlist service unavailable");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    if (!newPlate.trim()) return;

    setIsSubmitting(true);
    setAddError(null);
    const formattedPlate = newPlate.toUpperCase().replace(/\s+/g, "");

    try {
      const added = await addWatchlistEntry({
        plateNumber: formattedPlate,
        reason: newReason,
        severity: newSeverity,
      });

      setWatchlist((prev) => [added, ...prev]);
      setNewPlate("");
      setShowAddForm(false);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to register target plate with service");
    } finally {
      setIsSubmitting(false);
    }
  }

  const getSeverityBadge = (severity: string) => {
    switch (severity?.toUpperCase()) {
      case "CRITICAL":
        return "bg-rose-100 border-rose-300 text-rose-800 font-black";
      case "HIGH":
        return "bg-amber-100 border-amber-300 text-amber-800 font-bold";
      case "MEDIUM":
        return "bg-sky-100 border-sky-300 text-sky-800 font-bold";
      default:
        return "bg-slate-100 border-slate-300 text-slate-700 font-semibold";
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200/90 bg-white/95 p-4 backdrop-blur-md shadow-xs">
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
          <h2 className="text-xs font-mono font-extrabold uppercase tracking-wider text-slate-900">
            Watchlist & Security Alerts
          </h2>
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-slate-100 p-1 border border-slate-200 shadow-xs">
          <button
            type="button"
            onClick={() => setActiveTab("alerts")}
            className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "alerts"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
            }`}
          >
            Alerts ({alertsLoading ? "â€¦" : alerts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("watchlist")}
            className={`px-2.5 py-1 text-[11px] font-mono font-bold rounded-lg transition-all cursor-pointer ${
              activeTab === "watchlist"
                ? "bg-sky-600 text-white shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-200"
            }`}
          >
            Watchlist ({watchlistLoading ? "â€¦" : watchlist.length})
          </button>
        </div>
      </div>

      <div className="mt-3 max-h-56 overflow-y-auto pr-1">
        {activeTab === "alerts" ? (
          alertsLoading ? (
            <div className="py-4 text-center text-xs font-mono text-slate-500">
              Loading alert recordsâ€¦
            </div>
          ) : alertsError ? (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-mono">
              <div className="font-bold flex items-center gap-1.5 mb-1">
                <span>âš </span>
                <span>Security Alerts Service Unavailable</span>
              </div>
              <p className="text-[11px] text-amber-800">{alertsError}</p>
            </div>
          ) : alerts.length === 0 ? (
            <p className="text-xs text-slate-500 italic py-2">No alert records were returned by the service.</p>
          ) : (
            alerts.map((a, idx) => (
              <div key={a.alertId || idx} className="mb-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3 text-xs shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="font-mono font-extrabold text-slate-900">{a.alertType}</span>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono ${getSeverityBadge(a.severity)}`}>
                    {a.severity}
                  </span>
                </div>
                <p className="mt-1.5 text-slate-700 font-medium leading-snug">{a.description}</p>
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500 font-mono border-t border-slate-200/80 pt-1.5">
                  <span>Plate: <strong className="text-slate-900 font-bold">{a.plateNumber}</strong></span>
                  <span>Camera: <strong className="text-slate-900 font-bold">{a.cameraId}</strong></span>
                </div>
              </div>
            ))
          )
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Registered Targets</span>
              <button
                type="button"
                onClick={() => {
                  setShowAddForm(!showAddForm);
                  setAddError(null);
                }}
                className="rounded-lg bg-sky-50 px-2 py-0.5 text-[10px] font-bold text-sky-700 border border-sky-200 hover:bg-sky-100 transition-all cursor-pointer"
              >
                {showAddForm ? "Cancel" : "+ Add Target Plate"}
              </button>
            </div>

            {showAddForm && (
              <form onSubmit={handleAddEntry} className="rounded-xl border border-slate-200 bg-white p-3 text-xs space-y-2 shadow-xs">
                {addError && (
                  <div className="rounded-lg border border-rose-300 bg-rose-50 p-2 text-[11px] font-mono text-rose-800">
                    âš  {addError}
                  </div>
                )}
                <div>
                  <input
                    type="text"
                    required
                    placeholder="Enter registration plate"
                    value={newPlate}
                    onChange={(e) => setNewPlate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 p-2 font-mono text-xs text-slate-900 uppercase focus:border-sky-500 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newReason}
                    onChange={(e) => setNewReason(e.target.value)}
                    className="rounded-lg border border-slate-300 bg-slate-50 p-1.5 text-[11px] text-slate-800"
                  >
                    <option value="HIGH_VALUE_STOLEN_VEHICLE">Stolen Vehicle</option>
                    <option value="SUSPECT_OF_INTEREST">Suspect of Interest</option>
                    <option value="UNAUTHORIZED_EXPRESSWAY_ACCESS">Unauthorized Access</option>
                    <option value="CLONED_PLATE_ALERT">Cloned Plate Suspect</option>
                  </select>
                  <select
                    value={newSeverity}
                    onChange={(e) => setNewSeverity(e.target.value as "CRITICAL" | "HIGH" | "MEDIUM" | "LOW")}
                    className="rounded-lg border border-slate-300 bg-slate-50 p-1.5 text-[11px] text-rose-700 font-bold"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full rounded-lg bg-sky-600 py-1.5 text-xs font-bold text-white hover:bg-sky-700 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                >
                  {isSubmitting ? "Registering Targetâ€¦" : "Register Watchlist Target"}
                </button>
              </form>
            )}

            {watchlistLoading ? (
              <div className="py-4 text-center text-xs font-mono text-slate-500">
                Fetching registered target listâ€¦
              </div>
            ) : watchlistError ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 font-mono">
                <div className="font-bold flex items-center gap-1.5 mb-1">
                  <span>âš </span>
                  <span>Watchlist Service Unavailable</span>
                </div>
                <p className="text-[11px] text-amber-800">{watchlistError}</p>
              </div>
            ) : watchlist.length === 0 ? (
              <p className="text-xs text-slate-500 italic py-2">No watchlisted plates registered.</p>
            ) : (
              watchlist.map((w, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-xl bg-slate-50 p-2.5 text-xs border border-slate-200 shadow-xs">
                  <span className="font-mono font-black text-slate-900">{w.plateNumber}</span>
                  <span className="text-slate-600 text-[11px] font-medium">{w.reason}</span>
                  <span className={`rounded-md border px-2 py-0.5 text-[10px] font-mono ${getSeverityBadge(w.severity)}`}>
                    {w.severity}
                  </span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

