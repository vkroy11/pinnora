"use server";

import { requireAppUser, UnauthorizedError } from "@/lib/auth";
import { getDispatch, requestCancel } from "@/lib/db/repositories/dispatches";

/** Explicit "Stop" button, or the SSE route observing a client disconnect. Sets a
 * DB-backed flag the pipeline polls -- see the schema comment on cancelRequested. */
export async function cancelRun(runId: string): Promise<{ ok: true }> {
  const user = await requireAppUser();
  const dispatch = await getDispatch(runId);
  if (!dispatch || dispatch.userId !== user.id) throw new UnauthorizedError();

  await requestCancel(runId);
  return { ok: true };
}
