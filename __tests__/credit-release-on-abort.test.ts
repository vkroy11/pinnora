import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchesRepo = vi.hoisted(() => ({
  getDispatch: vi.fn(),
  setStatus: vi.fn(),
  setError: vi.fn(),
  setClassified: vi.fn(),
  confirmKind: vi.fn(),
  isCancelRequested: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/db/repositories/dispatches", () => dispatchesRepo);

const outputsRepo = vi.hoisted(() => ({
  insertPendingOutput: vi.fn(),
  getOutputById: vi.fn(),
}));
vi.mock("@/lib/db/repositories/outputs", () => outputsRepo);

const creditService = vi.hoisted(() => ({
  hold: vi.fn(),
  settle: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/services/credit-service", () => creditService);

const generator = vi.hoisted(() => ({
  generateCreative: vi.fn(),
}));
vi.mock("@/lib/services/generator", () => generator);

const runEvents = vi.hoisted(() => ({
  registerAbortController: vi.fn(),
  abortRun: vi.fn(),
}));
vi.mock("@/lib/services/run-events", () => runEvents);

const { proceedWithDispatch } = await import("@/lib/services/pipeline");

describe("credit hold/settle/release around generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchesRepo.getDispatch.mockResolvedValue({
      id: "dispatch-1",
      userId: "user-1",
      prompt: "a landing page for shoes",
      parentArtifactId: null,
    });
    creditService.hold.mockResolvedValue("hold-1");
    outputsRepo.insertPendingOutput.mockResolvedValue({ id: "output-1" });
  });

  it("releases the hold and marks the dispatch cancelled when the client aborts mid-generation", async () => {
    const controller = new AbortController();
    generator.generateCreative.mockImplementation(async () => {
      controller.abort();
      throw new DOMException("Aborted", "AbortError");
    });

    await proceedWithDispatch("dispatch-1", "landing-page", controller);

    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(creditService.settle).not.toHaveBeenCalled();
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "cancelled", expect.any(String));
  });

  it("settles the hold and marks the dispatch done on success", async () => {
    generator.generateCreative.mockResolvedValue({
      content: { headline: "hi" },
      rationale: "because it fits the prompt",
    });

    await proceedWithDispatch("dispatch-1", "landing-page", new AbortController());

    expect(creditService.settle).toHaveBeenCalledWith("hold-1");
    expect(creditService.release).not.toHaveBeenCalled();
    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "done", "done");
  });

  it("releases the hold on a non-abort render error too", async () => {
    generator.generateCreative.mockRejectedValue(new Error("model blew up"));

    await proceedWithDispatch("dispatch-1", "landing-page", new AbortController());

    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(creditService.settle).not.toHaveBeenCalled();
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "failed", expect.stringContaining("model blew up"));
  });
});
