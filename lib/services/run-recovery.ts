import "server-only";
import * as dispatchesRepo from "@/lib/db/repositories/dispatches";
import * as creditService from "@/lib/services/credit-service";
import { publish } from "@/lib/services/run-events";
import type { DispatchStatus } from "@/db/schema";

const TERMINAL: DispatchStatus[] = ["done", "failed", "cancelled", "ambiguous", "unsupported"];

// Long enough that a legitimately slow generation is never reaped (the stream route caps a
// run at 5 minutes), short enough that an interrupted run doesn't sit there forever.
const STALE_AFTER_MS = 5 * 60 * 1000;
// Longer than the pipeline's 500ms cancel poll, so a live pipeline gets first refusal at
// finalizing its own run before we step in.
const CANCEL_TAKEOVER_MS = 2_000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Makes Stop authoritative. Normally the running pipeline notices `cancel_requested`, aborts
 * its own generation and releases its own hold. But if no pipeline is alive for this run --
 * the process restarted, the deploy rolled, the serverless instance was recycled -- nothing
 * would ever act on the flag, and the tile would sit on a skeleton with its credits still
 * reserved. So after a grace period we finalize the run ourselves.
 */
export async function finalizeCancellationIfStuck(dispatchId: string) {
  await sleep(CANCEL_TAKEOVER_MS);

  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch || TERMINAL.includes(dispatch.status)) return; // the live pipeline handled it

  await creditService.releaseOpenHolds(dispatchId);
  await dispatchesRepo.setError(dispatchId, "cancelled", "Cancelled by operator");
  publish(dispatchId, { type: "cancelled" });
}

/**
 * Self-healing for runs whose pipeline died without finalizing them. Called on the canvas
 * read path, so simply opening (or refetching) a project reconciles it -- no cron needed.
 * Releasing the orphaned holds is the important part: otherwise an interrupted run silently
 * keeps the operator's credits reserved forever.
 */
export async function reapStaleRuns(projectId: string) {
  const stale = await dispatchesRepo.findStaleRuns(projectId, STALE_AFTER_MS);
  for (const { id } of stale) {
    await creditService.releaseOpenHolds(id);
    await dispatchesRepo.setError(id, "failed", "Run interrupted before it finished.");
    publish(id, { type: "error", message: "Run interrupted before it finished." });
  }
  return stale.length;
}
