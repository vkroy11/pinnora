"use client";

import { useState } from "react";
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

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Dialog open={Boolean(run)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="line-clamp-2">{run?.prompt}</DialogTitle>
        </DialogHeader>

        {run?.kind === "landing-page" && run.content?.html && (
          <Tabs defaultValue="preview" className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <TabsList>
                <TabsTrigger value="preview">Preview</TabsTrigger>
                <TabsTrigger value="code">Code</TabsTrigger>
              </TabsList>
              <Button size="sm" variant="secondary" onClick={() => downloadText("landing-page.html", "text/html", run.content!.html!)}>
                Download HTML
              </Button>
            </div>
            <TabsContent value="preview">
              <iframe
                srcDoc={run.content.html}
                sandbox=""
                className="h-[60vh] w-full rounded border bg-white"
                title="Landing page preview"
              />
            </TabsContent>
            <TabsContent value="code">
              <pre className="max-h-[60vh] overflow-auto rounded bg-muted p-4 text-xs">
                <code>{run.content.html}</code>
              </pre>
            </TabsContent>
          </Tabs>
        )}

        {run?.kind === "email" && (
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Subject</p>
              <p className="font-medium">{run.content?.subject}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">Body</p>
              <p className="whitespace-pre-wrap text-sm">{run.content?.body}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              className="w-fit"
              onClick={() => copy(`Subject: ${run.content?.subject}\n\n${run.content?.body}`)}
            >
              {copied ? "Copied!" : "Copy"}
            </Button>
          </div>
        )}

        {run?.kind === "image" && run.content?.url && (
          <div className="flex flex-col items-start gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={run.content.url} alt={run.prompt} className="max-h-[60vh] w-full rounded object-contain" />
            <Button size="sm" variant="secondary" onClick={() => downloadImage(run.content!.url!, "image.jpg")}>
              Download image
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
