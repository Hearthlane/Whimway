import { describe, expect, it } from "vitest";
import { updatedPlanSettings } from "../apps/mobile/src/core/plan-edit";
import { spec } from "./helpers";

describe("Outing settings submitted as one change", () => {
  it("retains typed budget and duration when transport changes, without mutating the current request", () => {
    const previous = spec().request;
    const original = structuredClone(previous);
    const next = updatedPlanSettings(previous, {
      budget: 95,
      duration: 270,
      mode: "DRIVE",
    });
    expect(next).toMatchObject({
      budget: 95,
      duration: 270,
      mode: "DRIVE",
      hardBudget: false,
    });
    expect(previous).toEqual(original);
  });
  it("enforces Free on zero and restores numeric preferences after leaving Free", () => {
    const previous = { ...spec().request, budget: 60, hardBudget: false };
    const free = updatedPlanSettings(previous, {
      budget: 0,
      duration: 240,
      mode: "WALK",
    });
    expect(free.hardBudget).toBe(true);
    const numeric = updatedPlanSettings(free, {
      budget: 70,
      duration: 240,
      mode: "WALK",
    });
    expect(numeric.hardBudget).toBe(false);
  });
  it("preserves an explicit positive ceiling and rejects invalid numeric settings", () => {
    const previous = { ...spec().request, budget: 60, hardBudget: true };
    expect(
      updatedPlanSettings(previous, {
        budget: 70,
        duration: 240,
        mode: "DRIVE",
      }).hardBudget,
    ).toBe(true);
    expect(() =>
      updatedPlanSettings(previous, {
        budget: -1,
        duration: 240,
        mode: "WALK",
      }),
    ).toThrow();
    expect(() =>
      updatedPlanSettings(previous, { budget: 70, duration: 0, mode: "WALK" }),
    ).toThrow();
  });
});
