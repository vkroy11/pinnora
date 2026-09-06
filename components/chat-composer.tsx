"use client";

import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { dispatchCreative } from "@/app/actions/dispatch-creative";
import type { DispatchKind } from "@/db/schema";

export type ImproviseContext = { parentArtifactId: string; kind: DispatchKind };

export function ChatComposer({
  projectId,
  improviseContext,
  onClearImprovise,
  onDispatched,
}: {
  projectId: string;
  improviseContext: ImproviseContext | null;
  onClearImprovise: () => void;
  onDispatched: (runId: string, prompt: string, parentArtifactId: string | null) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit() {
    const trimmed = prompt.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      const { runId } = await dispatchCreative({
        projectId,
        prompt: trimmed,
        intent: improviseContext?.kind,
        parentArtifactId: improviseContext?.parentArtifactId,
      });
      onDispatched(runId, trimmed, improviseContext?.parentArtifactId ?? null);
      setPrompt("");
      onClearImprovise();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t p-4">
      {improviseContext && (
        <div className="flex w-fit items-center gap-2">
          <Badge variant="secondary">Improving on previous {improviseContext.kind}</Badge>
          <Button variant="ghost" size="sm" onClick={onClearImprovise}>
            Clear
          </Button>
        </div>
      )}
      <div className="flex gap-2">
        <Textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe an image, landing page, or email…"
          className="min-h-16 flex-1"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSubmit();
            }
          }}
        />
        <Button onClick={() => void handleSubmit()} disabled={pending || !prompt.trim()}>
          Send
        </Button>
      </div>
    </div>
  );
}
