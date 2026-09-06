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

const classifier = vi.hoisted(() => ({
  classifyPrompt: vi.fn(),
}));
vi.mock("@/lib/services/classifier", () => classifier);

const runEvents = vi.hoisted(() => ({
  registerAbortController: vi.fn(),
  abortRun: vi.fn(),
}));
vi.mock("@/lib/services/run-events", () => runEvents);

const { runDispatchPipeline } = await import("@/lib/services/pipeline");

describe("runDispatchPipeline classifier routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dispatchesRepo.getDispatch.mockResolvedValue({
      id: "dispatch-1",
      userId: "user-1",
      prompt: "some prompt",
      explicitIntent: null,
      parentArtifactId: null,
    });
    creditService.hold.mockResolvedValue("hold-1");
    outputsRepo.insertPendingOutput.mockResolvedValue({ id: "output-1" });
    generator.generateCreative.mockResolvedValue({ content: { headline: "hi" }, rationale: "why" });
  });

  it("aborts with no hold when the classifier says unsupported", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "unsupported", confidence: 0.95 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "unsupported", "Not supported yet.");
    expect(creditService.hold).not.toHaveBeenCalled();
  });

  it("aborts as ambiguous with no hold below 0.6 confidence", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "email", confidence: 0.4 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "ambiguous", "ambiguous");
    expect(creditService.hold).not.toHaveBeenCalled();
  });

  it("asks for confirmation between 0.6 and 0.8 without holding credits or generating yet", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "landing-page", confidence: 0.7 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setClassified).toHaveBeenCalledWith("dispatch-1", {
      kind: "landing-page",
      confidence: 0.7,
      source: "llm",
    });
    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "awaiting_confirmation");
    expect(creditService.hold).not.toHaveBeenCalled();
    expect(generator.generateCreative).not.toHaveBeenCalled();
  });

  it("proceeds automatically at 0.8+ confidence, holding credits and generating", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "image", confidence: 0.92 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setClassified).toHaveBeenCalledWith("dispatch-1", {
      kind: "image",
      confidence: 0.92,
      source: "llm",
    });
    expect(creditService.hold).toHaveBeenCalledWith("user-1", "dispatch-1");
    expect(generator.generateCreative).toHaveBeenCalled();
    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "done", "done");
  });

  it("skips the classifier entirely when an explicit intent is given (e.g. Improvise)", async () => {
    dispatchesRepo.getDispatch.mockResolvedValue({
      id: "dispatch-1",
      userId: "user-1",
      prompt: "make it punchier",
      explicitIntent: "email",
      parentArtifactId: "output-parent",
    });

    await runDispatchPipeline("dispatch-1");

    expect(classifier.classifyPrompt).not.toHaveBeenCalled();
    expect(dispatchesRepo.setClassified).toHaveBeenCalledWith("dispatch-1", {
      kind: "email",
      confidence: 1,
      source: "human",
    });
    expect(creditService.hold).toHaveBeenCalledWith("user-1", "dispatch-1");
  });
});
