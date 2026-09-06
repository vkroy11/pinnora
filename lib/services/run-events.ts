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

// In-memory per-runId pub/sub bridging generation (running inline via `after()`)
// to SSE subscribers on the same server instance. No real job queue per the
// exercise's out-of-scope note -- a reload always falls back to the DB-persisted
// state (see the stream route), so this is a liveness optimization, not a
// correctness dependency.
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
  if (event.type === "done" || event.type === "error" || event.type === "cancelled") {
    // Give subscribers a tick to receive the terminal event before cleanup.
    setTimeout(() => {
      emitters.delete(runId);
      abortControllers.delete(runId);
    }, 5_000);
  }
}

export function subscribe(runId: string, onEvent: (event: RunEvent) => void) {
  const emitter = getEmitter(runId);
  emitter.on("event", onEvent);
  return () => emitter.off("event", onEvent);
}

export function registerAbortController(runId: string, controller: AbortController) {
  abortControllers.set(runId, controller);
}

/** Called when the SSE route observes the client's request signal abort. */
export function abortRun(runId: string) {
  abortControllers.get(runId)?.abort();
}
