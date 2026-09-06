"use client";

import { useState } from "react";
import { ChatComposer, type ImproviseContext } from "@/components/chat-composer";
import { CanvasTile } from "@/components/canvas-tile";
import { WhyDrawer } from "@/components/why-drawer";
import type { ClientRun } from "@/components/run-types";
import type { DispatchKind } from "@/db/schema";

export function ProjectCanvas({ projectId, initialRuns }: { projectId: string; initialRuns: ClientRun[] }) {
  const [runs, setRuns] = useState<ClientRun[]>(initialRuns);
  const [liveRunIds] = useState<Set<string>>(() => new Set());
  const [improviseContext, setImproviseContext] = useState<ImproviseContext | null>(null);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);

  function handleDispatched(runId: string, prompt: string, parentArtifactId: string | null) {
    liveRunIds.add(runId);
    setRuns((prev) => [
      { runId, prompt, parentArtifactId, status: "connecting" },
      ...prev,
    ]);
  }

  function handleImprovise(parentArtifactId: string, kind: DispatchKind) {
    setImproviseContext({ parentArtifactId, kind });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto p-4">
        {runs.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Send a prompt below — image, landing page, or email. Anything else gets a &quot;Not supported yet.&quot;
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {runs.map((run) => (
            <CanvasTile
              key={run.runId}
              initial={run}
              subscribeLive={liveRunIds.has(run.runId) || !["done", "failed", "cancelled", "ambiguous", "unsupported"].includes(run.status)}
              onOpenDrawer={setDrawerRunId}
              onImprovise={handleImprovise}
            />
          ))}
        </div>
      </div>
      <ChatComposer
        projectId={projectId}
        improviseContext={improviseContext}
        onClearImprovise={() => setImproviseContext(null)}
        onDispatched={handleDispatched}
      />
      <WhyDrawer runId={drawerRunId} onClose={() => setDrawerRunId(null)} />
    </div>
  );
}
