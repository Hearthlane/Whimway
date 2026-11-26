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
  customGroup,
  readStated,
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
    const { places } = await planner(r).options(r, groupByKey("japanese")!);
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
    const food = (await planner(r).options(r, groupByKey("japanese")!))
      .places[0];
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
  }, 360000);
  it("finds places for something typed instead of picked", async () => {
    const r = base();
    for (const [said, expected] of [
      ["tacos", /mexican/],
      ["somewhere with a view", /observation|beach|island|observatory/],
      ["board games", /game/],
      ["Kinka", /japanese/],
    ] as const) {
      const { places } = await planner(r).options(r, customGroup(said));
      expect(places.length, said).toBeGreaterThanOrEqual(1);
      expect(
        `${places[0].category} ${places[0].types.join(" ")}`,
        said,
      ).toMatch(expected);
    }
    expect((await planner(r).options(r, customGroup("zzzz"))).places).toEqual(
      [],
    );
  });
  it("reads only what the person clearly stated, and leaves the rest to ask", () => {
    expect(readStated("date night saturday, something cozy")).toEqual({});
    expect(readStated("tacos then bowling with friends")).toEqual({
      food: "meal",
      cuisine: "mexican",
      fun: "yes",
      kind: "games",
    });
    expect(readStated("we've eaten, want to see a movie")).toEqual({
      food: "none",
      fun: "yes",
      kind: "shows",
    });
    expect(readStated("dinner somewhere nice for our anniversary")).toEqual({
      food: "meal",
    });
    expect(readStated("coffee and a walk in the park")).toEqual({
      food: "light",
      cuisine: "sweet",
      fun: "yes",
      kind: "outdoors",
    });
  });
  it("offers three different plans that all keep the person's picks", async () => {
    const r = {
      ...base(),
      startTime: "14:30",
      companions: "friends" as const,
      participants: 4,
      vibes: ["playful" as const],
    };
    const food = (await planner(r).options(r, groupByKey("mexican")!))
      .places[0];
    const fun = (await planner(r).options(r, groupByKey("games")!)).places[0];
    const request = { ...r, anchorPlaceIds: [food.id, fun.id], duration: 210 };
    const options = await planner(request).alternatives(request);
    // Each option does more than the last (or as much, over a longer time).
    const counts = options.map((o) => o.plan.stops.length);
    expect(options).toHaveLength(3);
    expect(counts[0]).toBe(2);
    expect(counts[1]).toBeGreaterThanOrEqual(3);
    expect(counts[2]).toBeGreaterThanOrEqual(counts[1]);
    for (const o of options)
      expect(o.plan.stops.map((s) => s.placeId)).toEqual(
        expect.arrayContaining([food.id, fun.id]),
      );
    // The added stops differ between options.
    const added = options.map((o) =>
      o.plan.stops
        .map((s) => s.placeId)
        .filter((id) => id !== food.id && id !== fun.id),
    );
    expect(added[1].some((id) => added[2].includes(id))).toBe(false);
  });
  it("without picks, the three plans differ and open differently, and feedback steers a new set", async () => {
    const r = { ...base(), companions: "friends" as const, participants: 4 };
    const first = await planner(r).alternatives(r);
    expect(first.length).toBe(3);
    const sets = first.map((o) =>
      o.plan.stops
        .map((s) => s.placeId)
        .sort()
        .join(),
    );
    expect(new Set(sets).size).toBe(3);
    expect(first.every((o) => o.plan.stops.length >= 2)).toBe(true);
    const all = first.flatMap((o) => o.plan.stops.map((s) => s.placeId));
    const next = await planner(r).alternatives(
      r,
      "none of these are fun, we want games and something lively",
      all,
    );
    expect(next.length).toBeGreaterThanOrEqual(2);
    // A new set after feedback is a different set of plans, not a repeat of any shown.
    const shown = new Set(sets);
    expect(
      next.some(
        (o) =>
          !shown.has(
            o.plan.stops
              .map((s) => s.placeId)
              .sort()
              .join(),
          ),
      ),
    ).toBe(true);
    expect(next[0].plan.request.vibes).toEqual(
      expect.arrayContaining(["playful"]),
    );
    expect(
      next.some((o) =>
        o.plan.stops.some((s) =>
          /game|bowling|amusement/.test(s.place.types.join(" ")),
        ),
      ),
    ).toBe(true);
  });
  it("changing a stop never silently drops it when nothing else fits", async () => {
    // Late Saturday on a tight budget: little is open and affordable for the last slot.
    const r = { ...base(), startTime: "21:00", budget: 40 };
    const plan = (await planner(r).alternatives(r))[0].plan;
    const result = await planner(r)
      .magicEdit(plan, "Keep the first stop, but change the last one")
      .then((x) => x.plan.stops.length)
      .catch((e) => (e as { code?: string }).code);
    expect([plan.stops.length, "NOTHING_TO_CHANGE"]).toContain(result);
  });
  it("adding a stop either adds one or says why it couldn't", async () => {
    const r = { ...base(), startTime: "21:30", budget: 40 };
    const plan = (await planner(r).alternatives(r))[0].plan;
    const result = await planner(r)
      .magicEdit(plan, "Add one more stop at the end")
      .then((x) => x.plan.stops.length)
      .catch((e) => (e as { code?: string }).code);
    expect([plan.stops.length + 1, "NOTHING_TO_CHANGE"]).toContain(result);
  });
  it("direct edits reorder, retime and remove stops, and reschedule the rest", async () => {
    const r = { ...base(), startTime: "14:00" };
    const plans = (await planner(r).alternatives(r))
      .map((o) => o.plan)
      .filter((p) => p.stops.length >= 2)
      .sort((a, b) => b.stops.length - a.stops.length);
    expect(plans.length).toBeGreaterThan(0);
    const refsOf = (p: (typeof plans)[number]) =>
      p.stops.map((s) => ({ placeId: s.placeId, minutes: s.minutes, locked: false, reason: s.reason }));
    // Swap the first two and give the new first stop 15 more minutes. A swap that would put a
    // later stop at a closed venue is refused (correctly), so use a plan where the swap fits.
    const swapOf = (refs: ReturnType<typeof refsOf>) => [{ ...refs[1], minutes: refs[1].minutes + 15 }, refs[0], ...refs.slice(2)];
    let plan = plans[0];
    let edited: Awaited<ReturnType<ReturnType<typeof planner>["edit"]>> | undefined;
    for (const candidate of plans) {
      try {
        edited = await planner(r).edit({ ...candidate, stops: swapOf(refsOf(candidate)) });
        plan = candidate;
        break;
      } catch (e) {
        if (!["CLOSED", "TOO_LONG"].includes((e as { code?: string }).code ?? "")) throw e;
      }
    }
    expect(edited).toBeDefined();
    if (!edited) return;
    const refs = refsOf(plan);
    const swapped = swapOf(refs);
    expect(edited.stops.map((s) => s.placeId)).toEqual(
      swapped.map((s) => s.placeId),
    );
    expect(edited.stops[0].minutes).toBe(refs[1].minutes + 15);
    expect(edited.stops[0].arrival.slice(11, 16)).toBe("14:00");
    expect(Date.parse(edited.stops[1].arrival)).toBeGreaterThanOrEqual(
      Date.parse(edited.stops[0].departure),
    );
    expect(edited.revision).toBe(plan.revision + 1);
    const removed = await planner(r).edit({ ...plan, stops: refs.slice(1) });
    expect(removed.stops.map((s) => s.placeId)).toEqual(
      refs.slice(1).map((s) => s.placeId),
    );
    expect(removed.totalMinutes).toBeLessThan(plan.totalMinutes);
  });
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
