"use client";

import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { getRunDetails } from "@/app/actions/get-run-details";

type RunDetails = Awaited<ReturnType<typeof getRunDetails>>;

export function WhyDrawer({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const [details, setDetails] = useState<RunDetails | null>(null);

  useEffect(() => {
    if (!runId) return;
    getRunDetails(runId).then(setDetails);
  }, [runId]);

  const visibleDetails = details?.runId === runId ? details : null;
  const loading = Boolean(runId) && !visibleDetails;

  return (
    <Sheet open={Boolean(runId)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Why this?</SheetTitle>
          <SheetDescription>Read from the run log and output tables — no re-generation.</SheetDescription>
        </SheetHeader>
        {loading && <p className="px-4 text-sm text-muted-foreground">Loading…</p>}
        {visibleDetails && (
          <div className="flex flex-col gap-4 px-4 pb-6 text-sm">
            <Field label="Prompt" value={visibleDetails.prompt} />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Kind" value={visibleDetails.classifiedKind ?? "—"} />
              <Field
                label="Confidence"
                value={visibleDetails.classifiedConfidence != null ? `${Math.round(visibleDetails.classifiedConfidence * 100)}%` : "—"}
              />
              <Field label="Decided by" value={visibleDetails.kindSource === "human" ? "You (confirmed)" : "Classifier"} />
              <Field label="Model" value={visibleDetails.model ?? "—"} />
            </div>
            {visibleDetails.rationale && <Field label="Why this output" value={visibleDetails.rationale} />}
            {visibleDetails.error && <Field label="Error" value={visibleDetails.error} />}
            {visibleDetails.credit && (
              <Field
                label="Credit cost"
                value={`${visibleDetails.credit.amount} credits — ${visibleDetails.credit.released ? "released" : visibleDetails.credit.settled ? "settled" : "held"}`}
              />
            )}
            {visibleDetails.parent && (
              <Field label="Improvised from" value={`${visibleDetails.parent.kind} · ${visibleDetails.parent.id.slice(0, 8)}…`} />
            )}
            <Separator />
            <div>
              <p className="mb-2 font-medium">Phase timeline</p>
              <ol className="flex flex-col gap-1 text-xs text-muted-foreground">
                {visibleDetails.phases.map((p, i) => (
                  <li key={i}>
                    <span className="font-mono">{new Date(p.at).toLocaleTimeString()}</span> — {p.phase}
                    {p.detail ? `: ${p.detail}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">{label}</p>
      <p>{value}</p>
    </div>
  );
}
