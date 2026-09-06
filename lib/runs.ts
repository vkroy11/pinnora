import type { ClientRun, ClientRunStatus } from "@/components/run-types";
import type { listDispatchesWithOutputs } from "@/lib/db/repositories/dispatches";

type DispatchWithOutput = Awaited<ReturnType<typeof listDispatchesWithOutputs>>[number];

function toClientStatus(status: string): ClientRunStatus {
  // "queued" has no client-side equivalent -- the tile is already showing its skeleton.
  return status === "queued" ? "connecting" : (status as ClientRunStatus);
}

/** The single server->client shape for a run. Shared by the initial RSC render and the
 * React Query refetch so both always agree on what the server says. */
export function toClientRun({ dispatch, output }: DispatchWithOutput): ClientRun {
  return {
    runId: dispatch.id,
    prompt: dispatch.prompt,
    parentArtifactId: dispatch.parentArtifactId,
    status: toClientStatus(dispatch.status),
    kind: dispatch.classifiedKind ?? dispatch.explicitIntent ?? undefined,
    confidence: dispatch.classifiedConfidence ?? undefined,
    content: output?.content ?? output?.partialContent ?? undefined,
    rationale: output?.rationale,
    error: dispatch.error,
    outputId: output?.id,
  };
}
