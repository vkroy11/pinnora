import "server-only";
import { streamText, Output } from "ai";
import { google } from "@ai-sdk/google";
import type { DispatchKind, RenderContent } from "@/db/schema";
import { landingPageOutputSchema, emailOutputSchema } from "@/lib/schemas/render-output";
import * as outputsRepo from "@/lib/db/repositories/outputs";

const GENERATION_MODEL = "gemini-3.1-pro-preview";

export type GenerationResult = { content: RenderContent; rationale: string | null };

export async function generateCreative(input: {
  runId: string;
  dispatchId: string;
  kind: DispatchKind;
  prompt: string;
  parentContent: RenderContent | null;
  signal: AbortSignal;
}): Promise<GenerationResult> {
  if (input.kind === "image") {
    // Deterministic placeholder -- we read the diff, not pay for image gen.
    const content: RenderContent = { url: `https://picsum.photos/seed/${input.runId}/800/600` };
    await outputsRepo.finalizeOutput(input.dispatchId, content, null);
    return { content, rationale: null };
  }

  const contextLine = input.parentContent
    ? `\n\nThe operator is improving on a previous creative. Prior content: ${JSON.stringify(input.parentContent)}`
    : "";
  const prompt = `${input.prompt}${contextLine}`;

  if (input.kind === "email") {
    const result = streamText({
      model: google(GENERATION_MODEL),
      system:
        "You write concise, effective marketing/transactional emails. Produce a subject line and a plain-text " +
        "body with short paragraphs, plus a one-to-two sentence rationale for why this fits the prompt.",
      prompt,
      output: Output.object({ schema: emailOutputSchema }),
      abortSignal: input.signal,
    });

    for await (const partial of result.partialOutputStream) {
      await outputsRepo.updatePartialContent(input.dispatchId, { subject: partial.subject, body: partial.body });
    }

    const final = await result.output;
    const content: RenderContent = { subject: final.subject, body: final.body };
    await outputsRepo.finalizeOutput(input.dispatchId, content, final.rationale);
    return { content, rationale: final.rationale };
  }

  // landing-page
  const result = streamText({
    model: google(GENERATION_MODEL),
    system:
      "You are a web designer who writes complete, self-contained, minified single-file HTML landing pages " +
      "with inline CSS -- real color palettes, a hero section, and a clear call-to-action. No external assets, " +
      "fonts, or scripts.",
    prompt,
    output: Output.object({ schema: landingPageOutputSchema }),
    abortSignal: input.signal,
  });

  for await (const partial of result.partialOutputStream) {
    await outputsRepo.updatePartialContent(input.dispatchId, { html: partial.html, headline: partial.headline });
  }

  const final = await result.output;
  const content: RenderContent = { html: final.html, headline: final.headline };
  await outputsRepo.finalizeOutput(input.dispatchId, content, final.rationale);
  return { content, rationale: final.rationale };
}
