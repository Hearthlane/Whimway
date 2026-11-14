import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { Planner } from "../lib/planner";
import { FixtureAI, FixturePlaces, FixtureRoutes } from "../lib/providers/fixtures";
import { buildRequest, interpret } from "../lib/intent";
import { emptyProfile } from "../lib/profile";
import { activities, cuisines, groupByKey, inGroup, isEatery, orderByTaste } from "../lib/guide";

const future = DateTime.now().setZone("America/Toronto").plus({ days: 3 });
const base = () => ({
  ...buildRequest("", interpret("", future), { ...emptyProfile(), mode: "TRANSIT" as const }, future),
  date: future.toISODate()!,
  startTime: "18:30",
});
const planner = (r: ReturnType<typeof base>) =>
  new Planner(new FixturePlaces(r), new FixtureRoutes(), new FixtureAI(), true);

describe("guided planning", () => {
  it("offers open places for every cuisine and every kind of fun", async () => {
    const r = base();
    for (const g of [...cuisines, ...activities]) {
      const { places } = await planner(r).options(r, g);
      expect(places.length, g.key).toBeGreaterThanOrEqual(2);
      expect(places.every((p) => inGroup(p, g)), g.key).toBe(true);
    }
  });
  it("lists the closest matches first-ish and reports distance", async () => {
    const r = base();
    const { places } = await planner(r).options(r, groupByKey("asian")!);
    expect(places[0].meters).toBeLessThan(3000);
    expect(places.every((p) => typeof p.meters === "number")).toBe(true);
  });
  it("a bar that serves tacos is not offered as Mexican food", () => {
    const bar = { category: "cocktail bar", types: ["cocktail_bar", "bar", "mexican_restaurant"] };
    expect(inGroup(bar, groupByKey("mexican")!)).toBe(false);
    expect(inGroup(bar, groupByKey("drinks")!)).toBe(true);
  });
  it("builds the plan around the places the person picked", async () => {
    const r = base();
    const food = (await planner(r).options(r, groupByKey("asian")!)).places[0];
    const fun = (await planner(r).options(r, groupByKey("games")!)).places[0];
    const request = { ...r, anchorPlaceIds: [food.id, fun.id], pace: "relaxed" as const, duration: 210 };
    const plan = await planner(request).generate(request);
    expect(plan.stops.map((s) => s.placeId).sort()).toEqual([food.id, fun.id].sort());
    expect(plan.stops[0].placeId).toBe(food.id); // evening: dinner first
  });
  it("skips restaurants and cafés when the group has eaten", async () => {
    const r = { ...base(), skipFood: true };
    const plan = await planner(r).generate(r);
    expect(plan.stops.length).toBeGreaterThanOrEqual(2);
    expect(plan.stops.some((s) => isEatery(s.place))).toBe(false);
  });
  it("puts a person's usual choices first, and keeps the broad order for newcomers", () => {
    expect(orderByTaste(cuisines, []).map((g) => g.key)).toEqual(cuisines.map((g) => g.key));
    const ordered = orderByTaste(cuisines, ["mexican restaurant"]);
    expect(ordered[0]).toMatchObject({ key: "mexican", usual: true });
    expect(ordered[1].usual).toBe(false);
  });
});
