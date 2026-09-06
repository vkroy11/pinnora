"use server";

import { after } from "next/server";
import { requireOwnedProject } from "@/lib/auth";
import { dispatchInputSchema } from "@/lib/schemas/dispatch-input";
import { computeIdempotencyKey, IDEMPOTENCY_WINDOW_MS } from "@/lib/idempotency";
import * as dispatchesRepo from "@/lib/db/repositories/dispatches";
import { runDispatchPipeline } from "@/lib/services/pipeline";

const CLASSIFIER_MODEL = "gemini-2.5-flash-lite";

export async function dispatchCreative(input: unknown): Promise<{ runId: string }> {
  const parsed = dispatchInputSchema.parse(input);
  const { user } = await requireOwnedProject(parsed.projectId);

  const idempotencyKey = computeIdempotencyKey({
    userId: user.id,
    projectId: parsed.projectId,
    prompt: parsed.prompt,
    intent: parsed.intent,
  });

  const existing = await dispatchesRepo.findRecentIdempotentDispatch(idempotencyKey, IDEMPOTENCY_WINDOW_MS);
  if (existing) {
    return { runId: existing.id };
  }

  const dispatch = await dispatchesRepo.insertQueuedDispatch({
    projectId: parsed.projectId,
    userId: user.id,
    prompt: parsed.prompt,
    explicitIntent: parsed.intent ?? null,
    parentArtifactId: parsed.parentArtifactId ?? null,
    idempotencyKey,
    model: CLASSIFIER_MODEL,
  });

  // Keeps running past this action's response; the stream route is the only
  // way a client observes progress (server actions can't return a stream).
  after(() => runDispatchPipeline(dispatch.id));

  return { runId: dispatch.id };
}
