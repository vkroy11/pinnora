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
//
// These live on globalThis deliberately. Next.js bundles the "react-server" layer (server
// components + server actions, where `after()` runs the pipeline) separately from route
// handlers (where the SSE endpoint lives), so a plain module-level Map is instantiated
// *twice* in the same process: the pipeline would publish into one copy while the stream
// route subscribed to the other, and every event would land on zero listeners.
const globalForRunEvents = globalThis as unknown as {
  __pinnoraEmitters?: Map<string, EventEmitter>;
  __pinnoraAbortControllers?: Map<string, AbortController>;
  __pinnoraPendingCancels?: Map<string, ReturnType<typeof setTimeout>>;
};

const emitters = (globalForRunEvents.__pinnoraEmitters ??= new Map<string, EventEmitter>());
const abortControllers = (globalForRunEvents.__pinnoraAbortControllers ??= new Map<string, AbortController>());
const pendingCancels = (globalForRunEvents.__pinnoraPendingCancels ??= new Map<string, ReturnType<typeof setTimeout>>());

// How long a dropped SSE connection has to come back before it counts as "the operator left".
//
// The brief wants a client disconnect to release the hold, but "disconnected" and "gone" are
// not the same event, and the gap between them is measured in seconds:
//   - React Strict Mode (dev) closes and reopens the EventSource within milliseconds.
//   - A page reload reconnects in ~2-4s here (Turbopack + Clerk + RSC on a cold route).
//   - A backgrounded tab or a brief network blip can pause delivery for a second or two.
// A 1s window treated all of those as abandonment and cancelled live runs out from under the
// operator -- refreshing the page killed whatever was generating. Any new connection for the
// same run cancels the pending check, so a genuine close still releases, just seconds later.
const CANCEL_GRACE_MS = 6_000;

export function scheduleCancelCheck(runId: string, onCancel: () => void) {
  cancelPendingCancelCheck(runId);
  pendingCancels.set(
    runId,
    setTimeout(() => {
      pendingCancels.delete(runId);
      onCancel();
    }, CANCEL_GRACE_MS),
  );
}

export function cancelPendingCancelCheck(runId: string) {
  const timer = pendingCancels.get(runId);
  if (timer) {
    clearTimeout(timer);
    pendingCancels.delete(runId);
  }
}

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
