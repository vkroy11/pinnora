import { describe, expect, it } from "vitest";
import { routeClassification } from "@/lib/services/classifier-routing";

describe("routeClassification", () => {
  it("aborts as unsupported regardless of confidence", () => {
    expect(routeClassification({ kind: "unsupported", confidence: 0.99 })).toEqual({ action: "unsupported" });
  });

  it("aborts as ambiguous below 0.6 confidence", () => {
    expect(routeClassification({ kind: "email", confidence: 0.59 })).toEqual({ action: "abort_ambiguous" });
    expect(routeClassification({ kind: "email", confidence: 0 })).toEqual({ action: "abort_ambiguous" });
  });

  it("asks for confirmation between 0.6 and 0.8 confidence", () => {
    expect(routeClassification({ kind: "landing-page", confidence: 0.6 })).toEqual({
      action: "confirm",
      kind: "landing-page",
      confidence: 0.6,
    });
    expect(routeClassification({ kind: "landing-page", confidence: 0.79 })).toEqual({
      action: "confirm",
      kind: "landing-page",
      confidence: 0.79,
    });
  });

  it("proceeds automatically at 0.8 confidence and above", () => {
    expect(routeClassification({ kind: "image", confidence: 0.8 })).toEqual({
      action: "proceed",
      kind: "image",
      confidence: 0.8,
    });
    expect(routeClassification({ kind: "image", confidence: 1 })).toEqual({
      action: "proceed",
      kind: "image",
      confidence: 1,
    });
  });
});
