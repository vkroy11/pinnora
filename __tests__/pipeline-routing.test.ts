import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchesRepo = vi.hoisted(() => ({
  getDispatch: vi.fn(),
  setStatus: vi.fn(),
  setError: vi.fn(),
  setClassified: vi.fn(),
  setClassifierModel: vi.fn(),
  setGenerationModel: vi.fn(),
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
  GENERATION_MODEL: "test-generation-model",
}));
vi.mock("@/lib/services/generator", () => generator);

const classifier = vi.hoisted(() => ({
  classifyPrompt: vi.fn(),
  CLASSIFIER_MODEL: "test-classifier-model",
}));
vi.mock("@/lib/services/classifier", () => classifier);

const runEvents = vi.hoisted(() => ({
  publish: vi.fn(),
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

  it("holds credits up front, before the classifier runs", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "image", confidence: 0.92 });

    await runDispatchPipeline("dispatch-1");

    const holdOrder = creditService.hold.mock.invocationCallOrder[0];
    const classifyOrder = classifier.classifyPrompt.mock.invocationCallOrder[0];
    expect(holdOrder).toBeLessThan(classifyOrder);
  });

  it("releases the hold when the classifier rejects the prompt as unsupported", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "unsupported", confidence: 0.95 });

    await runDispatchPipeline("dispatch-1");

    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(creditService.settle).not.toHaveBeenCalled();
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "unsupported", "Not supported yet.");
    expect(generator.generateCreative).not.toHaveBeenCalled();
  });

  it("releases the hold on classifier rejection below 0.6 confidence", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "email", confidence: 0.4 });

    await runDispatchPipeline("dispatch-1");

    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(creditService.settle).not.toHaveBeenCalled();
    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "ambiguous", "ambiguous");
    expect(generator.generateCreative).not.toHaveBeenCalled();
  });

  it("releases the hold when a classifier error aborts the run", async () => {
    classifier.classifyPrompt.mockRejectedValue(new Error("classifier exploded"));

    await runDispatchPipeline("dispatch-1");

    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "failed", expect.stringContaining("classifier exploded"));
  });

  it("parks a 0.6-0.8 run for confirmation and releases the hold while it waits", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "landing-page", confidence: 0.7 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setClassified).toHaveBeenCalledWith("dispatch-1", {
      kind: "landing-page",
      confidence: 0.7,
      source: "llm",
    });
    expect(dispatchesRepo.setStatus).toHaveBeenCalledWith("dispatch-1", "awaiting_confirmation");
    expect(creditService.release).toHaveBeenCalledWith("hold-1");
    expect(generator.generateCreative).not.toHaveBeenCalled();
  });

  it("proceeds automatically at 0.8+ confidence, keeping the hold through generation", async () => {
    classifier.classifyPrompt.mockResolvedValue({ kind: "image", confidence: 0.92 });

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setClassified).toHaveBeenCalledWith("dispatch-1", {
      kind: "image",
      confidence: 0.92,
      source: "llm",
    });
    expect(generator.generateCreative).toHaveBeenCalled();
    expect(creditService.settle).toHaveBeenCalledWith("hold-1");
    expect(creditService.release).not.toHaveBeenCalled();
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

  it("fails the run without generating when the balance can't cover the hold", async () => {
    creditService.hold.mockResolvedValue(null);

    await runDispatchPipeline("dispatch-1");

    expect(dispatchesRepo.setError).toHaveBeenCalledWith("dispatch-1", "failed", "Not enough credits for this run.");
    expect(classifier.classifyPrompt).not.toHaveBeenCalled();
    expect(generator.generateCreative).not.toHaveBeenCalled();
  });
});
