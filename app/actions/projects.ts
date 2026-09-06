"use server";

import { redirect } from "next/navigation";
import { requireAppUser } from "@/lib/auth";
import { createProject } from "@/lib/db/repositories/projects";

export async function createNewProject() {
  const user = await requireAppUser();
  const project = await createProject({
    orgId: user.orgId,
    userId: user.id,
    name: `Untitled chat ${new Date().toLocaleString()}`,
  });
  redirect(`/projects/${project.id}`);
}
