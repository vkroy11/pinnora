import { requireOwnedProject } from "@/lib/auth";
import { listDispatchesWithOutputs } from "@/lib/db/repositories/dispatches";
import { balance } from "@/lib/services/credit-service";
import { toClientRun } from "@/lib/runs";
import { ProjectCanvas } from "@/components/project-canvas";

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { project, user } = await requireOwnedProject(id);
  const [rows, credits] = await Promise.all([listDispatchesWithOutputs(id), balance(user.id)]);

  return (
    <div className="h-screen">
      <ProjectCanvas
        projectId={id}
        projectName={project.name}
        initialCredits={credits}
        initialRuns={rows.map(toClientRun)}
      />
    </div>
  );
}
