import { z } from "zod";

/** landing-page: AI SDK structured-output streaming target. A real, self-contained mini website. */
export const landingPageOutputSchema = z.object({
  html: z
    .string()
    .describe(
      "A complete, self-contained, minified single-file HTML5 document (<!doctype html> through </html>) " +
        "with an inline <style> tag -- no external CSS/JS/fonts/images. Use a real color palette that fits " +
        "the brand/prompt, a hero section with a headline and subheadline, a body/features section, and one " +
        "clear call-to-action button.",
    ),
  headline: z.string().describe("The hero headline, duplicated as plain text for grid previews and lineage context"),
  rationale: z.string().describe("One or two sentences on why this structure/copy/color choice fits the prompt"),
});
export type LandingPageOutput = z.infer<typeof landingPageOutputSchema>;

/** email: AI SDK structured-output streaming target. */
export const emailOutputSchema = z.object({
  subject: z.string().describe("The email subject line"),
  body: z.string().describe("The email body -- plain text, short paragraphs"),
  rationale: z.string().describe("One or two sentences on why this subject/body fits the prompt"),
});
export type EmailOutput = z.infer<typeof emailOutputSchema>;
