"use client";

import { useEffect, useRef } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Info, Square } from "lucide-react";
import { confirmDispatchKind } from "@/app/actions/confirm-kind";
import { cancelRun } from "@/app/actions/cancel-run";
import type { ClientRun } from "@/components/run-types";
import type { DispatchKind } from "@/db/schema";

const KIND_LABELS: Record<DispatchKind, string> = {
  image: "Image",
  "landing-page": "Landing page",
  email: "Email",
};

const IN_FLIGHT_STATUSES: ClientRun["status"][] = ["connecting", "classifying", "dispatched", "streaming"];

export function CanvasTile({
  run,
  subscribeLive,
  onUpdate,
  onOpenDrawer,
  onOpenModal,
  onImprovise,
}: {
  run: ClientRun;
  subscribeLive: boolean;
  onUpdate: (runId: string, patch: Partial<ClientRun>) => void;
  onOpenDrawer: (runId: string) => void;
  onOpenModal: (runId: string) => void;
  onImprovise: (parentArtifactId: string, kind: DispatchKind) => void;
}) {
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!subscribeLive) return;
    const runId = run.runId;
    const patch = (p: Partial<ClientRun>) => onUpdate(runId, p);
    const source = new EventSource(`/api/runs/${runId}/stream`);

    source.addEventListener("classified", (e) => {
      const data = JSON.parse(e.data);
      patch({ status: "classifying", kind: data.kind, confidence: data.confidence });
    });
    source.addEventListener("awaiting_confirmation", (e) => {
      const data = JSON.parse(e.data);
      patch({ status: "awaiting_confirmation", kind: data.kind, confidence: data.confidence });
    });
    source.addEventListener("ambiguous", () => patch({ status: "ambiguous" }));
    source.addEventListener("unsupported", () => patch({ status: "unsupported" }));
    source.addEventListener("dispatched", () => patch({ status: "dispatched" }));
    source.addEventListener("partial", (e) => {
      const data = JSON.parse(e.data);
      patch({ status: "streaming", content: data.content });
    });
    source.addEventListener("done", (e) => {
      const data = JSON.parse(e.data);
      patch({ status: "done", content: data.content, rationale: data.rationale, outputId: data.outputId });
      source.close();
    });
    source.addEventListener("error", (e) => {
      // Only treat as a stream failure if we haven't already reached a terminal state
      // (browsers fire a generic "error" event on clean server-side stream close too).
      if (runRef.current.status === "done" || runRef.current.status === "cancelled") return;
      const data = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : null;
      if (data) {
        patch({ status: "failed", error: data.message });
        source.close();
      }
    });
    source.addEventListener("cancelled", () => {
      patch({ status: "cancelled" });
      source.close();
    });

    return () => source.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.runId, subscribeLive]);

  const canStop = IN_FLIGHT_STATUSES.includes(run.status);
  const canOpenOutput = run.status === "streaming" || run.status === "done";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <p className="line-clamp-2 text-sm font-medium">{run.prompt}</p>
        <div className="flex shrink-0 items-center gap-1">
          <StatusBadge run={run} />
          <Button variant="ghost" size="icon" className="size-7" title="Why this?" onClick={() => onOpenDrawer(run.runId)}>
            <Info className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent
        className={canOpenOutput ? "cursor-pointer" : undefined}
        onClick={() => canOpenOutput && onOpenModal(run.runId)}
      >
        <TileBody
          run={run}
          onConfirm={(kind) => {
            void confirmDispatchKind({ runId: run.runId, kind });
            onUpdate(run.runId, { status: "dispatched", kind });
          }}
        />
      </CardContent>
      <CardFooter className="flex items-center justify-between gap-2">
        <div className="flex flex-col items-start gap-1">
          {run.parentArtifactId && <span className="text-xs text-muted-foreground">Improvised from →</span>}
          {run.status === "done" && run.kind && run.outputId && (
            <Button
              size="sm"
              variant="secondary"
              onClick={(e) => {
                e.stopPropagation();
                onImprovise(run.outputId!, run.kind!);
              }}
            >
              Improvise
            </Button>
          )}
        </div>
        {canStop && (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              void cancelRun(run.runId);
            }}
          >
            <Square className="size-3" /> Stop
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function StatusBadge({ run }: { run: ClientRun }) {
  const map: Record<ClientRun["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
    connecting: { label: "…", variant: "outline" },
    classifying: { label: "Classifying", variant: "outline" },
    awaiting_confirmation: { label: "Confirm?", variant: "outline" },
    ambiguous: { label: "Ambiguous", variant: "destructive" },
    unsupported: { label: "Not supported", variant: "destructive" },
    dispatched: { label: "Generating…", variant: "secondary" },
    streaming: { label: "Streaming…", variant: "secondary" },
    done: { label: run.kind ? KIND_LABELS[run.kind] : "Done", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "outline" },
  };
  const { label, variant } = map[run.status];
  return <Badge variant={variant}>{label}</Badge>;
}

