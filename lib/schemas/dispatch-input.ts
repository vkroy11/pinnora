import { z } from "zod";

export const RENDER_KINDS = ["image", "landing-page", "email"] as const;

export const dispatchInputSchema = z.object({
  projectId: z.string().uuid(),
  prompt: z.string().min(1).max(4000),
  intent: z.enum(RENDER_KINDS).optional(),
  parentArtifactId: z.string().uuid().optional(),
});

export type DispatchInput = z.infer<typeof dispatchInputSchema>;
