import { EventEmitter } from "node:events";
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

// Same-instance pub/sub. On Vercel (multiple serverless instances, no shared memory) this
// is NOT relied on for correctness -- the stream route falls back to DB polling there (see
// lib/config.ts). Off Vercel (local dev, a persistent host like EC2) it's the only instance
// there is, so this gives real push delivery with near-zero latency.
const emitters = new Map<string, EventEmitter>();
const abortControllers = new Map<string, AbortController>();

function getEmitter(runId: string) {
  let emitter = emitters.get(runId);
  if (!emitter) {
    emitter = new EventEmitter();
    emitter.setMaxListeners(10);
    emitters.set(runId, emitter);
  }
  return emitter;
}

export function publish(runId: string, event: RunEvent) {
  getEmitter(runId).emit("event", event);
  if (event.type === "done" || event.type === "error" || event.type === "cancelled" || event.type === "ambiguous" || event.type === "unsupported") {
    setTimeout(() => emitters.delete(runId), 5_000);
  }
}

export function subscribe(runId: string, onEvent: (event: RunEvent) => void) {
  const emitter = getEmitter(runId);
  emitter.on("event", onEvent);
  return () => emitter.off("event", onEvent);
}

export function registerAbortController(runId: string, controller: AbortController) {
  abortControllers.set(runId, controller);
  controller.signal.addEventListener("abort", () => abortControllers.delete(runId), { once: true });
}

export function abortRun(runId: string) {
  abortControllers.get(runId)?.abort();
}
