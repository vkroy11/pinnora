import { getDb } from "@/db";
import { projects } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

export async function createProject(input: { orgId: string; userId: string; name: string }) {
  const rows = await getDb().insert(projects).values(input).returning();
  return rows[0];
}

export async function getProject(projectId: string) {
  const rows = await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1);
  return rows[0] ?? null;
}

export function listProjectsForUser(userId: string) {
  return getDb().select().from(projects).where(eq(projects.userId, userId)).orderBy(desc(projects.createdAt));
}

export async function updateProjectName(id: string, name: string) {
  await getDb().update(projects).set({ name }).where(eq(projects.id, id));
}
