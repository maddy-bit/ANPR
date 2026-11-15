import assert from "node:assert/strict";
import { cancelInvestigationTrackingJob, getInvestigationTrackingJob } from "./api";

async function run() {
  const calls: Array<{ url: string; method: string }> = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method || "GET" });
    return new Response(JSON.stringify({ id: "job-id", caseId: "case-id", mode: "HISTORIC", status: "QUEUED" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const fetched = await getInvestigationTrackingJob("case/id", "job?id");
    assert.equal(fetched.id, "job-id");
    await cancelInvestigationTrackingJob("case/id", "job?id");
    assert.equal(calls[0].method, "GET");
    assert.equal(calls[1].method, "DELETE");
    assert.match(calls[0].url, /\/api\/agent\/cases\/case%2Fid\/jobs\/job%3Fid$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

void run();

