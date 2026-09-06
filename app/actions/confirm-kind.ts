"use server";

import { after } from "next/server";
import { requireAppUser } from "@/lib/auth";
import { confirmKindSchema } from "@/lib/schemas/confirm-kind-input";
import { getDispatch } from "@/lib/db/repositories/dispatches";
import { confirmAndProceed } from "@/lib/services/pipeline";
import { UnauthorizedError } from "@/lib/auth";

export async function confirmDispatchKind(input: unknown): Promise<{ ok: true }> {
  const parsed = confirmKindSchema.parse(input);
  const user = await requireAppUser();

  const dispatch = await getDispatch(parsed.runId);
  if (!dispatch || dispatch.userId !== user.id) throw new UnauthorizedError();
  if (dispatch.status !== "awaiting_confirmation") {
    throw new Error("This run is not awaiting confirmation");
  }

  after(() => confirmAndProceed(parsed.runId, parsed.kind));
  return { ok: true };
}
