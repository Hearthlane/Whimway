import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DateTime } from "luxon";
import { schedule } from "../lib/planner";
import { fixturePlaces, FixtureRoutes } from "../lib/providers/fixtures";
import { spec } from "./helpers";
import {
  requestJson,
  validateApiBaseUrl,
} from "../apps/mobile/src/services/http";
import {
  parseSavedPlans,
  referenceOnlyPlan,
  reconcileDayProgress,
  favoritePlaceReference,
  PreferencesSchema,
  defaultPreferences,
  preferenceSyncDecision,
} from "../apps/mobile/src/services/storage-core";
import {
  advanceDayProgress,
  pendingDayStops,
  remainingDayMetrics,
} from "../apps/mobile/src/services/day-progress";
import { buildReminderPlan } from "../apps/mobile/src/services/reminder-plan";
import {
  areaRegion,
  decodePolyline,
  routeCoordinates,
} from "../apps/mobile/src/services/map-geometry";

async function plan() {
  const s = spec();
  return schedule(s, fixturePlaces(s.request), new FixtureRoutes());
}

describe("Native API contract and request privacy", () => {
  it("requires HTTPS in production and rejects credential-bearing URLs", () => {
    expect(() => validateApiBaseUrl(undefined)).toThrow("EXPO_PUBLIC_API_URL");
    expect(() => validateApiBaseUrl("http://localhost:3000")).toThrow("HTTPS");
    expect(validateApiBaseUrl("http://192.168.1.5:3000/", true)).toBe(
      "http://192.168.1.5:3000",
    );
    expect(() => validateApiBaseUrl("https://user:secret@example.com")).toThrow(
      "HTTPS",
    );
    expect(() => validateApiBaseUrl("https://example.com#token")).toThrow(
      "HTTPS",
    );
  });
  it("validates JSON and sends bearer auth without cookies", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(Response.json({ id: "ok", ignored: true }));
    const result = await requestJson(
      "https://example.com",
      "plans",
      z.object({ id: z.string() }),
      { draft: true },
      { token: "test-token", fetcher },
    );
    expect(result).toEqual({ id: "ok" });
    expect(fetcher).toHaveBeenCalledWith(
      "https://example.com/api/plans",
      expect.objectContaining({
        credentials: "omit",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
          "Content-Type": "application/json",
        }),
      }),
    );
  });
  it("rejects invalid provider data and handles invalid JSON", async () => {
    await expect(
      requestJson(
        "https://example.com",
        "generate",
        z.object({ verified: z.boolean() }),
        {},
        {
          fetcher: vi
            .fn()
            .mockResolvedValue(Response.json({ verified: "true" })),
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    await expect(
      requestJson(
        "https://example.com",
        "generate",
        z.object({}),
        {},
        { fetcher: vi.fn().mockResolvedValue(new Response("not-json")) },
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("preserves backend failure codes without treating failure as a plan", async () => {
    await expect(
      requestJson(
        "https://example.com",
        "generate",
        z.object({}),
        {},
        {
          fetcher: vi
            .fn()
            .mockResolvedValue(
              Response.json(
                { error: "No suitable venues.", code: "NO_PLACES" },
                { status: 422 },
              ),
            ),
        },
      ),
    ).rejects.toMatchObject({
      message: "No suitable venues.",
      code: "NO_PLACES",
      status: 422,
    });
  });
  it("never leaks the session token to arbitrary URLs", async () => {
    const fetcher = vi.fn();
    for (const path of [
      "https://attacker.com",
      "/plans",
      "plans/../profile",
      "\\attacker.com",
    ]) {
      await expect(
        requestJson("https://example.com", path, z.object({}), undefined, {
          fetcher,
          token: "private",
        }),
      ).rejects.toMatchObject({ code: "INVALID_API_PATH" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("cancels an in-flight request and distinguishes it from a timeout", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new Error("aborted")),
          ),
        ),
    );
    const pending = requestJson(
      "https://example.com",
      "generate",
      z.object({}),
      {},
      { fetcher, signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    await expect(
      requestJson(
        "https://example.com",
        "generate",
        z.object({}),
        {},
        { fetcher, timeoutMs: 1 },
      ),
    ).rejects.toMatchObject({ code: "TIMEOUT" });
  });
});

describe("Native saved references and live progress", () => {
  it("saves favorite provider IDs without names, photos, prices or private notes", async () => {
    const itinerary = await plan(),
      ref = favoritePlaceReference(itinerary, itinerary.stops[0].placeId);
    expect(Object.keys(ref).sort()).toEqual([
      "currency",
      "demo",
      "placeId",
      "sourceLocationId",
      "timezone",
    ]);
    expect(JSON.stringify(ref)).not.toContain(itinerary.stops[0].place.name);
    expect(() => favoritePlaceReference(itinerary, "not-in-plan")).toThrow(
      "Choose a stop",
    );
  });
  it("adopts account preferences only when the device has no custom or dirty choices", () => {
    const cloud = PreferencesSchema.parse({
      enabled: true,
      budget: 100,
      budgetCurrency: "CAD",
    });
    expect(preferenceSyncDecision(defaultPreferences, cloud)).toBe(
      "adopt-account",
    );
    expect(preferenceSyncDecision(defaultPreferences, cloud, true)).toBe(
      "choose-source",
    );
    expect(
      preferenceSyncDecision(
        { ...defaultPreferences, dietary: "Vegan" },
        cloud,
      ),
    ).toBe("choose-source");
    expect(preferenceSyncDecision(cloud, cloud)).toBe("unchanged");
    expect(() => PreferencesSchema.parse({ budgetCurrency: "usd" })).toThrow();
  });
  it("advances a live day once and replaces only the current verified travel estimate", async () => {
    const itinerary = await plan();
    let progress = {
      planId: itinerary.id,
      startedAt: new Date().toISOString(),
      completed: [] as string[],
      skipped: [] as string[],
    };
    progress = advanceDayProgress(
      itinerary,
      progress,
      itinerary.stops[0].placeId,
      "completed",
    );
    expect(
      advanceDayProgress(
        itinerary,
        progress,
        itinerary.stops[0].placeId,
        "skipped",
      ),
    ).toEqual(progress);
    progress = advanceDayProgress(
      itinerary,
      progress,
      itinerary.stops[1].placeId,
      "skipped",
    );
    expect(
      pendingDayStops(itinerary, progress).map((stop) => stop.placeId),
    ).toEqual([itinerary.stops[2].placeId]);
    const target = itinerary.stops[2];
    const route = {
      from: "current",
      to: target.placeId,
      minutes: 7,
      meters: 300,
      polyline: "",
      verified: true,
    };
    expect(remainingDayMetrics(itinerary, progress, route).minutes).toBe(
      target.minutes + 7,
    );
    expect(
      remainingDayMetrics(itinerary, progress, { ...route, to: "previous" })
        .minutes,
    ).toBe(Math.round(target.minutes + target.travel));
    expect(
      remainingDayMetrics(itinerary, progress, { ...route, verified: false })
        .minutes,
    ).toBe(Math.round(target.minutes + target.travel));
    expect(() =>
      advanceDayProgress(
        itinerary,
        { ...progress, planId: "another-plan" },
        target.placeId,
        "completed",
      ),
    ).toThrow("another outing");
  });
  it("persists choices and provider IDs, never place photos, prices or route geometry", async () => {
    const itinerary = await plan();
    itinerary.demo = false;
    const stored = referenceOnlyPlan(itinerary),
      serialized = JSON.stringify(stored);
    expect(stored.stops[0].placeId).toBe(itinerary.stops[0].placeId);
    expect(stored.request.location.center).toEqual({ lat: 0, lng: 0 });
    expect(stored.areaSource).toBe("place-reference");
    for (const forbidden of [
      "photos",
      "polyline",
      "businessStatus",
      "price",
      "hoursStatus",
      "arrival",
    ])
      expect(serialized).not.toContain(`"${forbidden}"`);
  });
  it("drops malformed entries and sanitizes hydrated entries on read", async () => {
    const itinerary = await plan();
    const parsed = parseSavedPlans(JSON.stringify([{}, itinerary]));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].stops[0]).not.toHaveProperty("place");
    expect(parseSavedPlans("broken")).toEqual([]);
    expect(parseSavedPlans(JSON.stringify({ malicious: itinerary }))).toEqual(
      [],
    );
  });
  it("reconciles removed stops and de-duplicates completed/skipped state", async () => {
    const itinerary = await plan(),
      first = itinerary.stops[0].placeId,
      second = itinerary.stops[1].placeId;
    expect(
      reconcileDayProgress(
        {
          planId: itinerary.id,
          startedAt: new Date().toISOString(),
          completed: [first, first, "removed"],
          skipped: [first, second, "removed"],
        },
        itinerary,
      ),
    ).toMatchObject({ completed: [first], skipped: [second] });
  });
});

describe("Native absolute reminder schedules", () => {
  it("does not remind about starting or completed/skipped stops once Day Mode begins", async () => {
    const itinerary = await plan();
    itinerary.request.date = "2030-08-01";
    itinerary.request.startTime = "10:00";
    itinerary.request.location.timezone = "Asia/Tokyo";
    itinerary.stops = itinerary.stops.map((stop, index) => ({
      ...stop,
      arrival: `2030-08-01T${11 + index}:00:00+09:00`,
    }));
    const reminders = buildReminderPlan(
      itinerary,
      { upcomingStops: true },
      DateTime.fromISO("2030-07-31T00:00:00Z").toMillis(),
      {
        completed: [itinerary.stops[0].placeId],
        skipped: [itinerary.stops[1].placeId],
      },
    );
    expect(reminders.map((item) => item.placeId)).toEqual([
      itinerary.stops[2].placeId,
    ]);
    expect(reminders[0].at).toBe(
      DateTime.fromISO("2030-08-01T03:55:00Z").toMillis(),
    );
  });
  it("uses the destination timezone instead of the device timezone", async () => {
    const itinerary = await plan();
    itinerary.request.date = "2030-08-01";
    itinerary.request.startTime = "10:00";
    itinerary.request.location.timezone = "Asia/Tokyo";
    const [reminder] = buildReminderPlan(
      itinerary,
      { beforeMinutes: 15 },
      DateTime.fromISO("2030-07-31T00:00:00Z").toMillis(),
    );
    expect(reminder.at).toBe(
      DateTime.fromISO("2030-08-01T00:45:00Z").toMillis(),
    );
  });
  it("filters past reminders and schedules upcoming stops by their explicit offsets", async () => {
    const itinerary = await plan();
    itinerary.request.date = "2030-08-01";
    itinerary.request.startTime = "10:00";
    itinerary.request.location.timezone = "Asia/Tokyo";
    itinerary.stops = [
      { ...itinerary.stops[0], arrival: "2030-08-01T11:00:00+09:00" },
    ];
    const reminders = buildReminderPlan(
      itinerary,
      { upcomingStops: true, stopBeforeMinutes: 5 },
      DateTime.fromISO("2030-08-01T01:00:00Z").toMillis(),
    );
    expect(reminders).toHaveLength(1);
    expect(reminders[0].at).toBe(
      DateTime.fromISO("2030-08-01T01:55:00Z").toMillis(),
    );
    expect(
      buildReminderPlan(
        itinerary,
        {},
        DateTime.fromISO("2031-01-01T00:00:00Z").toMillis(),
      ),
    ).toEqual([]);
  });
  it("rejects ambiguous local start times and naive stop timestamps", async () => {
    const itinerary = await plan();
    itinerary.request.date = "2030-11-03";
    itinerary.request.startTime = "01:30";
    itinerary.request.location.timezone = "America/Toronto";
    expect(() => buildReminderPlan(itinerary)).toThrow("twice");
    itinerary.request.startTime = "12:00";
    itinerary.stops[0].arrival = "2030-11-03T12:00:00";
    expect(() => buildReminderPlan(itinerary, { upcomingStops: true })).toThrow(
      "invalid reminder schedule",
    );
  });
});

describe("Native route geometry", () => {
  it("decodes actual Google geometry", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")).toEqual([
      { latitude: 38.5, longitude: -120.2 },
      { latitude: 40.7, longitude: -120.95 },
      { latitude: 43.252, longitude: -126.453 },
    ]);
  });
  it("draws no geometry for malformed or unverified routes", () => {
    expect(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`")).toEqual([]);
    expect(decodePolyline("\u0000\u0000")).toEqual([]);
    expect(
      routeCoordinates({
        from: "a",
        to: "b",
        minutes: 5,
        meters: 200,
        polyline: "_p~iF~ps|U_ulLnnqC_mqNvxq`@",
        verified: false,
      }),
    ).toEqual([]);
  });
  it("maintains usable bounded regions close to the poles", () => {
    const region = areaRegion({ lat: 85, lng: 179.9 }, 20000);
    expect(region.longitudeDelta).toBeLessThanOrEqual(180);
    expect(region.latitudeDelta).toBeGreaterThan(0);
    expect(region.longitude).toBe(179.9);
  });
});
