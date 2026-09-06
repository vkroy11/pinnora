"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import type { ClientRun } from "@/components/run-types";

function downloadText(filename: string, mimeType: string, text: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function downloadImage(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank");
  }
}

export function OutputModal({ run, onClose }: { run: ClientRun | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const codeScrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const el = codeScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [run?.content?.html]);

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const isStreamingLandingPage = run?.kind === "landing-page" && run.status === "streaming";

  return (
    <Dialog open={Boolean(run)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[75vh] w-[75vw] max-w-none flex-col overflow-hidden sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="line-clamp-2">{run?.prompt}</DialogTitle>
        </DialogHeader>

        {isStreamingLandingPage && (
          <pre
            ref={codeScrollRef}
            className="flex-1 overflow-auto whitespace-pre-wrap break-all rounded border bg-muted p-4 font-mono text-xs leading-relaxed"
          >
            {run.content?.html}
            <span className="inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle" />
          </pre>
        )}

        {run?.kind === "landing-page" && run.status === "done" && run.content?.html && (
          <Tabs defaultValue="preview" className="flex flex-1 flex-col gap-3 overflow-hidden">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>
              <Button size="sm" variant="secondary" onClick={() => downloadText("landing-page.html", "text/html", run.content!.html!)}>
                Download HTML
              </Button>
            </div>
            <TabsContent value="preview" className="flex-1 overflow-hidden">
              <iframe srcDoc={run.content.html} sandbox="" className="h-full w-full rounded border bg-white" title="Landing page preview" />
            </TabsContent>
            <TabsContent value="code" className="flex-1 overflow-hidden">
              <pre className="h-full overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-4 text-xs leading-relaxed">
                <code>{run.content.html}</code>
              </pre>
            </TabsContent>
          </Tabs>
        )}

        {run?.kind === "email" && (
          <div className="flex flex-1 flex-col gap-3 overflow-y-auto">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Subject</p>
              <p className="font-medium">{run.content?.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Body</p>
              <p className="whitespace-pre-wrap text-sm">{run.content?.body}</p>
              {run.status === "streaming" && (
                <span className="inline-block h-3.5 w-1.5 animate-pulse bg-foreground align-middle" />
              )}
            </div>
            {run.status === "done" && (
              <Button
                size="sm"
                variant="secondary"
                className="w-fit"
                onClick={() => copy(`Subject: ${run.content?.subject}\n\n${run.content?.body}`)}
              >
                {copied ? "Copied!" : "Copy"}
              </Button>
            )}
          </div>
        )}

        {run?.kind === "image" && run.content?.url && (
          <div className="flex flex-1 flex-col items-start gap-3 overflow-y-auto">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={run.content.url} alt={run.prompt} className="max-h-full w-full rounded object-contain" />
            <Button size="sm" variant="secondary" onClick={() => downloadImage(run.content!.url!, "image.jpg")}>
              Download image
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
