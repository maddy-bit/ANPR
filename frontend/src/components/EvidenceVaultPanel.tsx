"use client";

import React, { useState, useEffect } from "react";
import { listEvidence, verifyEvidenceIntegrity, EvidenceItemDto } from "@/lib/api";

export function EvidenceVaultPanel() {
  const [evidenceList, setEvidenceList] = useState<EvidenceItemDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verificationResults, setVerificationResults] = useState<Record<number, { verified: boolean; message: string }>>({});

  const loadEvidence = async () => {
    setLoading(true);
    try {
      const data = await listEvidence(50, 0);
      setEvidenceList(data.evidence || []);
    } catch (err) {
      console.error("Failed to load evidence vault", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadEvidence();
  }, []);

  const handleVerify = async (id: number) => {
    setVerifyingId(id);
    try {
      const result = await verifyEvidenceIntegrity(id);
      setVerificationResults((prev) => ({
        ...prev,
        [id]: { verified: result.verified, message: result.message },
      }));
    } catch (err: unknown) {
      setVerificationResults((prev) => ({
        ...prev,
        [id]: { verified: false, message: err instanceof Error ? err.message : "Verification failed" },
      }));
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-4.5rem)] bg-slate-50 p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col flex-1 max-w-7xl w-full mx-auto bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="p-5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-amber-500/20 border border-amber-400/40 flex items-center justify-center text-xl">
              🔒
            </div>
            <div>
              <h2 className="text-base font-bold uppercase tracking-wider">Evidence Integrity Vault</h2>
              <p className="text-xs text-slate-300">
                Cryptographic file integrity verification with SHA-256 artifact checksum auditing
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={loadEvidence}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white border border-slate-600 rounded text-xs font-semibold cursor-pointer transition-colors"
          >
            {loading ? "Refreshing..." : "↻ Refresh Vault"}
          </button>
        </div>

        {/* Evidence Table */}
        <div className="flex-1 overflow-y-auto">
          {evidenceList.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-sm">
              <span className="text-3xl block mb-2">📁</span>
              No detection evidence records found in the vault. Upload and process video runs to register forensic artifacts.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                    <th className="p-3 font-mono">ID</th>
                    <th className="p-3">Camera</th>
                    <th className="p-3">Plate</th>
                    <th className="p-3">Class</th>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">SHA-256 Cryptographic Hash</th>
                    <th className="p-3 text-right">Integrity Audit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {evidenceList.map((item) => {
                    const result = verificationResults[item.id];
                    const isVerifying = verifyingId === item.id;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-bold text-slate-600">#{item.id}</td>
                        <td className="p-3">
                          <span className="font-semibold text-slate-900 block">{item.cameraName}</span>
                          <span className="text-[10px] text-slate-400 font-mono">{item.cameraId}</span>
                        </td>
                        <td className="p-3 font-mono font-bold text-slate-900 text-sm">
                          {item.plateText || "UNREADABLE"}
                        </td>
                        <td className="p-3 text-slate-700">{item.vehicleClass || "Unknown"}</td>
                        <td className="p-3 font-mono text-slate-600">
                          {item.timestamp ? new Date(item.timestamp).toLocaleString() : "-"}
                        </td>
                        <td className="p-3">
                          <span className="font-mono text-[11px] bg-slate-100 px-2 py-1 rounded text-slate-700 border border-slate-200 select-all block max-w-xs truncate">
                            {item.evidenceHash}
                          </span>
                        </td>
                        <td className="p-3 text-right">
                          {result ? (
                            <span
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-bold ${
                                result.verified
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                  : "bg-red-100 text-red-800 border border-red-300"
                              }`}
                            >
                              <span>{result.verified ? "✓" : "⚠"}</span>
                              <span>{result.verified ? "HASH VERIFIED" : "MISMATCH"}</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleVerify(item.id)}
                              disabled={isVerifying}
                              className="px-3 py-1 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 rounded font-semibold text-xs shadow-2xs transition-colors cursor-pointer"
                            >
                              {isVerifying ? "Verifying..." : "Verify Hash"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
