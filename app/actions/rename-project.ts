"use server";

import { requireOwnedProject } from "@/lib/auth";
import { updateProjectName } from "@/lib/db/repositories/projects";
import { renameProjectSchema } from "@/lib/schemas/rename-project-input";

export async function renameProject(input: unknown): Promise<{ ok: true }> {
  const parsed = renameProjectSchema.parse(input);
  await requireOwnedProject(parsed.projectId);
  await updateProjectName(parsed.projectId, parsed.name.trim());
  return { ok: true };
}
