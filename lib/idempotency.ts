import { createHash } from "node:crypto";

export const IDEMPOTENCY_WINDOW_MS = 5_000;

/** Identical (userId, projectId, prompt, intent) within IDEMPOTENCY_WINDOW_MS dedupes to one dispatch. */
export function computeIdempotencyKey(input: {
  userId: string;
  projectId: string;
  prompt: string;
  intent?: string;
}) {
  const raw = [input.userId, input.projectId, input.prompt.trim(), input.intent ?? ""].join("::");
  return createHash("sha256").update(raw).digest("hex");
}
