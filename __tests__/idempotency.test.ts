import { describe, expect, it } from "vitest";
import { computeIdempotencyKey } from "@/lib/idempotency";

describe("computeIdempotencyKey", () => {
  it("is identical for identical (userId, projectId, prompt, intent)", () => {
    const a = computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make an email", intent: "email" });
    const b = computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make an email", intent: "email" });
    expect(a).toBe(b);
  });

  it("differs when any part of the tuple differs", () => {
    const base = computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make an email", intent: "email" });
    expect(computeIdempotencyKey({ userId: "u2", projectId: "p1", prompt: "make an email", intent: "email" })).not.toBe(base);
    expect(computeIdempotencyKey({ userId: "u1", projectId: "p2", prompt: "make an email", intent: "email" })).not.toBe(base);
    expect(computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make a landing page", intent: "email" })).not.toBe(base);
    expect(computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make an email", intent: undefined })).not.toBe(base);
  });

  it("is insensitive to surrounding whitespace in the prompt", () => {
    const a = computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "make an email" });
    const b = computeIdempotencyKey({ userId: "u1", projectId: "p1", prompt: "  make an email  " });
    expect(a).toBe(b);
  });
});
