import type { NextRequest } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getDispatch, requestCancel, type PhaseEntry } from "@/lib/db/repositories/dispatches";
import { getOutputByDispatchId } from "@/lib/db/repositories/outputs";
import { abortRun, type RunEvent } from "@/lib/services/run-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL_STATUSES = new Set(["done", "failed", "cancelled", "ambiguous", "unsupported"]);
// Serverless instances don't share memory, so a live push (in-memory pub/sub) from the
// background generation job may never reach this request's instance. Polling the DB is
// slower than a push but is correct regardless of which instance is doing the work.
const POLL_MS = 400;
const MAX_STREAM_MS = 5 * 60 * 1000;

function sseLine(event: RunEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function phaseToEvent(
  entry: PhaseEntry,
  dispatch: NonNullable<Awaited<ReturnType<typeof getDispatch>>>,
  output: Awaited<ReturnType<typeof getOutputByDispatchId>>,
): RunEvent | null {
  switch (entry.phase) {
    case "classified":
      if (!dispatch.classifiedKind || dispatch.classifiedConfidence == null) return null;
      return {
        type: "classified",
        kind: dispatch.classifiedKind,
        confidence: dispatch.classifiedConfidence,
        source: dispatch.kindSource ?? "llm",
      };
    case "ambiguous":
      return { type: "ambiguous" };
    case "dispatched":
      return { type: "dispatched" };
    case "done":
      return output?.content ? { type: "done", content: output.content, rationale: output.rationale, outputId: output.id } : null;
    case "error":
      return dispatch.status === "unsupported"
        ? { type: "unsupported" }
        : { type: "error", message: dispatch.error ?? "Unknown error" };
    case "cancelled":
      return { type: "cancelled" };
    default:
      return null;
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const user = await requireAppUser();
  const initialDispatch = await getDispatch(runId);
  if (!initialDispatch || initialDispatch.userId !== user.id) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(sseLine(event)));
        } catch {
          // Client already disconnected.
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      let sentPhaseCount = 0;
      let lastPartialJson: string | null = null;

      const emitFromState = (
        dispatch: NonNullable<Awaited<ReturnType<typeof getDispatch>>>,
        output: Awaited<ReturnType<typeof getOutputByDispatchId>>,
      ) => {
        for (const entry of dispatch.phases.slice(sentPhaseCount)) {
          const event = phaseToEvent(entry, dispatch, output);
          if (event) send(event);
        }
        sentPhaseCount = dispatch.phases.length;

        if (output?.partialContent && dispatch.status !== "done") {
          const json = JSON.stringify(output.partialContent);
          if (json !== lastPartialJson) {
            lastPartialJson = json;
            send({ type: "partial", content: output.partialContent });
          }
        }

        return TERMINAL_STATUSES.has(dispatch.status);
      };

      const initialOutput = await getOutputByDispatchId(runId);
      if (emitFromState(initialDispatch, initialOutput)) {
        close();
        return;
      }

      const startedAt = Date.now();
      while (!closed) {
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (closed) break;
        if (Date.now() - startedAt > MAX_STREAM_MS) {
          close();
          break;
        }
        const dispatch = await getDispatch(runId);
        if (!dispatch) {
          close();
          break;
        }
        const output = await getOutputByDispatchId(runId);
        if (emitFromState(dispatch, output)) {
          close();
          break;
        }
      }
    },
    cancel() {
      closed = true;
      abortRun(runId);
      void requestCancel(runId);
    },
  });

  req.signal.addEventListener("abort", () => {
    closed = true;
    abortRun(runId);
    void requestCancel(runId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
