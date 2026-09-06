import Link from "next/link";
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
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm text-muted-foreground hover:underline">
            ← Chats
          </Link>
          <h1 className="font-medium">{project.name}</h1>
        </div>
        <span className="text-sm text-muted-foreground">{credits} credits</span>
      </header>
      <div className="flex-1 overflow-hidden">
        <ProjectCanvas projectId={id} initialRuns={initialRuns} />
      </div>
    </div>
  );
}
