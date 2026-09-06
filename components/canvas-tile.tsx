"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { confirmDispatchKind } from "@/app/actions/confirm-kind";
import type { ClientRun } from "@/components/run-types";
import type { DispatchKind } from "@/db/schema";

const KIND_LABELS: Record<DispatchKind, string> = {
  image: "Image",
  "landing-page": "Landing page",
  email: "Email",
};

export function CanvasTile({
  initial,
  subscribeLive,
  onOpenDrawer,
  onImprovise,
}: {
  initial: ClientRun;
  subscribeLive: boolean;
  onOpenDrawer: (runId: string) => void;
  onImprovise: (parentArtifactId: string, kind: DispatchKind) => void;
}) {
  const [run, setRun] = useState<ClientRun>(initial);
  const runRef = useRef(run);
  useEffect(() => {
    runRef.current = run;
  });

  useEffect(() => {
    if (!subscribeLive) return;
    const source = new EventSource(`/api/runs/${initial.runId}/stream`);

    source.addEventListener("classified", (e) => {
      const data = JSON.parse(e.data);
      setRun((r) => ({ ...r, status: "classifying", kind: data.kind, confidence: data.confidence }));
    });
    source.addEventListener("awaiting_confirmation", (e) => {
      const data = JSON.parse(e.data);
      setRun((r) => ({ ...r, status: "awaiting_confirmation", kind: data.kind, confidence: data.confidence }));
    });
    source.addEventListener("ambiguous", () => setRun((r) => ({ ...r, status: "ambiguous" })));
    source.addEventListener("unsupported", () => setRun((r) => ({ ...r, status: "unsupported" })));
    source.addEventListener("dispatched", () => setRun((r) => ({ ...r, status: "dispatched" })));
    source.addEventListener("partial", (e) => {
      const data = JSON.parse(e.data);
      setRun((r) => ({ ...r, status: "streaming", content: data.content }));
    });
    source.addEventListener("done", (e) => {
      const data = JSON.parse(e.data);
      setRun((r) => ({ ...r, status: "done", content: data.content, rationale: data.rationale, outputId: data.outputId }));
      source.close();
    });
    source.addEventListener("error", (e) => {
      // Only treat as a stream failure if we haven't already reached a terminal state
      // (browsers fire a generic "error" event on clean server-side stream close too).
      if (runRef.current.status === "done" || runRef.current.status === "cancelled") return;
      const data = (e as MessageEvent).data ? JSON.parse((e as MessageEvent).data) : null;
      if (data) {
        setRun((r) => ({ ...r, status: "failed", error: data.message }));
        source.close();
      }
    });
    source.addEventListener("cancelled", () => {
      setRun((r) => ({ ...r, status: "cancelled" }));
      source.close();
    });

    return () => source.close();
  }, [initial.runId, subscribeLive]);

  return (
    <Card className="cursor-pointer transition-shadow hover:shadow-md" onClick={() => onOpenDrawer(run.runId)}>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <p className="line-clamp-2 text-sm font-medium">{run.prompt}</p>
        <StatusBadge run={run} />
      </CardHeader>
      <CardContent>
        <TileBody run={run} onConfirm={(kind) => {
          void confirmDispatchKind({ runId: run.runId, kind });
          setRun((r) => ({ ...r, status: "dispatched", kind }));
        }} />
      </CardContent>
      {run.status === "done" && run.kind && run.outputId && (
        <CardFooter className="flex flex-col items-start gap-1">
          {run.parentArtifactId && (
            <span className="text-xs text-muted-foreground">Improvised from →</span>
          )}
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
        </CardFooter>
      )}
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
  return (
    <div className="flex flex-col gap-1 text-sm">
      {run.content?.headline && <p className="font-semibold">{run.content.headline}</p>}
      {run.content?.body && <p className="text-muted-foreground line-clamp-3">{run.content.body}</p>}
      {run.content?.ctaLabel && (
        <span className="mt-1 inline-block w-fit rounded bg-primary px-2 py-1 text-xs text-primary-foreground">
          {run.content.ctaLabel}
        </span>
      )}
    </div>
  );
}
