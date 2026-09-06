import { requireOwnedProject } from "@/lib/auth";
import { listDispatchesWithOutputs } from "@/lib/db/repositories/dispatches";
import { balance } from "@/lib/services/credit-service";
import { ProjectCanvas } from "@/components/project-canvas";
import type { ClientRun, ClientRunStatus } from "@/components/run-types";

function toClientStatus(status: string): ClientRunStatus {
  if (status === "queued" || status === "streaming") {
    return status === "streaming" ? "streaming" : "connecting";
  }
  return status as ClientRunStatus;
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, user } = await requireOwnedProject(id);
  const [rows, credits] = await Promise.all([listDispatchesWithOutputs(id), balance(user.id)]);

  const initialRuns: ClientRun[] = rows.map(({ dispatch, output }) => ({
    runId: dispatch.id,
    prompt: dispatch.prompt,
    parentArtifactId: dispatch.parentArtifactId,
    status: toClientStatus(dispatch.status),
    kind: dispatch.classifiedKind ?? dispatch.explicitIntent ?? undefined,
    confidence: dispatch.classifiedConfidence ?? undefined,
    content: output?.content,
    rationale: output?.rationale,
    error: dispatch.error,
    outputId: output?.id,
  }));

  return (
    <div className="h-screen">
      <ProjectCanvas projectId={id} projectName={project.name} initialCredits={credits} initialRuns={initialRuns} />
    </div>
  );
}
