import type { NextRequest } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { getDispatch } from "@/lib/db/repositories/dispatches";
import { getOutputByDispatchId } from "@/lib/db/repositories/outputs";
import { subscribe, abortRun, type RunEvent } from "@/lib/services/run-events";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TERMINAL: RunEvent["type"][] = ["done", "error", "cancelled"];

function sseLine(event: RunEvent) {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** Reconstructs the events a live subscriber would have seen, from persisted state -- this is
 * what lets a reloaded/reconnected client resume from the last known state instead of going blank. */
async function replayEvents(
  dispatch: NonNullable<Awaited<ReturnType<typeof getDispatch>>>,
  output: Awaited<ReturnType<typeof getOutputByDispatchId>>,
): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for (const entry of dispatch.phases) {
    switch (entry.phase) {
      case "classified":
        if (dispatch.classifiedKind && dispatch.classifiedConfidence != null) {
          events.push({
            type: "classified",
            kind: dispatch.classifiedKind,
            confidence: dispatch.classifiedConfidence,
            source: dispatch.kindSource ?? "llm",
          });
        }
        break;
      case "ambiguous":
        events.push({ type: "ambiguous" });
        break;
      case "dispatched":
        events.push({ type: "dispatched" });
        break;
      case "done":
        if (output?.content) events.push({ type: "done", content: output.content, rationale: output.rationale, outputId: output.id });
        break;
      case "error":
        if (dispatch.status === "unsupported") {
          events.push({ type: "unsupported" });
        } else {
          events.push({ type: "error", message: dispatch.error ?? "Unknown error" });
        }
        break;
      case "cancelled":
        events.push({ type: "cancelled" });
        break;
      default:
        break;
    }
  }

  if (dispatch.status === "awaiting_confirmation" && dispatch.classifiedKind && dispatch.classifiedConfidence != null) {
    events.push({ type: "awaiting_confirmation", kind: dispatch.classifiedKind, confidence: dispatch.classifiedConfidence });
  }

  // Still-in-flight partial content isn't a phase entry -- append it last so the
  // client's latest paint reflects the most recent partial, not just phase markers.
  if (output?.partialContent && dispatch.status !== "done") {
    events.push({ type: "partial", content: output.partialContent });
  }

  return events;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const user = await requireAppUser();
  const dispatch = await getDispatch(runId);
  if (!dispatch || dispatch.userId !== user.id) {
    return new Response("Not found", { status: 404 });
  }
  const output = await getOutputByDispatchId(runId);

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: RunEvent) => {
        try {
          controller.enqueue(encoder.encode(sseLine(event)));
        } catch {
          // Controller already closed (client disconnected mid-write).
        }
      };

      for (const event of await replayEvents(dispatch, output)) send(event);

      if (TERMINAL.includes(dispatch.status as RunEvent["type"]) || dispatch.status === "ambiguous" || dispatch.status === "unsupported") {
        controller.close();
        return;
      }

      unsubscribe = subscribe(runId, (event) => {
        send(event);
        if (TERMINAL.includes(event.type)) {
          try {
            controller.close();
          } catch {
            // already closed
          }
        }
      });
    },
    cancel() {
      unsubscribe?.();
      abortRun(runId);
    },
  });

  req.signal.addEventListener("abort", () => {
    unsubscribe?.();
    abortRun(runId);
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
