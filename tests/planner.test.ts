import { beforeEach, describe, it, expect, vi } from "vitest";
import { DateTime } from "luxon";
import { PlanSpec, Selection } from "@/lib/schema";
import { distance, inside, dedupe, decodePolyline, safeUrl } from "@/lib/geo";
import { localStart, money } from "@/lib/time";
import {
  costTotal,
  candidatesFor,
  hoursCheck,
  validateRequest,
  schedule,
  Planner,
  optimizeOrder,
} from "@/lib/planner";
import {
  fixturePlaces,
  FixturePlaces,
  FixtureRoutes,
  FixtureAI,
} from "@/lib/providers/fixtures";
import { publicSpec, persistSpec } from "@/lib/storage";
import { navigationUrl } from "@/lib/navigation";
import { request, spec } from "./helpers";
describe("External navigation handoff", () => {
  it("targets exact provider IDs in itinerary order rather than ambiguous venue names", async () => {
    const s = spec();
    const p = await schedule(s, fixturePlaces(s.request), new FixtureRoutes());
    const url = new URL(navigationUrl({ ...p, demo: false })!);
    expect(url.searchParams.get("origin_place_id")).toBe(s.stops[0].placeId);
    expect(url.searchParams.get("destination_place_id")).toBe(
      s.stops[2].placeId,
    );
    expect(url.searchParams.get("waypoint_place_ids")).toBe(s.stops[1].placeId);
    expect(url.searchParams.get("travelmode")).toBe("walking");
  });
  it("includes every stop between explicit personal route anchors", async () => {
    const s = spec();
    s.request.start = { lat: 43.653, lng: -79.38 };
    s.request.end = { lat: 43.655, lng: -79.38 };
    s.request.mode = "DRIVE";
    const p = await schedule(s, fixturePlaces(s.request), new FixtureRoutes());
    const url = new URL(navigationUrl({ ...p, demo: false })!);
    expect(url.searchParams.get("origin")).toBe("43.653,-79.38");
    expect(url.searchParams.get("destination")).toBe("43.655,-79.38");
    expect(url.searchParams.has("origin_place_id")).toBe(false);
    expect(url.searchParams.get("waypoint_place_ids")).toBe(
      s.stops.map((stop) => stop.placeId).join("|"),
    );
    expect(url.searchParams.get("travelmode")).toBe("driving");
  });
  it("does not offer directions for synthetic plans", async () => {
    const s = spec();
    const p = await schedule(s, fixturePlaces(s.request), new FixtureRoutes());
    expect(navigationUrl(p)).toBeUndefined();
  });
});
describe("Geography and normalization", () => {
  it("calculates Haversine distances and inclusive boundaries", () => {
    const a = { lat: 0, lng: 0 },
      b = { lat: 0, lng: 0.01 };
    expect(distance(a, b)).toBeCloseTo(1111.95, 1);
    expect(inside(b, a, distance(a, b))).toBe(true);
    expect(inside(b, a, distance(a, b) - 1)).toBe(false);
    expect(distance(a, a)).toBe(0);
  });
  it("works across the dateline", () =>
    expect(
      distance({ lat: 0, lng: 179.99 }, { lat: 0, lng: -179.99 }),
    ).toBeLessThan(2300));
  it("deduplicates provider IDs and removes closed places", () => {
    const p = fixturePlaces(request());
    expect(
      dedupe([p[0], p[0], { ...p[1], businessStatus: "CLOSED_PERMANENTLY" }]),
    ).toHaveLength(1);
  });
  it("strictly excludes out-of-area replacements", () => {
    const r = request();
    r.area.radius = 100;
    expect(candidatesFor(r, fixturePlaces(r))).toHaveLength(1);
  });
  it("rejects uncertain prices for hard ceilings", () => {
    const r = request();
    r.hardBudget = true;
    const p = fixturePlaces(r);
    p[0].price.high = null;
    expect(candidatesFor(r, p).some((x) => x.id === p[0].id)).toBe(false);
  });
  it("decodes provider polylines", () =>
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")[0]).toEqual({
      lat: 38.5,
      lng: -120.2,
    }));
  it("rejects unsafe URLs", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://example.com")).toBe("https://example.com/");
  });
});
describe("Local times, prices and hours", () => {
  it("uses Japan’s timezone instead of the server timezone", () =>
    expect(localStart("2030-06-01", "12:00", "Asia/Tokyo").toUTC().hour).toBe(
      3,
    ));
  it("applies daylight saving in Toronto", () => {
    expect(localStart("2030-01-01", "12:00", "America/Toronto").offset).toBe(
      -300,
    );
    expect(localStart("2030-07-01", "12:00", "America/Toronto").offset).toBe(
      -240,
    );
  });
  it("rejects nonexistent daylight-saving times", () =>
    expect(() => localStart("2027-03-14", "02:30", "America/Toronto")).toThrow(
      "does not exist",
    ));
  it("rejects past outings and mismatched area centres", () => {
    const r = request();
    r.date = "2020-01-01";
    expect(() => validateRequest(r)).toThrow("future start");
    const r2 = request();
    r2.area.center = { lat: 0, lng: 0 };
    expect(() => validateRequest(r2)).toThrow("centre");
  });
  it("keeps unknown costs separate from the known range", () => {
    const p = fixturePlaces(request());
    p[0].price.high = null;
    p[0].price.low = null;
    expect(costTotal([p[0], p[2]])).toMatchObject({
      low: 0,
      high: 25,
      unknown: 1,
    });
  });
  it("formats yen without invented dollar symbols", () =>
    expect(money(1500, "JPY")).toMatch(/1,500/));
  it("does not invent hours when missing", () => {
    const p = fixturePlaces(request())[0];
    p.periods = [];
    expect(hoursCheck(p, DateTime.now(), DateTime.now())).toEqual({
      closed: false,
      label: "Hours unavailable · check before going",
      confidence: "unknown",
    });
  });
  it("accepts overnight hours and rejects closed windows", () => {
    const p = fixturePlaces(request())[0];
    p.periods = [
      {
        open: { day: 5, hour: 20, minute: 0 },
        close: { day: 6, hour: 2, minute: 0 },
      },
    ];
    const a = DateTime.fromISO("2030-06-01T00:30", { zone: "Asia/Tokyo" });
    expect(hoursCheck(p, a, a.plus({ minutes: 45 })).closed).toBe(false);
    expect(
      hoursCheck(p, a.plus({ hours: 3 }), a.plus({ hours: 4 })).closed,
    ).toBe(true);
  });
  it("does not apply current hours to an unconfirmed future date", () => {
    const p = fixturePlaces(request())[0];
    p.hoursSource = "applicable";
    p.hoursDates = ["2020-01-01"];
    expect(hoursCheck(p, DateTime.now(), DateTime.now())).toMatchObject({
      closed: false,
      label: "Hours for this date are not confirmed",
    });
  });
});
describe("Planner and editor", () => {
  let routes: FixtureRoutes;
  beforeEach(() => {
    routes = new FixtureRoutes();
  });
  it("builds one diverse Toronto itinerary and routes each leg", async () => {
    const r = request();
    const p = await new Planner(
      new FixturePlaces(r),
      routes,
      new FixtureAI(),
      true,
    ).generate(r);
    expect(p.stops).toHaveLength(4);
    expect(new Set(p.stops.map((s) => s.place.category)).size).toBeGreaterThan(
      2,
    );
    expect(p.totalMinutes).toBeLessThanOrEqual(240);
    expect(p.legs).toHaveLength(3);
    expect(p.cost.high).toBeLessThanOrEqual(65);
  });
  it("schedules Shibuya in yen and local time", async () => {
    const r = request(1);
    const p = await new Planner(
      new FixturePlaces(r),
      routes,
      new FixtureAI(),
      true,
    ).generate(r);
    expect(p.cost.currency).toBe("JPY");
    expect(p.stops[0].arrival).toContain("+09:00");
    expect(
      p.stops.every((s) => inside(s.place.point, r.area.center, r.area.radius)),
    ).toBe(true);
  });
  it("returns an honest sparse-area failure", async () => {
    const r = request(2);
    await expect(
      new Planner(new FixturePlaces(r), routes, new FixtureAI(), true).generate(
        r,
      ),
    ).rejects.toThrow("No suitable destinations");
  });
  it("recomputes after removal, reorder and visit edits", async () => {
    const s = spec();
    const original = await schedule(s, fixturePlaces(s.request), routes);
    const edited = await schedule(
      { ...s, stops: [{ ...s.stops[2], minutes: 20 }, s.stops[0]] },
      fixturePlaces(s.request),
      routes,
    );
    expect(edited.totalMinutes).toBeLessThan(original.totalMinutes);
    expect(edited.stops[0].placeId).toBe(s.stops[2].placeId);
    expect(edited.legs).toHaveLength(1);
  });
  it("preserves locked venues and durations through remix", async () => {
    const s = spec();
    s.stops[0].locked = true;
    const p = await new Planner(
      new FixturePlaces(s.request),
      routes,
      new FixtureAI(),
      true,
    ).generate(s.request, s, "More relaxing");
    expect(p.stops.find((x) => x.placeId === s.stops[0].placeId)).toMatchObject(
      s.stops[0],
    );
  });
  it("rejects all-locked remixes", async () => {
    const s = spec();
    s.stops.forEach((x) => (x.locked = true));
    await expect(
      new Planner(
        new FixturePlaces(s.request),
        routes,
        new FixtureAI(),
        true,
      ).generate(s.request, s, "Surprise me"),
    ).rejects.toThrow("All stops are locked");
  });
  it("rejects AI-invented IDs and invalid outputs", async () => {
    const r = request();
    const ai = {
      select: vi.fn().mockResolvedValue({
        title: "Invalid",
        summary: "",
        stops: [{ placeId: "invented", minutes: 40, reason: "" }],
      }),
    };
    await expect(
      new Planner(new FixturePlaces(r), routes, ai).generate(r),
    ).rejects.toThrow("unknown place ID");
    expect(Selection.safeParse({ stops: [{ minutes: -10 }] }).success).toBe(
      false,
    );
  });
  it("does not silently change locked minutes supplied by AI", async () => {
    const s = spec();
    s.stops[0].locked = true;
    const ai = {
      select: vi.fn().mockResolvedValue({
        title: "Invalid",
        summary: "",
        stops: s.stops.map((x) => ({ ...x, minutes: 25 })),
      }),
    };
    await expect(
      new Planner(new FixturePlaces(s.request), routes, ai).generate(
        s.request,
        s,
      ),
    ).rejects.toThrow("locked stop");
  });
  it("rejects a too-long edit but allows a clearly labelled partial generation", async () => {
    const s = spec();
    s.request.duration = 60;
    await expect(schedule(s, fixturePlaces(s.request), routes)).rejects.toThrow(
      "time window",
    );
    const p = await schedule(s, fixturePlaces(s.request), routes, true);
    expect(p.stops).toHaveLength(1);
    expect(p.issues.some((i) => i.code === "PARTIAL")).toBe(true);
  });
  it("propagates routing failures without drawing fake directions", async () => {
    const s = spec();
    const broken = { leg: vi.fn().mockRejectedValue(new Error("No route")) };
    await expect(schedule(s, fixturePlaces(s.request), broken)).rejects.toThrow(
      "No route",
    );
  });
  it("counts optional start and end travel", async () => {
    const s = spec();
    s.request.start = s.request.area.center;
    s.request.end = s.request.area.center;
    const p = await schedule(s, fixturePlaces(s.request), routes);
    expect(p.legs).toHaveLength(4);
    expect(p.legs[0].from).toBe("start");
    expect(p.legs.at(-1)?.to).toBe("end");
  });
  it("keeps deliberately disliked places out of future plans", () => {
    const r = request();
    const p = fixturePlaces(r);
    r.excludedPlaceIds = [p[0].id];
    expect(candidatesFor(r, p).map((x) => x.id)).not.toContain(p[0].id);
  });
  it("optimizes backtracking without moving locked positions", () => {
    const s = spec();
    const p = fixturePlaces(s.request);
    const refs = [s.stops[0], s.stops[2], s.stops[1]];
    refs[0].locked = true;
    const optimized = optimizeOrder(refs, p, s.request);
    expect(optimized[0]).toEqual(refs[0]);
    expect(optimized.map((x) => x.placeId).sort()).toEqual(
      refs.map((x) => x.placeId).sort(),
    );
  });
  it("rejects inaccessible and unknown-cost replacement candidates", () => {
    const r = request();
    r.hardBudget = true;
    r.accessibility = "Step free";
    const p = fixturePlaces(r);
    p[0].wheelchairAccessible = false;
    p[1].price.high = null;
    expect(candidatesFor(r, p).map((p) => p.id)).not.toContain(p[0].id);
    expect(candidatesFor(r, p).map((p) => p.id)).not.toContain(p[1].id);
  });
  it("separates public copies from private requirements and anchors", () => {
    const s = spec();
    s.request.prompt = "Private birthday";
    s.request.dietary = "private";
    s.request.start = { lat: 1, lng: 2 };
    const p = publicSpec(s);
    expect(p.request.prompt).toBe("");
    expect(p.request.dietary).toBe("");
    expect(p.request.start).toBeUndefined();
    expect(p.request.area.center).not.toEqual(s.request.area.center);
    expect(s.request.prompt).toBe("Private birthday");
  });
  it("persists provider area IDs instead of long-lived provider names and coordinates", () => {
    const s = spec();
    s.demo = false;
    const saved = persistSpec(s);
    expect(saved.areaSource).toBe("place-reference");
    expect(saved.request.location).toMatchObject({
      name: "Selected area",
      center: { lat: 0, lng: 0 },
      placeId: s.request.location.placeId,
    });
    expect(saved.request.area.center).toEqual({ lat: 0, lng: 0 });
    expect(s.request.location.name).toBe("CF Toronto Eaton Centre");
  });
  it("rehydrates saved area references before validating the schedule", async () => {
    const s = spec();
    s.demo = false;
    const saved = persistSpec(s);
    const p = await new Planner(
      new FixturePlaces(s.request),
      new FixtureRoutes(),
      new FixtureAI(),
    ).hydrate(saved);
    expect(p.request.area.center).toEqual(s.request.area.center);
    expect(p.request.location.name).toBe(s.request.location.name);
    expect(p.stops).toHaveLength(3);
  });
  it("stores no private exploration centre in public copies", () => {
    const s = spec();
    const copy = publicSpec(s);
    expect(copy.areaSource).toBe("shared-stops");
    expect(copy.request.location.placeId).toBeUndefined();
    expect(copy.request.area.center).toEqual({ lat: 0, lng: 0 });
  });
  it("persistence schema strips restricted details and photography", async () => {
    const s = spec();
    const p = await schedule(s, fixturePlaces(s.request), routes);
    const persisted = PlanSpec.parse(p);
    expect(persisted.stops[0]).not.toHaveProperty("place");
    expect(persisted).not.toHaveProperty("legs");
  });
});
