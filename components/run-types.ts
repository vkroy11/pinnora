import type { DispatchKind, RenderContent } from "@/db/schema";

export type ClientRunStatus =
  | "connecting"
  | "classifying"
  | "awaiting_confirmation"
  | "ambiguous"
  | "unsupported"
  | "dispatched"
  | "streaming"
  | "done"
  | "failed"
  | "cancelled";

export type ClientRun = {
  runId: string;
  prompt: string;
  parentArtifactId: string | null;
  status: ClientRunStatus;
  kind?: DispatchKind;
  confidence?: number;
  content?: RenderContent | null;
  rationale?: string | null;
  error?: string | null;
  outputId?: string;
};
