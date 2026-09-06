"use server";

import { requireOwnedProject } from "@/lib/auth";
import { listDispatchesWithOutputs } from "@/lib/db/repositories/dispatches";
import { balance } from "@/lib/services/credit-service";
import { toClientRun } from "@/lib/runs";
import { reapStaleRuns } from "@/lib/services/run-recovery";
import type { ClientRun } from "@/components/run-types";

/** Source of truth for the canvas. React Query refetches this whenever the stream can't be
 * trusted (stream error, tab refocus, or a slow interval while a run is in flight), so a
 * missed SSE event costs a moment of staleness instead of a permanently stuck tile. */
export async function getProjectRuns(projectId: string): Promise<{ runs: ClientRun[]; credits: number }> {
  const { user } = await requireOwnedProject(projectId);
  // Reconcile runs whose pipeline died without finalizing them, so the canvas self-heals and
  // their orphaned holds get released rather than reserved forever.
  await reapStaleRuns(projectId);
  const [rows, credits] = await Promise.all([listDispatchesWithOutputs(projectId), balance(user.id)]);
  return { runs: rows.map(toClientRun), credits };
}
