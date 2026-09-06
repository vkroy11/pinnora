import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchesRepo = vi.hoisted(() => ({
  getDispatch: vi.fn(),
  setError: vi.fn(),
  findStaleRuns: vi.fn(),
}));
vi.mock("@/lib/db/repositories/dispatches", () => dispatchesRepo);

const creditService = vi.hoisted(() => ({
  releaseOpenHolds: vi.fn(),
}));
vi.mock("@/lib/services/credit-service", () => creditService);

const runEvents = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("@/lib/services/run-events", () => runEvents);

const { finalizeCancellationIfStuck, reapStaleRuns } = await import("@/lib/services/run-recovery");

describe("run recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  async function runWithTimers(promise: Promise<unknown>) {
    await vi.runAllTimersAsync();
    return promise;
  }

  it("finalizes a cancelled run whose pipeline is no longer alive, releasing its hold", async () => {
    dispatchesRepo.getDispatch.mockResolvedValue({ id: "d1", status: "dispatched" });

    await runWithTimers(finalizeCancellationIfStuck("d1"));

    expect(creditService.releaseOpenHolds).toHaveBeenCalledWith("d1");
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("d1", "cancelled", "Cancelled by operator");
  });

  it("leaves the run alone when the live pipeline already finalized it", async () => {
    dispatchesRepo.getDispatch.mockResolvedValue({ id: "d1", status: "cancelled" });

    await runWithTimers(finalizeCancellationIfStuck("d1"));

    expect(creditService.releaseOpenHolds).not.toHaveBeenCalled();
    expect(dispatchesRepo.setError).not.toHaveBeenCalled();
  });

  it("does not steal a run that completed successfully in the grace window", async () => {
    dispatchesRepo.getDispatch.mockResolvedValue({ id: "d1", status: "done" });

    await runWithTimers(finalizeCancellationIfStuck("d1"));

    expect(creditService.releaseOpenHolds).not.toHaveBeenCalled();
  });

  it("reaps interrupted runs and releases their orphaned holds", async () => {
    dispatchesRepo.findStaleRuns.mockResolvedValue([{ id: "d1" }, { id: "d2" }]);

    const reaped = await reapStaleRuns("project-1");

    expect(reaped).toBe(2);
    expect(creditService.releaseOpenHolds).toHaveBeenCalledWith("d1");
    expect(creditService.releaseOpenHolds).toHaveBeenCalledWith("d2");
    expect(dispatchesRepo.setError).toHaveBeenCalledWith("d1", "failed", "Run interrupted before it finished.");
  });

  it("does nothing when no runs are stale", async () => {
    dispatchesRepo.findStaleRuns.mockResolvedValue([]);

    const reaped = await reapStaleRuns("project-1");

    expect(reaped).toBe(0);
    expect(creditService.releaseOpenHolds).not.toHaveBeenCalled();
  });
});
