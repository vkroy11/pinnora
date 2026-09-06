import { getDb } from "@/db";
import { outputs, type DispatchKind, type RenderContent } from "@/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { eq } from "drizzle-orm";

export async function insertPendingOutput(input: { dispatchId: string; kind: DispatchKind; parentId: string | null }) {
  const rows = await getDb().insert(outputs).values(input).returning();
  return rows[0];
}

export async function updatePartialContent(dispatchId: string, partialContent: RenderContent) {
  await getDb().update(outputs).set({ partialContent }).where(eq(outputs.dispatchId, dispatchId));
}

export async function finalizeOutput(dispatchId: string, content: RenderContent, rationale: string | null) {
  await getDb().update(outputs).set({ content, rationale }).where(eq(outputs.dispatchId, dispatchId));
}

export async function getOutputById(id: string) {
  const rows = await getDb().select().from(outputs).where(eq(outputs.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getOutputByDispatchId(dispatchId: string) {
  const rows = await getDb().select().from(outputs).where(eq(outputs.dispatchId, dispatchId)).limit(1);
  return rows[0] ?? null;
}

export async function getOutputWithParent(dispatchId: string) {
  const parent = alias(outputs, "parent");
  const rows = await getDb()
    .select({ output: outputs, parent })
    .from(outputs)
    .leftJoin(parent, eq(outputs.parentId, parent.id))
    .where(eq(outputs.dispatchId, dispatchId))
    .limit(1);
  return rows[0] ?? null;
}
