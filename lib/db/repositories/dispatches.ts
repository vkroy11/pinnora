import { getDb } from "@/db";
import { dispatches, outputs, type DispatchKind, type DispatchStatus, type KindSource } from "@/db/schema";
import { and, desc, eq, gt, inArray, lt, ne, sql } from "drizzle-orm";

export type PhaseEntry = { phase: string; at: string; detail?: string };

export async function insertQueuedDispatch(input: {
  projectId: string;
  userId: string;
  prompt: string;
  explicitIntent: DispatchKind | null;
  parentArtifactId: string | null;
  idempotencyKey: string;
}) {
  const now = new Date().toISOString();
  const rows = await getDb()
    .insert(dispatches)
    .values({
      ...input,
      status: "queued",
      phases: [{ phase: "queued", at: now }],
    })
    .returning();
  return rows[0];
}

/** Idempotency: identical (userId, projectId, prompt, intent) within `windowMs`, not already failed/cancelled. */
export async function findRecentIdempotentDispatch(idempotencyKey: string, windowMs: number) {
  const since = new Date(Date.now() - windowMs);
  const rows = await getDb()
    .select()
    .from(dispatches)
    .where(
      and(
        eq(dispatches.idempotencyKey, idempotencyKey),
        gt(dispatches.createdAt, since),
        ne(dispatches.status, "failed"),
        ne(dispatches.status, "cancelled"),
      ),
    )
    .orderBy(desc(dispatches.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function getDispatch(id: string) {
  const rows = await getDb().select().from(dispatches).where(eq(dispatches.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Cross-instance cancellation signal (see schema comment) -- set by whichever
 * instance is running the SSE route, polled by whichever instance is running the pipeline. */
export async function requestCancel(id: string) {
  await getDb().update(dispatches).set({ cancelRequested: true, updatedAt: new Date() }).where(eq(dispatches.id, id));
}

export async function isCancelRequested(id: string): Promise<boolean> {
  const rows = await getDb()
    .select({ cancelRequested: dispatches.cancelRequested })
    .from(dispatches)
    .where(eq(dispatches.id, id))
    .limit(1);
  return rows[0]?.cancelRequested ?? false;
}

export function listDispatchesForProject(projectId: string) {
  return getDb()
    .select()
    .from(dispatches)
    .where(eq(dispatches.projectId, projectId))
    .orderBy(desc(dispatches.createdAt));
}

/** Canvas grid read path: dispatches for the project, each joined to its (maybe-partial) output. */
export function listDispatchesWithOutputs(projectId: string) {
  return getDb()
    .select({ dispatch: dispatches, output: outputs })
    .from(dispatches)
    .leftJoin(outputs, eq(outputs.dispatchId, dispatches.id))
    .where(eq(dispatches.projectId, projectId))
    .orderBy(desc(dispatches.createdAt));
}

async function appendPhase(id: string, entry: PhaseEntry) {
  await getDb()
    .update(dispatches)
    .set({
      phases: sql`${dispatches.phases} || ${JSON.stringify([entry])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(dispatches.id, id));
}

export async function setStatus(id: string, status: DispatchStatus, phase?: string, detail?: string) {
  await getDb().update(dispatches).set({ status, updatedAt: new Date() }).where(eq(dispatches.id, id));
  if (phase) await appendPhase(id, { phase, at: new Date().toISOString(), detail });
}

const NON_TERMINAL_STATUSES: DispatchStatus[] = ["queued", "classifying", "dispatched", "streaming"];

/** Runs whose pipeline stopped touching them -- a crash, a deploy, a server restart, or a
 * serverless instance recycled mid-generation. `awaiting_confirmation` is excluded on purpose:
 * it's waiting on a human, not stalled. */
export function findStaleRuns(projectId: string, olderThanMs: number) {
  const cutoff = new Date(Date.now() - olderThanMs);
  return getDb()
    .select({ id: dispatches.id })
    .from(dispatches)
    .where(
      and(
        eq(dispatches.projectId, projectId),
        inArray(dispatches.status, NON_TERMINAL_STATUSES),
        lt(dispatches.updatedAt, cutoff),
      ),
    );
}

export async function setClassifierModel(id: string, classifierModel: string) {
  await getDb().update(dispatches).set({ classifierModel, updatedAt: new Date() }).where(eq(dispatches.id, id));
}

/** The model that actually produces the artifact, recorded when generation starts. */
export async function setGenerationModel(id: string, model: string) {
  await getDb().update(dispatches).set({ model, updatedAt: new Date() }).where(eq(dispatches.id, id));
}

export async function setClassified(
  id: string,
  input: { kind: DispatchKind; confidence: number; source: KindSource },
) {
  await getDb()
    .update(dispatches)
    .set({
      classifiedKind: input.kind,
      classifiedConfidence: input.confidence,
      kindSource: input.source,
      updatedAt: new Date(),
    })
    .where(eq(dispatches.id, id));
  await appendPhase(id, { phase: "classified", at: new Date().toISOString(), detail: `${input.kind} (${input.confidence.toFixed(2)}, ${input.source})` });
}

/** User clicked a confirm chip on an ambiguous (0.6-0.8) run: locks in the human-picked kind. */
export async function confirmKind(id: string, kind: DispatchKind) {
  await getDb()
    .update(dispatches)
    .set({ explicitIntent: kind, kindSource: "human", updatedAt: new Date() })
    .where(eq(dispatches.id, id));
  await appendPhase(id, { phase: "confirmed", at: new Date().toISOString(), detail: kind });
}

export async function setError(id: string, status: "failed" | "cancelled" | "unsupported", error: string) {
  await getDb().update(dispatches).set({ status, error, updatedAt: new Date() }).where(eq(dispatches.id, id));
  await appendPhase(id, { phase: status === "cancelled" ? "cancelled" : "error", at: new Date().toISOString(), detail: error });
}
