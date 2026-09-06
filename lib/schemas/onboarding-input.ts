import { z } from "zod";

export const onboardingSchema = z.object({
  orgSlug: z.enum(["pinnora", "skala", "google"]),
});
