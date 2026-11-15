"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import { sendAgentMessage, listInvestigations, getCameras, getInvestigationTrackingJob, AgentChatMessage, AgentChatResponse, InvestigationDto, InvestigationTrackingJobDto, TrajectoryPointDto, CameraDto } from "@/lib/api";
import Link from "next/link";
import { InvestigationMap } from "@/components/InvestigationMap";

const QUICK_PROMPTS = [
  "Track a specified vehicle plate across cameras",
  "Where was this vehicle last seen?",
  "Find sightings for a specified vehicle in the last 24 hours",
  "Which cameras are near this sighting?",
  "Summarize this vehicle investigation",
  "What is the processing status of current video runs?",
];

export function AgentInvestigationPanel() {
  const [messages, setMessages] = useState<AgentChatMessage[]>([
    {
      sender: "agent",
      text: "I can search recorded sightings for the selected investigation case, show its historical trajectory, and summarize the latest recorded location. Live camera processing is not enabled.",
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [activePlate, setActivePlate] = useState<string | undefined>();
  const [cases, setCases] = useState<InvestigationDto[]>([]);
  const [caseId, setCaseId] = useState("");
  const [caseListError, setCaseListError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trackingJob, setTrackingJob] = useState<InvestigationTrackingJobDto | null>(null);
  const [cameras, setCameras] = useState<CameraDto[]>([]);
  const [selectedPointIndex, setSelectedPointIndex] = useState<number | null>(null);
  const [replayToken, setReplayToken] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const controller = new AbortController();
    void listInvestigations(undefined, { signal: controller.signal })
      .then((items) => {
        setCases(items);
        const firstCase = items[0];
        setCaseId(firstCase?.id || "");
        setActivePlate(firstCase?.targetPlate || undefined);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) {
          setCaseListError(err instanceof Error ? err.message : "Unable to load investigation cases.");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void getCameras({ signal: controller.signal }).then(setCameras).catch(() => setCameras([]));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!trackingJob || !caseId || ["COMPLETED", "FAILED", "CANCELLED"].includes(trackingJob.status)) return;
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const latest = await getInvestigationTrackingJob(caseId, trackingJob.id, { signal: controller.signal });
        if (!controller.signal.aborted) setTrackingJob(latest);
        if (!controller.signal.aborted && !["COMPLETED", "FAILED", "CANCELLED"].includes(latest.status)) {
          timeout = setTimeout(poll, 3000);
        }
      } catch {
        if (!controller.signal.aborted) timeout = setTimeout(poll, 6000);
      }
    };
    timeout = setTimeout(poll, 1000);
    return () => {
      controller.abort();
      if (timeout) clearTimeout(timeout);
    };
  }, [trackingJob?.id, trackingJob?.status, caseId]);

  const mapPoints: TrajectoryPointDto[] = useMemo(() => {
    const observed = trackingJob?.result?.observedPoints || [];
    return observed.filter((point) => {
      const lat = Number(point.latitude);
      const lon = Number(point.longitude);
      return point.latitude != null && point.longitude != null && Number.isFinite(lat) && Number.isFinite(lon)
        && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    }).map((point) => ({
      cameraId: String(point.cameraId || "UNKNOWN"),
      cameraName: String(point.cameraName || point.cameraId || "Unknown camera"),
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      direction: null,
      timestamp: String(point.timestamp || ""),
      plateConfidence: null,
      detectionConfidence: typeof point.confidence === "number" ? point.confidence : null,
      imagePath: null,
      detectionCount: 1,
      incomingTransitionConfidence: null,
      transitionNote: "Persisted detection; association remains based on source OCR/provenance.",
    }));
  }, [trackingJob?.result?.observedPoints]);

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || input;
    if (!textToSend.trim() || loading) return;
    if (!caseId) {
      setError("Create or select an investigation case before searching vehicle records.");
      return;
    }

    setError(null);
    const userMsg: AgentChatMessage = {
      sender: "user",
      text: textToSend,
      timestamp: new Date().toLocaleTimeString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    if (!messageText) setInput("");
    setLoading(true);

    try {
      const response: AgentChatResponse = await sendAgentMessage(
        textToSend,
        conversationId,
        activePlate,
        caseId
      );

      if (response.conversationId) {
        setConversationId(response.conversationId);
      }
      if (response.plan?.targetPlate) {
        setActivePlate(response.plan.targetPlate);
      }
      const responseJob = response.structuredData?.job;
      if (responseJob && typeof responseJob === "object" && "id" in responseJob) {
        setTrackingJob(responseJob as InvestigationTrackingJobDto);
        setSelectedPointIndex(null);
      }

      const agentMsg: AgentChatMessage = {
        sender: "agent",
        text: response.reply,
        intent: response.intent,
        mode: response.mode,
        plan: response.plan,
        structuredData: response.structuredData,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, agentMsg]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to communicate with AI Investigation Agent.");
      const errorMsg: AgentChatMessage = {
        sender: "agent",
        text: "I encountered an error querying the intelligence backend. Please ensure the backend service is operational.",
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col h-[calc(100vh-4.5rem)] bg-slate-50 p-4 sm:p-6 overflow-hidden">
      <div className="flex flex-col flex-1 max-w-6xl w-full mx-auto bg-white rounded-lg border border-slate-300 shadow-sm overflow-hidden">
        {/* Agent Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 bg-slate-900 text-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-md bg-emerald-600 flex items-center justify-center text-xl font-bold">
              ðŸ¤–
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold tracking-tight">AI Vehicle Investigation Agent</h2>
                <span className="px-2 py-0.5 text-xs font-mono font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded">
                  ONLINE
                </span>
              </div>
              <p className="text-xs text-slate-300">
                Case-scoped investigation jobs
              </p>
            </div>
          </div>

          {activePlate && (
            <div className="flex items-center gap-2 bg-slate-800 px-3 py-1.5 rounded border border-slate-700">
              <span className="text-xs text-slate-400 font-mono">ACTIVE TARGET:</span>
              <span className="text-sm font-bold font-mono text-amber-300">{activePlate}</span>
              <button
                type="button"
                onClick={() => setActivePlate(undefined)}
                className="text-xs text-slate-400 hover:text-white ml-1 cursor-pointer"
                title="Clear active plate"
              >
                âœ•
              </button>
            </div>
          )}
        </div>

        {/* Quick Prompts Bar */}
        <div className="px-6 py-2.5 bg-slate-100 border-b border-slate-200 flex items-center gap-2 overflow-x-auto text-xs">
          <label htmlFor="agent-case" className="shrink-0 font-semibold text-slate-600">Investigation case</label>
          <select
            id="agent-case"
            value={caseId}
            onChange={(event) => {
              const nextCaseId = event.target.value;
              const selected = cases.find((item) => item.id === nextCaseId);
              setCaseId(nextCaseId);
              setActivePlate(selected?.targetPlate || undefined);
            }}
            disabled={cases.length === 0}
            className="max-w-64 rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-800 disabled:text-slate-400"
          >
            {cases.length === 0 ? <option value="">No cases available</option> : null}
            {cases.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} {item.targetPlate ? `Â· ${item.targetPlate}` : "Â· target required"}
              </option>
            ))}
          </select>
          {cases.length === 0 ? (
            <Link href="/cases" className="shrink-0 font-semibold text-blue-700 hover:underline">Create a case</Link>
          ) : null}
          {caseListError ? <span className="shrink-0 text-rose-700">{caseListError}</span> : null}
          <span className="font-semibold text-slate-500 uppercase tracking-wider shrink-0">
            Quick Inquiries:
          </span>
          {QUICK_PROMPTS.map((prompt, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSend(prompt)}
              className="px-2.5 py-1 rounded bg-white hover:bg-slate-200 border border-slate-300 text-slate-700 font-medium shrink-0 transition-colors cursor-pointer"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Message Log */}
        {trackingJob && (
          <section className="border-b border-slate-200 bg-slate-50 p-3" aria-label="Investigation tracking map">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-700">
              <span>Job {trackingJob.id} Â· {trackingJob.mode} Â· {trackingJob.status} Â· {Number(trackingJob.result?.observedPointCount) || mapPoints.length} observed detections Â· {mapPoints.length} mapped</span>
              {!["COMPLETED", "FAILED", "CANCELLED"].includes(trackingJob.status) && (
                <button type="button" className="rounded border border-slate-300 bg-white px-2 py-1" onClick={async () => {
                  const { cancelInvestigationTrackingJob } = await import("@/lib/api");
                  const cancelled = await cancelInvestigationTrackingJob(caseId, trackingJob.id);
                  setTrackingJob((current) => current ? { ...current, status: cancelled.status } : current);
                }}>Stop tracking</button>
              )}
              {trackingJob.result?.warnings?.length ? <span>{trackingJob.result.warnings.join(" ")}</span> : null}
              {trackingJob.result?.observedPointsTruncated ? <span>The map shows the newest 5,000 observations for this job.</span> : null}
            </div>
            <div className="max-h-[45vh] overflow-hidden rounded-lg">
              <InvestigationMap cameras={cameras} points={mapPoints} selectedIndex={selectedPointIndex}
                onSelectPoint={setSelectedPointIndex} replayToken={replayToken} />
            </div>
            {mapPoints.length > 1 ? <button type="button" className="mt-2 rounded border border-slate-300 bg-white px-2 py-1 text-xs" onClick={() => setReplayToken((value) => value + 1)}>Replay observed route</button> : null}
          </section>
        )}
        <div className="flex-1 p-6 overflow-y-auto space-y-4">
          {messages.map((msg, index) => (
            <div
              key={index}
              className={`flex flex-col ${
                msg.sender === "user" ? "items-end" : "items-start"
              }`}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-slate-500 font-mono">
                  {msg.sender === "user" ? "INVESTIGATOR" : "AI AGENT"}
                </span>
                <span className="text-[10px] text-slate-400">{msg.timestamp}</span>
                {msg.intent && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 border border-blue-200">
                    {msg.intent}
                  </span>
                )}
                {msg.mode && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200">
                    {msg.mode}
                  </span>
                )}
              </div>

              <div
                className={`max-w-3xl rounded-lg p-4 text-sm leading-relaxed ${
                  msg.sender === "user"
                    ? "bg-slate-900 text-white rounded-tr-none"
                    : "bg-slate-100 text-slate-800 border border-slate-300 rounded-tl-none shadow-xs"
                }`}
              >
                {/* Agent Plan Steps */}
                {msg.plan?.steps && msg.plan.steps.length > 0 && (
                  <div className="mb-3 p-2.5 rounded bg-white border border-slate-200 text-xs text-slate-700">
                    <div className="font-semibold text-slate-800 mb-1 flex items-center gap-1.5">
                      <span>âš™ï¸</span> Execution Plan:
                    </div>
                    <ul className="space-y-1 pl-4 list-decimal">
                      {msg.plan.steps.map((step, stepIndex) => (
                        <li key={`${step.tool}-${stepIndex}`}>
                          <span className="font-mono text-slate-600">{step.tool}</span>
                          {Object.keys(step.params || {}).length > 0 && (
                            <span className="ml-1 text-slate-500">{JSON.stringify(step.params)}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Primary Message Text */}
                <div className="whitespace-pre-wrap">{msg.text}</div>

                {/* Structured Data Visualization */}
                {msg.structuredData && (
                  <details className="mt-3 rounded border border-slate-200 bg-white p-2">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-700">
                      Evidence data Â· {msg.structuredData.type}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate-700">
                      {JSON.stringify(msg.structuredData, null, 2)}
                    </pre>
                  </details>
                )}

                {/* Follow-up suggestions */}
                {msg.followUps && msg.followUps.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-slate-200">
                    <span className="text-[11px] font-semibold text-slate-500 block mb-1.5">
                      Suggested Next Steps:
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {msg.followUps.map((action, aIdx) => (
                        <button
                          key={aIdx}
                          type="button"
                          onClick={() => handleSend(action)}
                          className="px-2 py-0.5 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-medium cursor-pointer"
                        >
                          â†’ {action}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-slate-500 text-xs p-2">
              <div className="animate-spin h-4 w-4 border-2 border-slate-400 border-t-transparent rounded-full" />
              <span>Searching case-scoped historical records...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {error && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}

        {/* Input Bar */}
        <div className="p-4 bg-white border-t border-slate-200">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask the investigation agent (e.g., 'Track this vehicle across cameras' or 'Where was it last seen?')..."
              className="flex-1 px-4 py-2.5 rounded-md border border-slate-300 text-sm focus:outline-none focus:ring-2 focus:ring-slate-800 text-slate-900 bg-white"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-semibold rounded-md transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <span>Send</span>
              <span>â†µ</span>
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

