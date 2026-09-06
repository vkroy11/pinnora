import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  // Run the deferred work immediately -- we only care that it *was* scheduled
  // after the queued row exists, not about real post-response execution timing.
  after: (cb: () => unknown) => cb(),
}));

const auth = vi.hoisted(() => ({
  requireOwnedProject: vi.fn(),
}));
vi.mock("@/lib/auth", () => auth);

const dispatchesRepo = vi.hoisted(() => ({
  findRecentIdempotentDispatch: vi.fn(),
  insertQueuedDispatch: vi.fn(),
}));
vi.mock("@/lib/db/repositories/dispatches", () => dispatchesRepo);

const pipeline = vi.hoisted(() => ({
  runDispatchPipeline: vi.fn(),
}));
vi.mock("@/lib/services/pipeline", () => pipeline);

const { dispatchCreative } = await import("@/app/actions/dispatch-creative");

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("dispatchCreative server action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.requireOwnedProject.mockResolvedValue({ user: { id: "user-1" }, project: { id: PROJECT_ID } });
    dispatchesRepo.findRecentIdempotentDispatch.mockResolvedValue(null);
    dispatchesRepo.insertQueuedDispatch.mockResolvedValue({ id: "dispatch-1" });
  });

  it("rejects invalid input before touching auth or the DB", async () => {
    await expect(dispatchCreative({ projectId: PROJECT_ID, prompt: "" })).rejects.toThrow();
    expect(auth.requireOwnedProject).not.toHaveBeenCalled();
    expect(dispatchesRepo.insertQueuedDispatch).not.toHaveBeenCalled();
  });

  it("auth-gates via requireOwnedProject and returns only { runId }", async () => {
    const result = await dispatchCreative({ projectId: PROJECT_ID, prompt: "a landing page for shoes" });

    expect(auth.requireOwnedProject).toHaveBeenCalledWith(PROJECT_ID);
    expect(result).toEqual({ runId: "dispatch-1" });
    expect(Object.keys(result)).toEqual(["runId"]);
  });

  it("persists a queued dispatch row before scheduling the pipeline", async () => {
    await dispatchCreative({ projectId: PROJECT_ID, prompt: "an email for our sale" });

    const insertOrder = dispatchesRepo.insertQueuedDispatch.mock.invocationCallOrder[0];
    const pipelineOrder = pipeline.runDispatchPipeline.mock.invocationCallOrder[0];
    expect(insertOrder).toBeLessThan(pipelineOrder);
    expect(pipeline.runDispatchPipeline).toHaveBeenCalledWith("dispatch-1");
  });

  it("returns the existing run id instead of dispatching twice for an identical recent request", async () => {
    dispatchesRepo.findRecentIdempotentDispatch.mockResolvedValue({ id: "existing-dispatch" });

    const result = await dispatchCreative({ projectId: PROJECT_ID, prompt: "an email for our sale" });

    expect(result).toEqual({ runId: "existing-dispatch" });
    expect(dispatchesRepo.insertQueuedDispatch).not.toHaveBeenCalled();
    expect(pipeline.runDispatchPipeline).not.toHaveBeenCalled();
  });

  it("threads explicit intent and parentArtifactId through to the queued row", async () => {
    const parentArtifactId = "22222222-2222-4222-8222-222222222222";
    await dispatchCreative({
      projectId: PROJECT_ID,
      prompt: "make it punchier",
      intent: "email",
      parentArtifactId,
    });

    expect(dispatchesRepo.insertQueuedDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ explicitIntent: "email", parentArtifactId }),
    );
  });
});
