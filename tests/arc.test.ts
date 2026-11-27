import { describe, expect, it } from "vitest";
import { arrange, fitMinutes, mealsFor, stopsFor } from "@/lib/arc";
import { candidatesFor } from "@/lib/planner";
import type { CandidatePlace } from "@/lib/schema";

const place = (id: string, types: string[], category = types[0]): CandidatePlace =>
  ({
    id,
    name: id,
    category,
    types,
    point: { lat: 43.65, lng: -79.38 },
    price: { low: 10, high: 20, currency: "CAD" },
    hours: [],
    rating: 4.5,
    reviews: 100,
  }) as unknown as CandidatePlace;
const ref = (placeId: string, minutes = 60, locked = false) => ({ placeId, minutes, reason: "x", locked });
const places = new Map(
  [
    place("museum", ["museum"]),
    place("lunch", ["restaurant"]),
    place("dinner", ["italian_restaurant"]),
    place("park", ["park"]),
    place("gelato", ["ice_cream_shop"]),
    place("bowling", ["bowling_alley"]),
    place("pub", ["pub", "bar"]),
  ].map((p) => [p.id, p]),
);
const order = (ids: string[], startTime: string, prompt = "", date = "2026-11-28") =>
  arrange(ids.map((id) => ref(id, id === "lunch" || id === "dinner" ? 75 : 60)), places, { startTime, date, prompt }).map((r) => r.placeId);

describe("the shape of a good outing", () => {
  it("Robert at noon: lunch first, then the museum", () => {
    expect(order(["museum", "lunch"], "12:00")).toEqual(["lunch", "museum"]);
  });
  it("Priya at 10am: something to do, then lunch around noon, treat last", () => {
    expect(order(["lunch", "gelato", "museum"], "10:00")).toEqual(["museum", "lunch", "gelato"]);
  });
  it("Tom's brunch comes first when he asked for brunch", () => {
    expect(order(["museum", "lunch"], "10:00", "brunch then an adventure")).toEqual(["lunch", "museum"]);
  });
  it("a long day gets lunch at lunchtime and dinner at dinnertime", () => {
    const o = order(["museum", "lunch", "dinner", "bowling", "park"], "10:00");
    expect(o.indexOf("lunch")).toBeLessThan(o.indexOf("dinner"));
    expect(o.indexOf("dinner")).toBeGreaterThan(o.indexOf("bowling"));
  });
  it("parks happen in daylight, not after dark in November", () => {
    const o = order(["park", "bowling", "dinner"], "15:00");
    expect(o[0]).toBe("park");
  });
  it("drinks and treats come last", () => {
    expect(order(["pub", "dinner", "bowling"], "18:30").at(-1)).toBe("pub");
  });
  it("lengths scale with the time asked for, and only ever grow", () => {
    expect(stopsFor({ duration: 240, pace: "balanced" })).toBe(3);
    expect(stopsFor({ duration: 600, pace: "balanced" })).toBe(6);
    expect(stopsFor({ duration: 120, pace: "relaxed" })).toBe(2);
    const fitted = fitMinutes([ref("museum", 60), ref("lunch", 60, true)], places, { duration: 360 });
    expect(fitted[0].minutes).toBeGreaterThan(60);
    expect(fitted[1].minutes).toBe(60);
    const full = fitMinutes([ref("museum", 200), ref("lunch", 75)], places, { duration: 180 });
    expect(full[0].minutes).toBe(200);
  });
  it("meals: one for an evening, lunch and dinner for a 10am–8pm day, none when they've eaten", () => {
    expect(mealsFor({ startTime: "18:30", duration: 240, skipFood: false })).toBe(1);
    expect(mealsFor({ startTime: "10:00", duration: 600, skipFood: false })).toBe(2);
    expect(mealsFor({ startTime: "18:30", duration: 240, skipFood: true })).toBe(0);
  });
});

describe("places that are never a good stop", () => {
  const base = {
    excludedPlaceIds: [],
    anchorPlaceIds: [],
    area: { center: { lat: 43.65, lng: -79.38 }, radius: 5000, locked: true },
    hardBudget: false,
    budget: 50,
    accessibility: "",
    indoorOnly: false,
    alcoholFree: false,
    skipFood: false,
    companions: "partner",
  } as never;
  const list = [
    place("pub", ["pub", "bar"]),
    place("hotel", ["lodging", "hotel"]),
    place("tickets", ["travel_agency"]),
    place("garage", ["parking"]),
    place("bowling", ["bowling_alley"]),
  ];
  it("hotels, car parks and ticket agents are never stops", () => {
    expect(candidatesFor(base, list).map((p) => p.id)).toEqual(["pub", "bowling"]);
  });
  it("families and anyone not drinking never get bars", () => {
    expect(candidatesFor({ ...(base as object), companions: "family" } as never, list).map((p) => p.id)).toEqual(["bowling"]);
    expect(candidatesFor({ ...(base as object), alcoholFree: true } as never, list).map((p) => p.id)).toEqual(["bowling"]);
  });
});
