"use client";

import type { TrajectoryQualityDto } from "@/lib/api";

interface TrajectoryQualityPanelProps {
  quality: TrajectoryQualityDto;
}

export function TrajectoryQualityPanel({ quality }: TrajectoryQualityPanelProps) {
  const { overallQuality, summary, dimensions, counts, supportingEvidence, missingEvidence, warningsAndContradictions } = quality;

  const categoryConfig: Record<
    string,
    { label: string; bg: string; text: string; border: string; icon: string; desc: string }
  > = {
    HIGH_CONFIDENCE: {
      label: "HIGH CONFIDENCE",
      bg: "bg-emerald-50 text-emerald-950",
      text: "text-emerald-700",
      border: "border-emerald-500",
      icon: "🛡️",
      desc: "Corroborated multi-camera trajectory verified against calibrated road network topology.",
    },
    MEDIUM_CONFIDENCE: {
      label: "MEDIUM CONFIDENCE",
      bg: "bg-amber-50 text-amber-950",
      text: "text-amber-700",
      border: "border-amber-500",
      icon: "⚖️",
      desc: "Physically feasible multi-camera trajectory; corridor links rely on unverified geodesic approximations.",
    },
    LOW_CONFIDENCE: {
      label: "LOW CONFIDENCE",
      bg: "bg-rose-50 text-rose-950",
      text: "text-rose-700",
      border: "border-rose-500",
      icon: "⚠️",
      desc: "Critical evidence contradictions, impossible speed transitions, or active identity conflicts detected.",
    },
    INSUFFICIENT_EVIDENCE: {
      label: "INSUFFICIENT EVIDENCE",
      bg: "bg-slate-100 text-slate-900",
      text: "text-slate-600",
      border: "border-slate-400",
      icon: "❓",
      desc: "Single-camera observation or missing critical telemetry; trajectory cannot be confirmed across cameras.",
    },
  };

  const currentConfig = categoryConfig[overallQuality] || categoryConfig.INSUFFICIENT_EVIDENCE;

  return (
    <div className="flex flex-col gap-4 rounded-md border border-slate-300 bg-white p-4 font-mono text-xs shadow-xs">
      {/* Category Header Card */}
      <div className={`flex flex-col gap-2 rounded-md border-2 p-3 ${currentConfig.border} ${currentConfig.bg}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-xl">{currentConfig.icon}</span>
            <span className="text-sm font-bold uppercase tracking-wider">{currentConfig.label}</span>
          </div>
          <span className="text-[10px] uppercase font-bold text-slate-500 bg-white/70 px-2 py-0.5 rounded-xs border border-slate-300">
            EVIDENCE-BACKED RATING
          </span>
        </div>

        <p className="text-xs leading-relaxed text-slate-800">{summary}</p>

        {/* Statistical Probability Disclaimer Banner */}
        <div className="mt-1 flex items-center gap-1.5 rounded-xs bg-white/90 px-2 py-1 text-[10px] text-slate-600 border border-slate-200">
          <span className="font-bold text-slate-700">Notice:</span>
          <span>
            Ratings represent evidence quality and verification rigor, NOT statistical probabilities.
          </span>
        </div>
      </div>

      {/* Metrics & Transition Counts Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="flex flex-col rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
          <span className="text-[10px] text-slate-500 uppercase">Confirmed Sightings</span>
          <span className="text-base font-bold text-slate-900">{counts.confirmedObservations}</span>
          <span className="text-[9px] text-slate-400">({counts.excludedObservations} excluded)</span>
        </div>

        <div className="flex flex-col rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
          <span className="text-[10px] text-slate-500 uppercase">Distinct Cameras</span>
          <span className="text-base font-bold text-slate-900">{counts.distinctCameraCount}</span>
          <span className="text-[9px] text-slate-400">
            {counts.distinctCameraCount >= 2 ? "Cross-camera confirmed" : "Single camera only"}
          </span>
        </div>

        <div className="flex flex-col rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
          <span className="text-[10px] text-slate-500 uppercase">Verified Road Edges</span>
          <span className="text-base font-bold text-emerald-700">{counts.verifiedRoadTransitions}</span>
          <span className="text-[9px] text-slate-400">({counts.unverifiedGeodesicTransitions} unverified)</span>
        </div>

        <div className="flex flex-col rounded-md border border-slate-200 bg-slate-50 p-2 text-center">
          <span className="text-[10px] text-slate-500 uppercase">Impossible Transits</span>
          <span className={`text-base font-bold ${counts.impossibleTransitions > 0 ? "text-rose-600" : "text-slate-900"}`}>
            {counts.impossibleTransitions}
          </span>
          <span className="text-[9px] text-slate-400">({counts.feasibleTransitions} feasible)</span>
        </div>
      </div>

      {/* The 6 Explicit Quality Dimensions */}
      <div className="flex flex-col gap-2">
        <div className="text-[11px] font-bold uppercase tracking-wider text-slate-700">
          Multidimensional Evidence Audit (6 Dimensions)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px]">
          {/* Dimension 1: identityMembership */}
          <div data-testid="dimension-identityMembership" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">1. Identity Membership</span>
              <span data-testid="status-identityMembership" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.identityMembership.status === "CONFIRMED"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : dimensions.identityMembership.status === "CONFLICTED"
                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}>
                {dimensions.identityMembership.status}
              </span>
            </div>
            <p data-testid="summary-identityMembership" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.identityMembership.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Confirmed: {dimensions.identityMembership.confirmedCount} | Excluded: {dimensions.identityMembership.excludedCount}
            </div>
          </div>

          {/* Dimension 2: detectionConfidence */}
          <div data-testid="dimension-detectionConfidence" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">2. Detection Confidence</span>
              <span data-testid="status-detectionConfidence" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.detectionConfidence.status === "HIGH"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : dimensions.detectionConfidence.status === "ACCEPTABLE"
                  ? "bg-sky-100 text-sky-800 border border-sky-300"
                  : "bg-rose-100 text-rose-800 border border-rose-300"
              }`}>
                {dimensions.detectionConfidence.status}
              </span>
            </div>
            <p data-testid="summary-detectionConfidence" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.detectionConfidence.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Avg: {dimensions.detectionConfidence.avgConfidence != null ? (dimensions.detectionConfidence.avgConfidence * 100).toFixed(1) + "%" : "N/A"} | Low Conf Count: {dimensions.detectionConfidence.lowConfidenceCount}
            </div>
          </div>

          {/* Dimension 3: ocrAndPlateConsistency */}
          <div data-testid="dimension-ocrAndPlateConsistency" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">3. OCR & Plate Consistency</span>
              <span data-testid="status-ocrAndPlateConsistency" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.ocrAndPlateConsistency.status === "CONSISTENT"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : dimensions.ocrAndPlateConsistency.status === "CONTRADICTORY"
                  ? "bg-rose-100 text-rose-800 border border-rose-300"
                  : "bg-slate-200 text-slate-800 border border-slate-300"
              }`}>
                {dimensions.ocrAndPlateConsistency.status}
              </span>
            </div>
            <p data-testid="summary-ocrAndPlateConsistency" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.ocrAndPlateConsistency.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Plates: {dimensions.ocrAndPlateConsistency.platesSeen?.length ? dimensions.ocrAndPlateConsistency.platesSeen.join(", ") : "None"} | Avg Conf: {dimensions.ocrAndPlateConsistency.avgPlateConfidence != null ? (dimensions.ocrAndPlateConsistency.avgPlateConfidence * 100).toFixed(1) + "%" : "N/A"}
            </div>
          </div>

          {/* Dimension 4: reidSimilarity */}
          <div data-testid="dimension-reidSimilarity" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">4. Re-ID Similarity</span>
              <span data-testid="status-reidSimilarity" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.reidSimilarity.status === "HIGH_SIMILARITY"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : dimensions.reidSimilarity.status === "MODERATE_SIMILARITY"
                  ? "bg-sky-100 text-sky-800 border border-sky-300"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}>
                {dimensions.reidSimilarity.status}
              </span>
            </div>
            <p data-testid="summary-reidSimilarity" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.reidSimilarity.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Model: {dimensions.reidSimilarity.modelName || "N/A"} | Avg Cosine: {dimensions.reidSimilarity.avgScore != null ? dimensions.reidSimilarity.avgScore.toFixed(3) : "N/A"}
            </div>
          </div>

          {/* Dimension 5: spatialTemporalFeasibility */}
          <div data-testid="dimension-spatialTemporalFeasibility" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">5. Spatial-Temporal Feasibility</span>
              <span data-testid="status-spatialTemporalFeasibility" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.spatialTemporalFeasibility.status === "VERIFIED_ROAD_NETWORK"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : dimensions.spatialTemporalFeasibility.status === "PLAUSIBLE_GEODESIC"
                  ? "bg-amber-100 text-amber-800 border border-amber-300"
                  : "bg-rose-100 text-rose-800 border border-rose-300"
              }`}>
                {dimensions.spatialTemporalFeasibility.status}
              </span>
            </div>
            <p data-testid="summary-spatialTemporalFeasibility" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.spatialTemporalFeasibility.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Verified Edges: {dimensions.spatialTemporalFeasibility.verifiedRoadEdges} | Unverified Geodesics: {dimensions.spatialTemporalFeasibility.unverifiedGeodesics} | Impossible: {dimensions.spatialTemporalFeasibility.impossibleTransitions}
            </div>
          </div>

          {/* Dimension 6: evidenceCompleteness */}
          <div data-testid="dimension-evidenceCompleteness" className="rounded-md border border-slate-200 bg-slate-50/60 p-2.5 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-slate-800">6. Evidence Completeness</span>
              <span data-testid="status-evidenceCompleteness" className={`px-1.5 py-0.5 rounded-xs text-[10px] font-bold ${
                dimensions.evidenceCompleteness.status === "COMPLETE"
                  ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  : "bg-amber-100 text-amber-800 border border-amber-300"
              }`}>
                {dimensions.evidenceCompleteness.status}
              </span>
            </div>
            <p data-testid="summary-evidenceCompleteness" className="text-slate-600 text-[10px] leading-tight">
              {dimensions.evidenceCompleteness.summary}
            </p>
            <div className="text-[9px] text-slate-400 mt-0.5">
              Missing Timestamps: {dimensions.evidenceCompleteness.missingTimestampsCount} | Coords: {dimensions.evidenceCompleteness.missingCoordinatesCount} | Re-ID: {dimensions.evidenceCompleteness.missingReidCount} | Plate: {dimensions.evidenceCompleteness.missingPlateCount}
            </div>
          </div>
        </div>
      </div>

      {/* Warnings & Contradictions Section */}
      {warningsAndContradictions.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-rose-300 bg-rose-50/80 p-3">
          <div className="flex items-center gap-1.5 font-bold text-rose-800 uppercase text-[11px]">
            <span>⚠️</span>
            <span>Warnings & Contradictions ({warningsAndContradictions.length})</span>
          </div>
          <ul className="flex flex-col gap-1 text-[11px] text-rose-900 list-disc list-inside">
            {warningsAndContradictions.map((warn, i) => (
              <li key={i} className="leading-tight">{warn}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Supporting Evidence List */}
      {supportingEvidence.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-emerald-300 bg-emerald-50/50 p-3">
          <div className="flex items-center gap-1.5 font-bold text-emerald-800 uppercase text-[11px]">
            <span>✓</span>
            <span>Supporting Corroborating Evidence ({supportingEvidence.length})</span>
          </div>
          <ul className="flex flex-col gap-1 text-[11px] text-emerald-900 list-disc list-inside">
            {supportingEvidence.map((sup, i) => (
              <li key={i} className="leading-tight">{sup}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Missing Evidence List */}
      {missingEvidence.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-300 bg-amber-50/50 p-3">
          <div className="flex items-center gap-1.5 font-bold text-amber-800 uppercase text-[11px]">
            <span>ℹ️</span>
            <span>Missing Evidence or Uncalibrated Corridors ({missingEvidence.length})</span>
          </div>
          <ul className="flex flex-col gap-1 text-[11px] text-amber-900 list-disc list-inside">
            {missingEvidence.map((miss, i) => (
              <li key={i} className="leading-tight">{miss}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

