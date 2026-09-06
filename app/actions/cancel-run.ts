"use server";

import { after } from "next/server";
import { requireAppUser, UnauthorizedError } from "@/lib/auth";
import { getDispatch, requestCancel } from "@/lib/db/repositories/dispatches";
import { finalizeCancellationIfStuck } from "@/lib/services/run-recovery";

/** Explicit "Stop" button, or the SSE route observing a client disconnect. Sets a DB-backed
 * flag the running pipeline polls -- and then, if nothing acts on that flag (no pipeline is
 * alive for this run), finalizes the cancellation itself so the tile can't strand. */
export async function cancelRun(runId: string): Promise<{ ok: true }> {
  const user = await requireAppUser();
  const dispatch = await getDispatch(runId);
  if (!dispatch || dispatch.userId !== user.id) throw new UnauthorizedError();

  await requestCancel(runId);
  after(() => finalizeCancellationIfStuck(runId));
  return { ok: true };
}
