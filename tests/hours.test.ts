import { describe, it, expect, vi, afterEach } from "vitest";
import { DateTime } from "luxon";
import { hoursCheck } from "@/lib/hours";
import { normalize } from "@/lib/providers/google";
import {
  fixturePlaces,
  FixtureRoutes,
  FixtureAI,
} from "@/lib/providers/fixtures";
import { Planner, schedule } from "@/lib/planner";
import { request, spec } from "./helpers";
const toronto = {
  id: "dated-place",
  displayName: { text: "Provider venue" },
  location: { latitude: 43.65, longitude: -79.38 },
  primaryType: "museum",
  types: ["museum"],
};
afterEach(() => vi.useRealTimers());
function dateClock() {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2030-06-01T16:00:00Z"));
}
describe("Published and typical opening windows", () => {
  it("preserves provider dates for overnight periods and checks the following local day", () => {
    dateClock();
    const p = normalize(
      {
        ...toronto,
        currentOpeningHours: {
          periods: [
            {
              open: {
                day: 6,
                hour: 20,
                date: { year: 2030, month: 6, day: 1 },
              },
              close: {
                day: 0,
                hour: 2,
                date: { year: 2030, month: 6, day: 2 },
              },
            },
          ],
        },
      },
      "CAD",
    );
    expect(p.periods[0].close?.date).toBe("2030-06-02");
    const arrival = DateTime.fromISO("2030-06-02T00:30", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 45 }))).toMatchObject(
      { closed: false, confidence: "applicable" },
    );
  });
  it("treats a date without any opening period as closed inside the supplied seven-day window", () => {
    dateClock();
    const p = normalize(
      {
        ...toronto,
        currentOpeningHours: {
          periods: [
            {
              open: { day: 6, hour: 9, date: { year: 2030, month: 6, day: 1 } },
              close: {
                day: 6,
                hour: 17,
                date: { year: 2030, month: 6, day: 1 },
              },
            },
          ],
        },
      },
      "CAD",
    );
    const arrival = DateTime.fromISO("2030-06-03T12:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 45 }))).toMatchObject(
      { closed: true, confidence: "applicable" },
    );
  });
  it("respects an explicit closed-for-the-week response", () => {
    dateClock();
    const p = normalize(
      { ...toronto, currentOpeningHours: { periods: [] } },
      "CAD",
    );
    const arrival = DateTime.fromISO("2030-06-02T12:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 30 })).closed).toBe(
      true,
    );
  });
  it("uses typical published periods beyond the current-hours window without calling them confirmed", () => {
    dateClock();
    const p = normalize(
      {
        ...toronto,
        currentOpeningHours: { periods: [] },
        regularOpeningHours: {
          periods: [{ open: { day: 1, hour: 9 }, close: { day: 1, hour: 17 } }],
        },
      },
      "CAD",
    );
    const arrival = DateTime.fromISO("2030-06-10T12:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 45 }))).toMatchObject(
      { closed: false, confidence: "typical" },
    );
    const closed = arrival.plus({ days: 1 });
    expect(hoursCheck(p, closed, closed.plus({ minutes: 45 })).closed).toBe(
      true,
    );
  });
  it("does not roll a date-specific holiday window into another week", () => {
    dateClock();
    const p = normalize(
      {
        ...toronto,
        currentOpeningHours: {
          periods: [
            {
              open: { day: 6, hour: 9, date: { year: 2030, month: 6, day: 1 } },
              close: {
                day: 6,
                hour: 12,
                date: { year: 2030, month: 6, day: 1 },
              },
            },
          ],
        },
      },
      "CAD",
    );
    const arrival = DateTime.fromISO("2030-06-08T10:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 30 }))).toMatchObject(
      { confidence: "unknown" },
    );
  });
  it("checks venue-local hours for a stop across a timezone boundary", () => {
    const p = fixturePlaces(request())[0];
    p.timezone = "Asia/Tokyo";
    p.periods = [
      {
        open: { day: 6, hour: 9, minute: 0 },
        close: { day: 6, hour: 10, minute: 0 },
      },
    ];
    const arrival = DateTime.fromISO("2030-06-01T00:30Z");
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 20 }))).toMatchObject(
      { closed: false, confidence: "typical" },
    );
  });
  it("interprets business clock hours correctly on a spring daylight-saving Sunday", () => {
    const p = fixturePlaces(request())[0];
    p.timezone = "America/Toronto";
    p.periods = [
      {
        open: { day: 0, hour: 6, minute: 0 },
        close: { day: 0, hour: 7, minute: 0 },
      },
    ];
    const arrival = DateTime.fromISO("2027-03-14T06:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 30 })).closed).toBe(
      false,
    );
  });
  it("keeps incomplete closing data uncertain instead of inventing availability", () => {
    const p = fixturePlaces(request())[0];
    p.periods = [{ open: { day: 1, hour: 8, minute: 0 } }];
    const arrival = DateTime.fromISO("2030-06-03T12:00", {
      zone: "America/Toronto",
    });
    expect(hoursCheck(p, arrival, arrival.plus({ minutes: 30 }))).toMatchObject(
      { confidence: "unknown", closed: false },
    );
  });
});
describe("Priced alternatives", () => {
  it("hydrates candidate prices before applying a hard replacement ceiling", async () => {
    const r = request();
    r.hardBudget = true;
    const detailed = fixturePlaces(r);
    const basic = detailed.map((p) => ({
      ...p,
      price: {
        ...p.price,
        low: null,
        high: null,
        source: "unknown" as const,
        confidence: "unknown" as const,
      },
    }));
    const provider = {
      search: vi.fn().mockResolvedValue(basic),
      details: vi.fn(async (id: string) => detailed.find((p) => p.id === id)!),
      location: vi.fn(),
    };
    const p = await new Planner(
      provider,
      new FixtureRoutes(),
      new FixtureAI(),
    ).explore(r);
    expect(p).toHaveLength(6);
    expect(provider.details).toHaveBeenCalledTimes(6);
    expect(p.find((p) => p.id === detailed[2].id)?.price.high).toBe(25);
  });
  it("rejects a full visit extending after a dated closing time", async () => {
    const s = spec();
    s.stops = s.stops.slice(0, 1);
    const p = fixturePlaces(s.request);
    p[0].hoursSource = "applicable";
    p[0].hoursWindow = { from: s.request.date, to: s.request.date };
    p[0].periods = [
      {
        open: { day: 0, hour: 0, minute: 0, date: s.request.date },
        close: { day: 0, hour: 12, minute: 20, date: s.request.date },
      },
    ];
    await expect(schedule(s, p, new FixtureRoutes())).rejects.toThrow(
      "opening hours",
    );
  });
});

