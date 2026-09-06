import type { DispatchKind } from "@/db/schema";
import type { ClassifierOutput } from "@/lib/schemas/classifier-output";
import { CONFIDENCE_ABORT_BELOW, CONFIDENCE_AUTO_ABOVE } from "@/lib/schemas/classifier-output";

export type ClassifierRoute =
  | { action: "unsupported" }
  | { action: "abort_ambiguous" }
  | { action: "confirm"; kind: DispatchKind; confidence: number }
  | { action: "proceed"; kind: DispatchKind; confidence: number };

/** Pure confidence-band routing decision -- no DB/LLM/IO, easy to unit test in isolation. */
export function routeClassification(result: ClassifierOutput): ClassifierRoute {
  if (result.kind === "unsupported") return { action: "unsupported" };

  const kind = result.kind as DispatchKind;
  if (result.confidence < CONFIDENCE_ABORT_BELOW) return { action: "abort_ambiguous" };
  if (result.confidence < CONFIDENCE_AUTO_ABOVE) return { action: "confirm", kind, confidence: result.confidence };
  return { action: "proceed", kind, confidence: result.confidence };
}
