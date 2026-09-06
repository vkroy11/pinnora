import { z } from "zod";

/** Structured-output schema for landing-page and email generation via AI SDK streamObject. */
export const renderOutputSchema = z.object({
  headline: z.string().describe("A short, punchy headline for the creative"),
  body: z.string().describe("The main body copy"),
  ctaLabel: z.string().describe("Call-to-action button label"),
  ctaUrl: z.string().describe("Call-to-action destination URL (can be a placeholder)"),
  rationale: z.string().describe("One or two sentences on why this structure/content fits the prompt"),
});

export type RenderOutput = z.infer<typeof renderOutputSchema>;
