import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { Planner } from "../lib/planner";
import {
  FixtureAI,
  FixturePlaces,
  FixtureRoutes,
} from "../lib/providers/fixtures";
import { buildRequest, interpret } from "../lib/intent";
import { emptyProfile } from "../lib/profile";
import {
  activities,
  cuisines,
  groupByKey,
  inGroup,
  isEatery,
  orderByTaste,
} from "../lib/guide";

const future = DateTime.now().setZone("America/Toronto").plus({ days: 3 });
const base = () => ({
  ...buildRequest(
    "",
    interpret("", future),
    { ...emptyProfile(), mode: "TRANSIT" as const },
    future,
  ),
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
      expect(places.length, g.key).toBeGreaterThanOrEqual(1);
      expect(
        places.every((p) => inGroup(p, g)),
        g.key,
      ).toBe(true);
    }
  });
  it("lists the closest matches first-ish and reports distance", async () => {
    const r = base();
    const { places } = await planner(r).options(r, groupByKey("asian")!);
    expect(places[0].meters).toBeLessThan(3000);
    expect(places.every((p) => typeof p.meters === "number")).toBe(true);
  });
  it("a bar that serves tacos is not offered as Mexican food", () => {
    const bar = {
      category: "cocktail bar",
      types: ["cocktail_bar", "bar", "mexican_restaurant"],
    };
    expect(inGroup(bar, groupByKey("mexican")!)).toBe(false);
    expect(inGroup(bar, groupByKey("drinks")!)).toBe(true);
  });
  it("builds the plan around the places the person picked", async () => {
    const r = base();
    const food = (await planner(r).options(r, groupByKey("asian")!)).places[0];
    const fun = (await planner(r).options(r, groupByKey("games")!)).places[0];
    const request = {
      ...r,
      anchorPlaceIds: [food.id, fun.id],
      pace: "relaxed" as const,
      duration: 210,
    };
    const plan = await planner(request).generate(request);
    expect(plan.stops.map((s) => s.placeId).sort()).toEqual(
      [food.id, fun.id].sort(),
    );
    expect(plan.stops[0].placeId).toBe(food.id); // evening: dinner first
  });
  it("any offered food and fun pair makes a full plan, in every area and time slot", async () => {
    const { areas } = await import("../lib/areas");
    for (const area of areas)
      for (const startTime of ["12:00", "14:30", "18:30", "20:30"]) {
        const r = {
          ...buildRequest(
            "",
            interpret("", future),
            { ...emptyProfile(), mode: "TRANSIT" as const },
            future,
            { area },
          ),
          date: future.toISODate()!,
          startTime,
        };
        for (const c of cuisines)
          for (const k of activities) {
            const food = (await planner(r).options(r, c)).places;
            const fun = (await planner(r).options(r, k)).places;
            if (!food.length || !fun.length) continue;
            const pick = [food[food.length - 1].id, fun[fun.length - 1].id];
            if (pick[0] === pick[1]) continue;
            const request = {
              ...r,
              anchorPlaceIds: pick,
              pace: "relaxed" as const,
              duration: 210,
            };
            const label = `${area.key} ${startTime} ${c.key}+${k.key} ${pick.join(",")}`;
            const plan = await planner(request)
              .generate(request)
              .catch((e) => {
                throw new Error(`${label}: ${(e as Error).message}`);
              });
            expect(
              plan.stops.map((s) => s.placeId),
              label,
            ).toEqual(expect.arrayContaining(pick));
          }
      }
  }, 180000);
  it("skips restaurants and cafés when the group has eaten", async () => {
    const r = { ...base(), skipFood: true };
    const plan = await planner(r).generate(r);
    expect(plan.stops.length).toBeGreaterThanOrEqual(2);
    expect(plan.stops.some((s) => isEatery(s.place))).toBe(false);
  });
  it("puts a person's usual choices first, and keeps the broad order for newcomers", () => {
    expect(orderByTaste(cuisines, []).map((g) => g.key)).toEqual(
      cuisines.map((g) => g.key),
    );
    const ordered = orderByTaste(cuisines, ["mexican restaurant"]);
    expect(ordered[0]).toMatchObject({ key: "mexican", usual: true });
    expect(ordered[1].usual).toBe(false);
  });
});
