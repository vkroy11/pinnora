"use client";

import { useEffect, useRef, useState } from "react";
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
// Every tile body renders inside this same block height so grid rows line up regardless
// of kind or how much content a given run produced.
const TILE_BODY_HEIGHT = 176;

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

function TileFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col justify-center gap-2" style={{ height: TILE_BODY_HEIGHT }}>
      {children}
    </div>
  );
}

function TileBody({ run, onConfirm }: { run: ClientRun; onConfirm: (kind: DispatchKind) => void }) {
  if (run.status === "connecting" || run.status === "classifying" || run.status === "dispatched") {
    return (
      <TileFrame>
        <Skeleton className="h-full w-full" />
      </TileFrame>
    );
  }
  if (run.status === "ambiguous") {
    return (
      <TileFrame>
        <p className="text-sm text-muted-foreground">Couldn&apos;t tell what you wanted — try rephrasing.</p>
      </TileFrame>
    );
  }
  if (run.status === "unsupported") {
    return (
      <TileFrame>
        <p className="text-sm text-muted-foreground">Not supported yet.</p>
      </TileFrame>
    );
  }
  if (run.status === "awaiting_confirmation") {
    return (
      <TileFrame>
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
      </TileFrame>
    );
  }
  if (run.status === "failed") {
    return (
      <TileFrame>
        <p className="text-sm text-destructive">{run.error ?? "Something went wrong."}</p>
      </TileFrame>
    );
  }
  if (run.status === "cancelled") {
    return (
      <TileFrame>
        <p className="text-sm text-muted-foreground">Cancelled — credits released.</p>
      </TileFrame>
    );
  }

  // streaming or done
  if (run.kind === "image") {
    return (
      <div style={{ height: TILE_BODY_HEIGHT }} className="overflow-hidden rounded">
        {run.content?.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={run.content.url} alt={run.prompt} className="h-full w-full object-cover" />
        ) : (
          <Skeleton className="h-full w-full" />
        )}
      </div>
    );
  }
  if (run.kind === "landing-page") {
    if (run.status === "streaming") {
      return <CodeTypewriter code={run.content?.html ?? ""} />;
    }
    return run.content?.html ? (
      <LandingPageThumbnail html={run.content.html} />
    ) : (
      <TileFrame>
        <Skeleton className="h-full w-full" />
      </TileFrame>
    );
  }
  // email
  return (
    <TileFrame>
      <div className="flex h-full flex-col gap-1 overflow-hidden text-sm">
        {run.content?.subject && <p className="line-clamp-1 font-semibold">{run.content.subject}</p>}
        {run.content?.body && <p className="line-clamp-5 text-muted-foreground">{run.content.body}</p>}
        {run.status === "streaming" && <BlinkingCursor />}
      </div>
    </TileFrame>
  );
}

function BlinkingCursor() {
  return <span className="inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle" />;
}

/** While a landing page is still streaming, showing a half-parsed HTML doc in an iframe
 * looks broken -- so we show the code growing (typewriter-style) instead, and only switch
 * to the rendered iframe once the run is done and the document is actually complete. */
function CodeTypewriter({ code }: { code: string }) {
  const scrollRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [code]);

  return (
    <pre
      ref={scrollRef}
      style={{ height: TILE_BODY_HEIGHT }}
      className="overflow-y-auto whitespace-pre-wrap break-all rounded border bg-muted p-2 font-mono text-[10px] leading-relaxed"
    >
      {code}
      <BlinkingCursor />
    </pre>
  );
}

/** A real live-rendered thumbnail: the iframe is laid out at full size then CSS-scaled to
 * exactly fill the tile's width (via ResizeObserver), so the grid shows an actual miniature
 * of the generated website rather than a fixed-size crop with empty space around it. */
function LandingPageThumbnail({ html }: { html: string }) {
  const WIDTH = 1200;
  const HEIGHT = 750;
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.3);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setScale(width / WIDTH);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ height: TILE_BODY_HEIGHT }}
      className="relative w-full overflow-hidden rounded border bg-white"
    >
      <iframe
        srcDoc={html}
        sandbox=""
        title="Landing page thumbnail"
        className="pointer-events-none origin-top-left"
        style={{ width: WIDTH, height: HEIGHT, transform: `scale(${scale})` }}
      />
    </div>
  );
}
