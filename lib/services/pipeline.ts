import "server-only";
import * as dispatchesRepo from "@/lib/db/repositories/dispatches";
import * as outputsRepo from "@/lib/db/repositories/outputs";
import * as creditService from "@/lib/services/credit-service";
import { classifyPrompt, CLASSIFIER_MODEL } from "@/lib/services/classifier";
import { generateCreative, GENERATION_MODEL } from "@/lib/services/generator";
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

async function failInsufficientCredits(dispatchId: string) {
  await dispatchesRepo.setError(dispatchId, "failed", "Not enough credits for this run.");
  publish(dispatchId, { type: "error", message: "Not enough credits for this run." });
}

/**
 * Entry point. The credit hold is taken *before* the classifier runs, so the reservation
 * covers the whole run -- which is what makes "release on classifier rejection" meaningful
 * rather than a no-op. Every early exit below therefore releases it.
 */
export async function runDispatchPipeline(dispatchId: string) {
  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch) return;

  const controller = new AbortController();
  registerAbortController(dispatchId, controller);

  const holdId = await creditService.hold(dispatch.userId, dispatchId);
  if (!holdId) {
    await failInsufficientCredits(dispatchId);
    return;
  }

  if (dispatch.explicitIntent) {
    await dispatchesRepo.setClassified(dispatchId, {
      kind: dispatch.explicitIntent,
      confidence: 1,
      source: "human",
    });
    await generateForDispatch(dispatchId, dispatch.explicitIntent, holdId, controller);
    return;
  }

  await dispatchesRepo.setStatus(dispatchId, "classifying", "classifying");
  await dispatchesRepo.setClassifierModel(dispatchId, CLASSIFIER_MODEL);
  const stopWatching = watchForCancellation(dispatchId, controller);
  let classification;
  try {
    classification = await classifyPrompt(dispatch.prompt, controller.signal);
  } catch (err) {
    // Classifier failed or was cancelled: nothing was generated, so give the credits back.
    await creditService.release(holdId);
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
      // Classifier rejection: no render will happen, so the hold is released.
      await creditService.release(holdId);
      await dispatchesRepo.setError(dispatchId, "unsupported", "Not supported yet.");
      publish(dispatchId, { type: "unsupported" });
      return;
    case "abort_ambiguous":
      // Classifier rejection (confidence < 0.6): release the hold, nothing was rendered.
      await creditService.release(holdId);
      await dispatchesRepo.setStatus(dispatchId, "ambiguous", "ambiguous");
      publish(dispatchId, { type: "ambiguous" });
      return;
    case "confirm":
      // Parked waiting on a human. Release rather than sit on the operator's credits
      // indefinitely -- confirmAndProceed takes a fresh hold when they pick a kind.
      await creditService.release(holdId);
      await dispatchesRepo.setClassified(dispatchId, { kind: route.kind, confidence: route.confidence, source: "llm" });
      await dispatchesRepo.setStatus(dispatchId, "awaiting_confirmation");
      publish(dispatchId, { type: "awaiting_confirmation", kind: route.kind, confidence: route.confidence });
      return;
    case "proceed":
      await dispatchesRepo.setClassified(dispatchId, { kind: route.kind, confidence: route.confidence, source: "llm" });
      publish(dispatchId, { type: "classified", kind: route.kind, confidence: route.confidence, source: "llm" });
      await generateForDispatch(dispatchId, route.kind, holdId, controller);
      return;
  }
}

/** Renders the creative against an already-reserved hold: settle on success, release on
 * render error and on client abort. */
export async function generateForDispatch(
  dispatchId: string,
  kind: DispatchKind,
  holdId: string,
  controller: AbortController,
) {
  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch) return;

  await dispatchesRepo.setGenerationModel(dispatchId, GENERATION_MODEL);
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

/** Confirm chip clicked on a 0.6-0.8 ambiguous run: locks in the human-picked kind, takes a
 * fresh hold (the classifier-time one was released while the run was parked), and proceeds. */
export async function confirmAndProceed(dispatchId: string, kind: DispatchKind) {
  const dispatch = await dispatchesRepo.getDispatch(dispatchId);
  if (!dispatch) return;

  await dispatchesRepo.confirmKind(dispatchId, kind);
  const controller = new AbortController();
  registerAbortController(dispatchId, controller);

  const holdId = await creditService.hold(dispatch.userId, dispatchId);
  if (!holdId) {
    await failInsufficientCredits(dispatchId);
    return;
  }
  await generateForDispatch(dispatchId, kind, holdId, controller);
}
