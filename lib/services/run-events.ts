import type { RenderContent } from "@/db/schema";

export type RunEvent =
  | { type: "classified"; kind: string; confidence: number; source: "llm" | "human" }
  | { type: "awaiting_confirmation"; kind: string; confidence: number }
  | { type: "ambiguous" }
  | { type: "unsupported" }
  | { type: "dispatched" }
  | { type: "partial"; content: RenderContent }
  | { type: "done"; content: RenderContent; rationale: string | null; outputId: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

// Same-instance fast path only: if the SSE route and the generation job happen to land
// on the same serverless instance, aborting here is near-instant. This is NOT relied on
// for correctness -- the DB-backed `cancelRequested` flag (see schema + pipeline.ts) is
// the cross-instance-safe mechanism; this is purely a latency optimization on top of it.
const abortControllers = new Map<string, AbortController>();

export function registerAbortController(runId: string, controller: AbortController) {
  abortControllers.set(runId, controller);
  controller.signal.addEventListener("abort", () => abortControllers.delete(runId), { once: true });
}

export function abortRun(runId: string) {
  abortControllers.get(runId)?.abort();
}
