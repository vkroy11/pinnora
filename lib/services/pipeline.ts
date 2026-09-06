import "server-only";
import * as dispatchesRepo from "@/lib/db/repositories/dispatches";
import * as outputsRepo from "@/lib/db/repositories/outputs";
import * as creditService from "@/lib/services/credit-service";
import { classifyPrompt } from "@/lib/services/classifier";
import { generateCreative } from "@/lib/services/generator";
import { publish, registerAbortController } from "@/lib/services/run-events";
import { routeClassification } from "@/lib/services/classifier-routing";
import type { DispatchKind } from "@/db/schema";

const CANCEL_POLL_MS = 500;

/** Polls the DB-backed cancellation flag and aborts `controller` when it's set. On Vercel
 * the SSE route may be a different serverless instance than this one and can only signal
 * cancellation through the DB -- it has no access to this process's AbortController. */
function watchForCancellation(dispatchId: string, controller: AbortController) {
  const interval = setInterval(async () => {
    if (controller.signal.aborted) return;
    if (await dispatchesRepo.isCancelRequested(dispatchId)) controller.abort();
  }, CANCEL_POLL_MS);
  return () => clearInterval(interval);
}

/** Entry point: runs classification (unless explicit intent given) and routes accordingly. */
export async function runDispatchPipeline(dispatchId: string) {
  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch) return;

  const controller = new AbortController();
  registerAbortController(dispatchId, controller);

  if (dispatch.explicitIntent) {
    await dispatchesRepo.setClassified(dispatchId, {
      kind: dispatch.explicitIntent,
      confidence: 1,
      source: "human",
    });
    await proceedWithDispatch(dispatchId, dispatch.explicitIntent, controller);
    return;
  }

  await dispatchesRepo.setStatus(dispatchId, "classifying", "classifying");
  const stopWatching = watchForCancellation(dispatchId, controller);
  let classification;
  try {
    classification = await classifyPrompt(dispatch.prompt, controller.signal);
  } catch (err) {
    if (controller.signal.aborted) {
      await dispatchesRepo.setError(dispatchId, "cancelled", "Cancelled during classification");
      publish(dispatchId, { type: "cancelled" });
      return;
    }
    await dispatchesRepo.setError(dispatchId, "failed", `Classifier error: ${(err as Error).message}`);
    publish(dispatchId, { type: "error", message: "Classifier error" });
    return;
  } finally {
    stopWatching();
  }

  const route = routeClassification(classification);

  switch (route.action) {
    case "unsupported":
      await dispatchesRepo.setError(dispatchId, "unsupported", "Not supported yet.");
      publish(dispatchId, { type: "unsupported" });
      return;
    case "abort_ambiguous":
      await dispatchesRepo.setStatus(dispatchId, "ambiguous", "ambiguous");
      publish(dispatchId, { type: "ambiguous" });
      return;
    case "confirm":
      await dispatchesRepo.setClassified(dispatchId, { kind: route.kind, confidence: route.confidence, source: "llm" });
      await dispatchesRepo.setStatus(dispatchId, "awaiting_confirmation");
      publish(dispatchId, { type: "awaiting_confirmation", kind: route.kind, confidence: route.confidence });
      return;
    case "proceed":
      await dispatchesRepo.setClassified(dispatchId, { kind: route.kind, confidence: route.confidence, source: "llm" });
      publish(dispatchId, { type: "classified", kind: route.kind, confidence: route.confidence, source: "llm" });
      await proceedWithDispatch(dispatchId, route.kind, controller);
      return;
  }
}

/** Called either automatically (confidence > 0.8 / explicit intent) or after a human confirms a 0.6-0.8 chip. */
export async function proceedWithDispatch(dispatchId: string, kind: DispatchKind, controller: AbortController) {
  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch) return;

  const holdId = await creditService.hold(dispatch.userId, dispatchId);
  await dispatchesRepo.setStatus(dispatchId, "dispatched", "dispatched");
  publish(dispatchId, { type: "dispatched" });

  const pendingOutput = await outputsRepo.insertPendingOutput({
    dispatchId,
    kind,
    parentId: dispatch.parentArtifactId ?? null,
  });

  const parentOutput = dispatch.parentArtifactId
    ? await outputsRepo.getOutputById(dispatch.parentArtifactId)
    : null;

  const stopWatching = watchForCancellation(dispatchId, controller);
  try {
    const { content, rationale } = await generateCreative({
      runId: dispatchId,
      dispatchId,
      kind,
      prompt: dispatch.prompt,
      parentContent: parentOutput?.content ?? null,
      signal: controller.signal,
    });
    await creditService.settle(holdId);
    await dispatchesRepo.setStatus(dispatchId, "done", "done");
    publish(dispatchId, { type: "done", content, rationale, outputId: pendingOutput.id });
  } catch (err) {
    await creditService.release(holdId);
    if (controller.signal.aborted) {
      await dispatchesRepo.setError(dispatchId, "cancelled", "Cancelled by client");
      publish(dispatchId, { type: "cancelled" });
    } else {
      const message = (err as Error).message || "Render error";
      await dispatchesRepo.setError(dispatchId, "failed", message);
      publish(dispatchId, { type: "error", message });
    }
  } finally {
    stopWatching();
  }
}

/** Confirm chip clicked on a 0.6-0.8 ambiguous run: locks in the human-picked kind and proceeds. */
export async function confirmAndProceed(dispatchId: string, kind: DispatchKind) {
  await dispatchesRepo.confirmKind(dispatchId, kind);
  const controller = new AbortController();
  registerAbortController(dispatchId, controller);
  await proceedWithDispatch(dispatchId, kind, controller);
}
