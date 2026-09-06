import { z } from "zod";
import { RENDER_KINDS } from "./dispatch-input";

// The classifier may also report "unsupported" for anything outside the three
// render kinds we ship (e.g. "make me a video") -- that path aborts with
// "Not supported yet." before any DB row/hold/render happens.
export const CLASSIFIER_KINDS = [...RENDER_KINDS, "unsupported"] as const;

/** What the small classifier model must return, forced to JSON-only output. */
export const classifierOutputSchema = z.object({
  kind: z.enum(CLASSIFIER_KINDS),
  confidence: z.number().min(0).max(1),
});

export type ClassifierOutput = z.infer<typeof classifierOutputSchema>;

export const CONFIDENCE_ABORT_BELOW = 0.6;
export const CONFIDENCE_AUTO_ABOVE = 0.8;
