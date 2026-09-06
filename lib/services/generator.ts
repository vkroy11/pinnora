import "server-only";
import { streamText, Output } from "ai";
import { google } from "@ai-sdk/google";
import type { DispatchKind, RenderContent } from "@/db/schema";
import { renderOutputSchema } from "@/lib/schemas/render-output";
import * as outputsRepo from "@/lib/db/repositories/outputs";
import { publish } from "@/lib/services/run-events";

const GENERATION_MODEL = "gemini-2.5-flash";

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

  const result = streamText({
    model: google(GENERATION_MODEL),
    system: `You write ${input.kind === "email" ? "marketing emails" : "landing page copy"}. Produce a headline, body, a CTA label, a CTA URL (placeholder is fine), and a one-to-two sentence rationale for why this structure/content fits the prompt.`,
    prompt: `${input.prompt}${contextLine}`,
    output: Output.object({ schema: renderOutputSchema }),
    abortSignal: input.signal,
  });

  for await (const partial of result.partialOutputStream) {
    const partialContent: RenderContent = {
      headline: partial.headline,
      body: partial.body,
      ctaLabel: partial.ctaLabel,
      ctaUrl: partial.ctaUrl,
    };
    await outputsRepo.updatePartialContent(input.dispatchId, partialContent);
    publish(input.runId, { type: "partial", content: partialContent });
  }

  const final = await result.output;
  const content: RenderContent = {
    headline: final.headline,
    body: final.body,
    ctaLabel: final.ctaLabel,
    ctaUrl: final.ctaUrl,
  };
  await outputsRepo.finalizeOutput(input.dispatchId, content, final.rationale);
  return { content, rationale: final.rationale };
}
