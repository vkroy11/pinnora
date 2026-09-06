import { z } from "zod";
import { RENDER_KINDS } from "./dispatch-input";

export const confirmKindSchema = z.object({
  runId: z.string().uuid(),
  kind: z.enum(RENDER_KINDS),
});
