import { z } from "zod";

export const renameProjectSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string().min(1).max(120),
});