describe("Unavailable saved stops", () => {
  it("reopens an honest partial itinerary when an unlocked saved ID is explicitly unavailable", async () => {
    const { AppError } = await import("@/lib/errors");
    const s = spec();
    const p = fixturePlaces(s.request);
    const provider = {
      search: vi.fn(),
      location: vi.fn(),
      details: vi.fn(async (id: string) => {
        if (id === s.stops[1].placeId)
          throw new AppError("PLACE_UNAVAILABLE", "Fixture place removed", 422);
        return p.find((p) => p.id === id)!;
      }),
    };
    const reopened = await new Planner(
      provider,
      new FixtureRoutes(),
      new FixtureAI(),
    ).hydrate(s);
    expect(reopened.stops).toHaveLength(2);
    expect(reopened.issues.map((i) => i.code)).toContain("PARTIAL");
  });
  it("keeps a provider-wide failure distinct from an unavailable place", async () => {
    const { AppError } = await import("@/lib/errors");
    const s = spec();
    const provider = {
      search: vi.fn(),
      location: vi.fn(),
      details: vi
        .fn()
        .mockRejectedValue(
          new AppError("PROVIDER_TIMEOUT", "Provider outage", 502),
        ),
    };
    await expect(
      new Planner(provider, new FixtureRoutes(), new FixtureAI()).hydrate(s),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
  it("does not silently discard a locked unavailable venue", async () => {
    const { AppError } = await import("@/lib/errors");
    const s = spec();
    s.stops[0].locked = true;
    const p = fixturePlaces(s.request);
    const provider = {
      search: vi.fn(),
      location: vi.fn(),
      details: vi.fn(async (id: string) => {
        if (id === s.stops[0].placeId)
          throw new AppError("PLACE_UNAVAILABLE", "Fixture place removed", 422);
        return p.find((p) => p.id === id)!;
      }),
    };
    await expect(
      new Planner(provider, new FixtureRoutes(), new FixtureAI()).hydrate(s),
    ).rejects.toMatchObject({ code: "PLACE_UNAVAILABLE" });
  });
});

describe("Remix retrieval and large locked plans", () => {
  it("retrieves food candidates for a More food remix even if the original plan only requested outdoors", async () => {
    const s = spec();
    s.request.interests = ["Outdoors"];
    const p = fixturePlaces(s.request);
    const search = vi.fn().mockResolvedValue(p);
    const provider = {
      search,
      location: vi.fn(),
      details: vi.fn(async (id: string) => p.find((p) => p.id === id)!),
    };
    await new Planner(
      provider,
      new FixtureRoutes(),
      new FixtureAI(),
      true,
    ).generate(s.request, s, "More food");
    expect(search.mock.calls[0][0].interests[0]).toBe("Food & drinks");
    expect(s.request.interests).toEqual(["Outdoors"]);
  });
  it("can preserve seven locked stops when remixing an eight-stop manual outing", async () => {
    const s = spec();
    s.request.duration = 720;
    const base = fixturePlaces(s.request)[0];
    const places = Array.from({ length: 8 }, (_, i) => ({
      ...base,
      id: `eight-${i}`,
      point: { lat: base.point.lat + i * 0.001, lng: base.point.lng },
      category: i % 2 ? "park" : "shopping mall",
      price: { ...base.price, low: 0, high: 0 },
    }));
    s.stops = places.map((p, i) => ({
      placeId: p.id,
      minutes: 15,
      reason: "Preserve this stop.",
      locked: i < 7,
    }));
    const provider = {
      search: vi.fn().mockResolvedValue(places),
      location: vi.fn(),
      details: vi.fn(async (id: string) => places.find((p) => p.id === id)!),
    };
    const ai = {
      select: vi.fn().mockResolvedValue({
        title: "Eight stops",
        summary: "Fixture",
        stops: s.stops,
      }),
    };
    const result = await new Planner(
      provider,
      new FixtureRoutes(),
      ai,
      true,
    ).generate(s.request, s, "More relaxing");
    expect(result.stops).toHaveLength(8);
    expect(result.stops.filter((s) => s.locked)).toHaveLength(7);
    expect(ai.select.mock.calls[0][4]).toEqual(s.stops);
  });
});

describe("International display and ambiguous local times", () => {
  it("preserves three-decimal currencies rather than rounding them to two digits", async () => {
    const { money } = await import("@/lib/time");
    expect(money(1.234, "KWD")).toMatch(/1\.234/);
  });
  it("rejects repeated daylight-saving times so saved plans cannot shift by an hour on reopening", async () => {
    const { localStart } = await import("@/lib/time");
    expect(() => localStart("2026-11-01", "01:30", "America/Toronto")).toThrow(
      "happens twice",
    );
  });
});
