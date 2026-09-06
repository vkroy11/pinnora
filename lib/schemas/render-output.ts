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
  // The brief's structured shape, kept alongside the rendered document: the same hero copy
  // and CTA as plain fields, so the artifact is queryable//re-usable without parsing HTML.
  headline: z.string().describe("The hero headline, as plain text"),
  body: z.string().describe("The hero subheadline / supporting copy, as plain text"),
  ctaLabel: z.string().describe("The call-to-action button label used in the page"),
  ctaUrl: z.string().describe("The call-to-action destination URL (a placeholder is fine)"),
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
