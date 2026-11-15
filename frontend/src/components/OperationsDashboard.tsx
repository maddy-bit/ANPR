"use client";

import React, { useState, useEffect, useCallback } from "react";
import { getDetailedSystemHealth, SystemDetailedHealthDto } from "@/lib/api";

export function OperationsDashboard() {
  const [health, setHealth] = useState<SystemDetailedHealthDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastCheck, setLastCheck] = useState<string>("");

  const loadHealth = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getDetailedSystemHealth();
      setHealth(data);
      setLastCheck(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Failed to load operations health", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = setTimeout(() => { void loadHealth(); }, 0);
    const interval = setInterval(() => { void loadHealth(); }, 10000);
    return () => {
      clearTimeout(initialLoad);
      clearInterval(interval);
    };
  }, [loadHealth]);

  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-4.5rem)] bg-slate-50 p-4 sm:p-6 overflow-y-auto">
      <div className="max-w-6xl w-full mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between bg-white p-5 rounded-lg border border-slate-300 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-slate-900 text-white flex items-center justify-center text-xl">
              ⚙️
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900 uppercase tracking-wider">
                System Operations & Cluster Telemetry
              </h2>
              <p className="text-xs text-slate-500">
                Real-time service health, transaction throughput & memory allocations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs font-mono text-slate-500">
              Last check: {lastCheck || "Querying..."}
            </span>
            <button
              type="button"
              onClick={loadHealth}
              disabled={loading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-300 rounded text-xs font-semibold cursor-pointer transition-colors"
            >
              {loading ? "Checking..." : "↻ Refresh"}
            </button>
          </div>
        </div>

        {/* Status Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1: Node.js Backend */}
          <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
              <span>NODE.JS BACKEND</span>
              <span className="text-emerald-600 font-bold">ONLINE</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {health ? `${Math.floor(health.uptimeSeconds / 60)}m ${health.uptimeSeconds % 60}s` : "--"}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">Process Uptime</p>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
              Heap: {health?.memory?.heapUsedMb || 0} MB / {health?.memory?.heapTotalMb || 0} MB
            </div>
          </div>

          {/* Card 2: PostgreSQL / PostGIS */}
          <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
              <span>POSTGRES / POSTGIS</span>
              <span className={`font-bold ${health?.database?.ok ? "text-emerald-600" : "text-red-600"}`}>
                {health?.database?.ok ? "CONNECTED" : "OFFLINE"}
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {health?.database?.latencyMs != null ? `${health.database.latencyMs} ms` : "--"}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">Query Latency (127.0.0.1:5432)</p>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
              Database: cityaidb
            </div>
          </div>

          {/* Card 3: Redis 7 Streams */}
          <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
              <span>REDIS 7 (STREAMS/AOF)</span>
              <span className="text-emerald-600 font-bold">{health?.redis?.status || "STANDBY"}</span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {health?.redis?.status === "UP" ? "ACTIVE" : "STANDALONE"}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">Stream & Rate Limit Broker</p>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600">
              Port: 6379 (Loopback)
            </div>
          </div>

          {/* Card 4: Python AI Service */}
          <div className="bg-white p-4 rounded-lg border border-slate-300 shadow-sm">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-2">
              <span>AI FASTAPI SERVICE</span>
              <span className={`font-bold ${health?.aiService?.status === "UP" ? "text-emerald-600" : "text-slate-400"}`}>
                {health?.aiService?.status || "STANDBY"}
              </span>
            </div>
            <div className="text-2xl font-bold font-mono text-slate-900">
              {health?.aiService?.status === "UP" ? "ONLINE" : "OFFLINE"}
            </div>
            <p className="text-[11px] text-slate-400 mt-1 font-mono">YOLOv8 + ByteTrack + OCR</p>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-600 truncate">
              {health?.aiService?.url || "http://localhost:8000"}
            </div>
          </div>
        </div>

        {/* Video Processing Pipeline Stats */}
        <div className="bg-white p-6 rounded-lg border border-slate-300 shadow-sm">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 mb-4">
            Video Processing Runs & Outbox Queue
          </h3>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="p-4 bg-slate-50 rounded border border-slate-200">
              <span className="text-slate-400 text-xs block font-mono">QUEUED</span>
              <span className="text-2xl font-bold font-mono text-slate-700">
                {health?.processingRuns?.queued || 0}
              </span>
            </div>
            <div className="p-4 bg-blue-50 rounded border border-blue-200">
              <span className="text-blue-600 text-xs block font-mono">IN PROGRESS</span>
              <span className="text-2xl font-bold font-mono text-blue-800">
                {health?.processingRuns?.running || 0}
              </span>
            </div>
            <div className="p-4 bg-emerald-50 rounded border border-emerald-200">
              <span className="text-emerald-600 text-xs block font-mono">COMPLETED</span>
              <span className="text-2xl font-bold font-mono text-emerald-800">
                {health?.processingRuns?.completed || 0}
              </span>
            </div>
            <div className="p-4 bg-red-50 rounded border border-red-200">
              <span className="text-red-600 text-xs block font-mono">FAILED</span>
              <span className="text-2xl font-bold font-mono text-red-800">
                {health?.processingRuns?.failed || 0}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
