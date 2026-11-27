import { describe, expect, it } from "vitest";
import { interpretEdit, type EditStop } from "@/lib/magic-edit";

const stop = (name: string, category: string, types: string[], locked = false): EditStop => ({
  placeId: name,
  locked,
  name,
  category,
  types,
  priceHigh: 20,
  travel: 500,
});
const req = { budget: 50, mode: "WALK", duration: 240, vibes: [], area: { center: { lat: 0, lng: 0 }, radius: 2000, locked: true }, indoorOnly: false } as never;
const plan = [
  stop("Varley Gallery", "art gallery", ["art_gallery"]),
  stop("OEB Breakfast", "brunch restaurant", ["brunch_restaurant", "restaurant"], true),
  stop("STACKT market", "market", ["market"], true),
];

describe("Magic Edit does what was asked (round 1 fixes)", () => {
  it("gibberish is not guessed at", () => {
    const op = interpretEdit("asdkjh qwe zzzz !!!", plan, req);
    expect(op.kind).toBe("noop");
    expect(op.summary).toMatch(/didn't understand/);
  });
  it("'brunch first' reorders instead of replacing", () => {
    const op = interpretEdit("Swap the order: brunch first", plan, req);
    expect(op.kind).toBe("reorder");
    expect(op.order).toEqual([1, 0, 2]);
  });
  it("'move the gallery to the end' moves it", () => {
    const op = interpretEdit("move the gallery to the end", plan, req);
    expect(op.order).toEqual([1, 2, 0]);
  });
  it("naming a kept stop changes that stop, not another one", () => {
    const op = interpretEdit("Swap the third stop (STACKT) for somewhere quieter", plan, req);
    expect(op.kind).toBe("replace");
    expect(op.targets).toEqual([2]);
    expect(op.unlock).toEqual([2]);
  });
  it("asking about a dinner the plan doesn't have adds one", () => {
    const op = interpretEdit("make dinner fancier", plan, req);
    expect(op.kind).toBe("add");
    expect(op.action).toMatch(/dinner restaurant, somewhere special/);
  });
  it("'dinner at 6:30' moves the meal to about then", () => {
    const evening = [stop("Bowling", "bowling alley", ["bowling_alley"]), stop("Pizzeria", "pizza restaurant", ["restaurant"]), stop("Gelato", "ice cream shop", ["ice_cream_shop"])];
    const op = interpretEdit("dinner at 6:30", evening, req);
    expect(op.kind).toBe("reorder");
    expect(op.mealAt).toEqual({ index: 1, minute: 18 * 60 + 30 });
  });
  it("'make it shorter' drops something that isn't the meal", () => {
    const evening = [stop("Bowling", "bowling alley", ["bowling_alley"]), stop("Pizzeria", "pizza restaurant", ["restaurant"])];
    const op = interpretEdit("make it shorter", evening, req);
    expect(op.kind).toBe("remove");
    expect(op.targets).toEqual([0]);
  });
});
