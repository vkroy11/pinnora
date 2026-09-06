"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChatComposer, type ImproviseContext } from "@/components/chat-composer";
import { CanvasTile } from "@/components/canvas-tile";
import { WhyDrawer } from "@/components/why-drawer";
import { OutputModal } from "@/components/output-modal";
import { ThemeToggle } from "@/components/theme-toggle";
import { EditableProjectName } from "@/components/editable-project-name";
import { CreditLedgerDialog } from "@/components/credit-ledger-dialog";
import { getProjectRuns } from "@/app/actions/get-project-runs";
import type { ClientRun } from "@/components/run-types";
import type { DispatchKind } from "@/db/schema";

const TERMINAL_STATUSES: ClientRun["status"][] = ["done", "failed", "cancelled", "ambiguous", "unsupported"];
// Reconciliation backstop while anything is still running: even if every SSE event were
// lost, the canvas still converges on the server's truth within this interval.
const ACTIVE_REFETCH_MS = 4_000;

type CanvasData = { runs: ClientRun[]; credits: number };

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
  const queryClient = useQueryClient();
  const queryKey = ["project-runs", projectId];

  const { data } = useQuery<CanvasData>({
    queryKey,
    queryFn: () => getProjectRuns(projectId),
    initialData: { runs: initialRuns, credits: initialCredits },
    refetchInterval: (query) =>
      (query.state.data?.runs ?? []).some((r) => !TERMINAL_STATUSES.includes(r.status)) ? ACTIVE_REFETCH_MS : false,
  });

  const runs = data.runs;
  const credits = data.credits;

  const [liveRunIds] = useState<Set<string>>(() => new Set());
  const [improviseContext, setImproviseContext] = useState<ImproviseContext | null>(null);
  const [drawerRunId, setDrawerRunId] = useState<string | null>(null);
  const [outputModalRunId, setOutputModalRunId] = useState<string | null>(null);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  /** SSE fast path: patch the cache directly so the UI updates instantly, without a round trip. */
  function handleTileUpdate(runId: string, patch: Partial<ClientRun>) {
    queryClient.setQueryData<CanvasData>(queryKey, (prev) =>
      prev
        ? { ...prev, runs: prev.runs.map((r) => (r.runId === runId ? { ...r, ...patch } : r)) }
        : prev,
    );
    // A status change also moves credits (hold on dispatch, settle/release at the end).
    if (patch.status) void queryClient.invalidateQueries({ queryKey });
  }

  /** The stream is only ever an optimization -- if it drops, fall back to the server. */
  function handleStreamError() {
    void queryClient.invalidateQueries({ queryKey });
  }

  function handleDispatched(runId: string, prompt: string, parentArtifactId: string | null) {
    liveRunIds.add(runId);
    queryClient.setQueryData<CanvasData>(queryKey, (prev) => {
      const optimistic: ClientRun = { runId, prompt, parentArtifactId, status: "connecting" };
      return prev ? { ...prev, runs: [optimistic, ...prev.runs] } : { runs: [optimistic], credits };
    });
    void queryClient.invalidateQueries({ queryKey });
  }

  function handleImprovise(parentArtifactId: string, kind: DispatchKind) {
    setImproviseContext({ parentArtifactId, kind });
  }

  function handleOpenParentModal(parentOutputId: string) {
    const parent = runs.find((r) => r.outputId === parentOutputId);
    if (parent) setOutputModalRunId(parent.runId);
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
          <button
            type="button"
            onClick={() => setLedgerOpen(true)}
            title="View credit ledger"
            className="rounded px-2 py-1 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            {credits} credits
          </button>
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
              onStreamError={handleStreamError}
              onOpenDrawer={setDrawerRunId}
              onOpenModal={setOutputModalRunId}
              onOpenParentModal={handleOpenParentModal}
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
      <CreditLedgerDialog open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
    </div>
  );
}