function TileBody({ run, onConfirm }: { run: ClientRun; onConfirm: (kind: DispatchKind) => void }) {
  if (run.status === "connecting" || run.status === "classifying") {
    return <Skeleton className="h-32 w-full" />;
  }
  if (run.status === "ambiguous") {
    return <p className="text-sm text-muted-foreground">Couldn&apos;t tell what you wanted — try rephrasing.</p>;
  }
  if (run.status === "unsupported") {
    return <p className="text-sm text-muted-foreground">Not supported yet.</p>;
  }
  if (run.status === "awaiting_confirmation") {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          Did you mean {run.kind ? KIND_LABELS[run.kind] : "this"}? ({Math.round((run.confidence ?? 0) * 100)}% sure)
        </p>
        <div className="flex flex-wrap gap-2" onClick={(e) => e.stopPropagation()}>
          {(["image", "landing-page", "email"] as const).map((kind) => (
            <Button key={kind} size="sm" variant={kind === run.kind ? "default" : "outline"} onClick={() => onConfirm(kind)}>
              {KIND_LABELS[kind]}
            </Button>
          ))}
        </div>
      </div>
    );
  }
  if (run.status === "failed") {
    return <p className="text-sm text-destructive">{run.error ?? "Something went wrong."}</p>;
  }
  if (run.status === "cancelled") {
    return <p className="text-sm text-muted-foreground">Cancelled — credits released.</p>;
  }
  if (run.status === "dispatched") {
    return <Skeleton className="h-32 w-full" />;
  }
  // streaming or done
  if (run.kind === "image") {
    return run.content?.url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={run.content.url} alt={run.prompt} className="aspect-video w-full rounded object-cover" />
    ) : (
      <Skeleton className="h-32 w-full" />
    );
  }
  if (run.kind === "landing-page") {
    return run.content?.html ? <LandingPageThumbnail html={run.content.html} /> : <Skeleton className="h-32 w-full" />;
  }
  // email
  return (
    <div className="flex flex-col gap-1 text-sm">
      {run.content?.subject && <p className="font-semibold">{run.content.subject}</p>}
      {run.content?.body && <p className="line-clamp-4 text-muted-foreground">{run.content.body}</p>}
    </div>
  );
}

/** A real live-rendered thumbnail: the iframe is laid out at full size then CSS-scaled down,
 * so the grid shows an actual miniature of the generated website rather than a text summary. */
function LandingPageThumbnail({ html }: { html: string }) {
  const SCALE = 0.28;
  const WIDTH = 1200;
  const HEIGHT = 750;
  return (
    <div className="relative w-full overflow-hidden rounded border" style={{ height: HEIGHT * SCALE }}>
      <iframe
        srcDoc={html}
        sandbox=""
        title="Landing page thumbnail"
        className="pointer-events-none origin-top-left bg-white"
        style={{ width: WIDTH, height: HEIGHT, transform: `scale(${SCALE})` }}
      />
    </div>
  );
}
