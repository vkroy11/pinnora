import "server-only";
import { generateText, Output } from "ai";
import { google } from "@ai-sdk/google";
import { classifierOutputSchema, type ClassifierOutput } from "@/lib/schemas/classifier-output";

export const CLASSIFIER_MODEL = "gemini-2.5-flash-lite";

const SYSTEM_PROMPT = `You classify a creative-generation prompt into exactly one kind.
Valid kinds: "image", "landing-page", "email", or "unsupported" (anything that isn't
one of the first three, e.g. video, a document, code, a chatbot reply, etc).
Respond with your best-guess kind and a confidence score from 0 to 1 reflecting how
sure you are that this is what the operator wants. Output JSON only.`;

export async function classifyPrompt(prompt: string, signal?: AbortSignal): Promise<ClassifierOutput> {
  const { output } = await generateText({
    model: google(CLASSIFIER_MODEL),
    system: SYSTEM_PROMPT,
    prompt,
    output: Output.object({ schema: classifierOutputSchema }),
    abortSignal: signal,
  });
  return output;
}
