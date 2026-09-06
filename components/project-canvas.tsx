"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { ChatComposer, type ImproviseContext } from "@/components/chat-composer";
import { CanvasTile } from "@/components/canvas-tile";
import { WhyDrawer } from "@/components/why-drawer";
import { OutputModal } from "@/components/output-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { EditableProjectName } from "@/components/editable-project-name";
import { getMyBalance } from "@/app/actions/get-balance";
import type { ClientRun } from "@/components/run-types";
import type { DispatchKind } from "@/db/schema";

const TERMINAL_STATUSES: ClientRun["status"][] = ["done", "failed", "cancelled", "ambiguous", "unsupported"];
const BALANCE_REFRESH_DEBOUNCE_MS = 500;

export function ProjectCanvas({
  projectId,
  projectName,
  initialCredits,
  initialRuns,
}: {
  projectId: string;
  projectName: string;
  initialCredits: number;
  initialRuns: ClientRun[];
}) {
  const [runs, setRuns] = useState<ClientRun[]>(initialRuns);
  const [liveRunIds] = useState<Set<string>>(() => new Set());
  const [improviseContext, setImproviseContext] = useState<ImproviseContext | null>(null);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [outputModalRunId, setOutputModalRunId] = useState<string | null>(null);
  const [credits, setCredits] = useState(initialCredits);
  const balanceRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function refreshBalance() {
    if (balanceRefreshTimer.current) return;
    balanceRefreshTimer.current = setTimeout(() => {
      balanceRefreshTimer.current = null;
      void getMyBalance().then(setCredits);
    }, BALANCE_REFRESH_DEBOUNCE_MS);
  }

  function handleDispatched(runId: string, prompt: string, parentArtifactId: string | null) {
    liveRunIds.add(runId);
    setRuns((prev) => [{ runId, prompt, parentArtifactId, status: "connecting" }, ...prev]);
    refreshBalance();
  }

  function handleImprovise(parentArtifactId: string, kind: DispatchKind) {
    setImproviseContext({ parentArtifactId, kind });
  }

  function handleTileUpdate(runId: string, patch: Partial<ClientRun>) {
    setRuns((prev) => prev.map((r) => (r.runId === runId ? { ...r, ...patch } : r)));
    if (patch.status) refreshBalance();
  }

  const outputModalRun = runs.find((r) => r.runId === outputModalRunId) ?? null;

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/projects" className="text-sm text-muted-foreground hover:underline">
            ← Chats
          </Link>
          <EditableProjectName projectId={projectId} name={projectName} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{credits} credits</span>
          <ThemeToggle />
        </div>
      </header>
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
              run={run}
              subscribeLive={liveRunIds.has(run.runId) || !TERMINAL_STATUSES.includes(run.status)}
              onUpdate={handleTileUpdate}
              onOpenDrawer={setDrawerRunId}
              onOpenModal={setOutputModalRunId}
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
      <OutputModal run={outputModalRun} onClose={() => setOutputModalRunId(null)} />
    </div>
  );
}
