import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GooglePlaces, GoogleRoutes } from "@/lib/providers/google";
import { Planner } from "@/lib/planner";
import {
  providerSignal,
  withProviderContext,
} from "@/lib/server/provider-context";
import { planner } from "@/lib/server/providers";
import type { Point } from "@/lib/schema";
import { request, spec } from "./helpers";

const raw = (id = "place-a", offset = 0) => ({
  id,
  displayName: { text: `Provider ${id}` },
  location: { latitude: 43.6544 + offset, longitude: -79.3807 },
  formattedAddress: "Provider address, Toronto",
  addressComponents: [{ shortText: "CA", types: ["country"] }],
  primaryType: "park",
  types: ["park"],
  businessStatus: "OPERATIONAL",
  rating: 4.5,
  userRatingCount: 100,
  priceRange: {
    startPrice: { currencyCode: "CAD", units: "0" },
    endPrice: { currencyCode: "CAD", units: "0" },
  },
  currentOpeningHours: { periods: [{ open: { day: 0, hour: 0, minute: 0 } }] },
});
const routeData = (polyline = "??AA", duration = "300s", meters = 500) => ({
  routes: [
    {
      duration,
      distanceMeters: meters,
      polyline: { encodedPolyline: polyline },
    },
  ],
});
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status });
const from: Point = { lat: 43.65, lng: -79.38 },
  to: Point = { lat: 43.66, lng: -79.37 };
beforeEach(() => {
  vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "synthetic-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Operation-local Google Places HTTP reuse", () => {
  it("coalesces concurrent and repeated details calls without sharing mutable results", async () => {
    let finish!: (value: Response) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const places = new GooglePlaces();
    const first = places.details("place-a", "CAD"),
      second = places.details("place-a", "CAD");
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    finish(response(raw()));
    const [a, b] = await Promise.all([first, second]);
    a.name = "A consumer changed its copy";
    a.price.high = 999;
    expect(b.name).toBe("Provider place-a");
    expect((await places.details("place-a", "CAD")).price.high).toBe(0);
    expect(fetcher).toHaveBeenCalledTimes(1);
    const mask = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
      .headers as Record<string, string>;
    for (const required of [
      "priceRange",
      "currentOpeningHours",
      "regularOpeningHours",
      "accessibilityOptions",
      "photos",
    ])
      expect(mask["X-Goog-FieldMask"]).toContain(required);
  });
  it("isolates IDs and currencies, and refreshes on a fresh provider instance", async () => {
    const fetcher = vi.fn(async (url: string) =>
      response(raw(url.split("/").at(-1))),
    );
    vi.stubGlobal("fetch", fetcher);
    const places = new GooglePlaces();
    const cad = await places.details("place-a", "CAD"),
      usd = await places.details("place-a", "USD");
    expect(cad.price.high).toBe(0);
    expect(usd.price).toMatchObject({
      high: null,
      currency: "USD",
      confidence: "unknown",
    });
    await places.details("place-b", "CAD");
    await new GooglePlaces().details("place-a", "CAD");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("evicts failed HTTP and invalid provider responses so retries really reach the provider", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response(raw()))
      .mockResolvedValueOnce(response({ id: "place-b" }))
      .mockResolvedValueOnce(response(raw("place-b")));
    vi.stubGlobal("fetch", fetcher);
    const places = new GooglePlaces();
    await expect(places.details("place-a", "CAD")).rejects.toMatchObject({
      code: "PLACE_UNAVAILABLE",
    });
    expect((await places.details("place-a", "CAD")).id).toBe("place-a");
    await expect(places.details("place-b", "CAD")).rejects.toThrow();
    expect((await places.details("place-b", "CAD")).id).toBe("place-b");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("bounds stored operation entries instead of creating a persistent unbounded cache", async () => {
    const fetcher = vi.fn(async (url: string) =>
      response(raw(url.split("/").at(-1))),
    );
    vi.stubGlobal("fetch", fetcher);
    const places = new GooglePlaces();
    for (let index = 0; index < 65; index++)
      await places.details(`place-${index}`, "CAD");
    await places.details("place-0", "CAD");
    expect(fetcher).toHaveBeenCalledTimes(65);
    await places.details("place-64", "CAD");
    expect(fetcher).toHaveBeenCalledTimes(66);
  });
  it("uses a location-only mask while preserving address fallback, session, country, timezone and coordinates", async () => {
    const area = raw();
    const addressOnly = { ...area, displayName: undefined };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(area))
      .mockResolvedValueOnce(response(addressOnly));
    vi.stubGlobal("fetch", fetcher);
    const places = new GooglePlaces();
    expect(await places.location("place-a", "search-session")).toEqual({
      placeId: "place-a",
      name: area.displayName.text,
      center: { lat: area.location.latitude, lng: area.location.longitude },
      timezone: "America/Toronto",
      currency: "CAD",
    });
    expect((await places.location("place-a")).name).toBe(area.formattedAddress);
    const [url, init] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("?sessionToken=search-session");
    expect(
      (init.headers as Record<string, string>)["X-Goog-FieldMask"].split(","),
    ).toEqual([
      "id",
      "displayName",
      "location",
      "formattedAddress",
      "addressComponents",
    ]);
    // Location lookups are not cached by this change.
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("retains search ratings and review counts needed by shortlist ranking", async () => {
    const fetcher = vi.fn(async () => response({ places: [raw()] }));
    vi.stubGlobal("fetch", fetcher);
    const found = await new GooglePlaces().search(request());
    expect(found[0]).toMatchObject({ rating: 4.5, reviews: 100 });
    for (const [, init] of fetcher.mock.calls as unknown as [
      string,
      RequestInit,
    ][]) {
      const mask = (init.headers as Record<string, string>)["X-Goog-FieldMask"];
      expect(mask).toContain("places.rating");
      expect(mask).toContain("places.userRatingCount");
    }
  });
});

describe("Exact operation-local Google Routes HTTP reuse", () => {
  it("coalesces identical coordinate/options requests and remaps each caller's itinerary IDs", async () => {
    const fetcher = vi.fn(async () => response(routeData()));
    vi.stubGlobal("fetch", fetcher);
    const routes = new GoogleRoutes();
    const [first, second] = await Promise.all([
      routes.leg(from, to, "DRIVE", "start", "first-stop"),
      routes.leg(
        { ...from },
        { ...to },
        "DRIVE",
        "alternate-origin",
        "alternate-stop",
      ),
    ]);
    expect(first).toMatchObject({
      from: "start",
      to: "first-stop",
      minutes: 5,
      meters: 500,
      verified: true,
    });
    expect(second).toMatchObject({
      from: "alternate-origin",
      to: "alternate-stop",
      minutes: 5,
      meters: 500,
      verified: true,
    });
    first.minutes = 99;
    expect(
      (await routes.leg(from, to, "DRIVE", "third", "fourth")).minutes,
    ).toBe(5);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1]
          .body as string,
      ),
    ).toMatchObject({
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      computeAlternativeRoutes: false,
      polylineQuality: "OVERVIEW",
    });
  });
  it("isolates exact endpoints, direction, travel mode/options and next-operation provider instances", async () => {
    const fetcher = vi.fn(async () => response(routeData()));
    vi.stubGlobal("fetch", fetcher);
    const routes = new GoogleRoutes();
    await routes.leg(from, to, "DRIVE", "a", "b");
    await routes.leg(from, to, "WALK", "a", "b");
    await routes.leg(to, from, "DRIVE", "a", "b");
    await routes.leg(
      from,
      { ...to, lat: to.lat + 0.000001 },
      "DRIVE",
      "a",
      "b",
    );
    await new GoogleRoutes().leg(from, to, "DRIVE", "a", "b");
    expect(fetcher).toHaveBeenCalledTimes(5);
    const walk = JSON.parse(
      (fetcher.mock.calls[1] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(walk.travelMode).toBe("WALK");
    expect(walk).not.toHaveProperty("routingPreference");
  });
  it("does not retain missing routes, malformed geometry, nonfinite durations or provider failures", async () => {
    for (const invalid of [
      response({}, 429),
      response({ routes: [] }),
      response(routeData("abc")),
      response(routeData("??")),
      response(routeData("??AA", `${"9".repeat(400)}s`)),
    ]) {
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(invalid)
        .mockResolvedValueOnce(response(routeData()));
      vi.stubGlobal("fetch", fetcher);
      const routes = new GoogleRoutes();
      await expect(routes.leg(from, to, "DRIVE", "a", "b")).rejects.toThrow();
      expect((await routes.leg(from, to, "DRIVE", "a", "b")).verified).toBe(
        true,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("preserves the genuine zero-distance route guard when serving another edge", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response(routeData("??", "0s", 0)));
    vi.stubGlobal("fetch", fetcher);
    const routes = new GoogleRoutes();
    await routes.leg(from, from, "WALK", "a", "b");
    expect(await routes.leg(from, from, "WALK", "c", "d")).toMatchObject({
      from: "c",
      to: "d",
      minutes: 0,
      meters: 0,
      polyline: "??",
      verified: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe("Request budgets and actual planner operations", () => {
  it("honours cancellation and deadlines even when successful place/route results are already available", async () => {
    for (const deadline of [false, true]) {
      const fetcher = vi.fn(async (url: string) =>
        response(url.includes("routes.googleapis.com") ? routeData() : raw()),
      );
      vi.stubGlobal("fetch", fetcher);
      const controller = new AbortController(),
        places = new GooglePlaces(),
        routes = new GoogleRoutes();
      await withProviderContext(
        controller.signal,
        async () => {
          await places.details("place-a", "CAD");
          await routes.leg(from, to, "DRIVE", "a", "b");
          if (deadline) {
            const signal = providerSignal()!;
            if (!signal.aborted)
              await new Promise<void>((resolve) =>
                signal.addEventListener("abort", () => resolve(), {
                  once: true,
                }),
              );
          } else controller.abort();
          const expected = deadline
            ? { code: "REQUEST_TIMEOUT", status: 504 }
            : { code: "REQUEST_CANCELLED", status: 499 };
          await expect(places.details("place-a", "CAD")).rejects.toMatchObject(
            expected,
          );
          await expect(
            routes.leg(from, to, "DRIVE", "c", "d"),
          ).rejects.toMatchObject(expected);
        },
        deadline ? 100 : 90000,
      );
      expect(fetcher).toHaveBeenCalledTimes(2);
    }
  });
  it("shares one in-flight HTTP request and propagates request cancellation to every waiting caller", async () => {
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener(
            "abort",
            () => reject(init.signal!.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController(),
      places = new GooglePlaces();
    const pending = withProviderContext(controller.signal, () =>
      Promise.allSettled([
        places.details("place-a", "CAD"),
        places.details("place-a", "CAD"),
      ]),
    );
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    controller.abort();
    for (const result of await pending)
      expect(result).toMatchObject({
        status: "rejected",
        reason: { code: "REQUEST_CANCELLED", status: 499 },
      });
  });
  it.each([false, true])(
    "counts actual locked-remix and schedule-repair HTTP calls with reuse=%s",
    async (reuse) => {
      const r = {
        ...request(),
        duration: 120,
        mode: "DRIVE" as const,
        start: request().area.center,
      };
      const a = raw("place-a", 0.001),
        b = raw("place-b", 0.002);
      const fetcher = vi.fn(async (url: string) => {
        if (url.includes("routes.googleapis.com")) return response(routeData());
        if (url.includes("places:search")) return response({ places: [a, b] });
        return response(url.endsWith("place-a") ? a : b);
      });
      vi.stubGlobal("fetch", fetcher);
      const original = {
        ...spec(),
        request: r,
        stops: [
          { placeId: a.id, minutes: 40, reason: "Locked visit", locked: true },
          {
            placeId: b.id,
            minutes: 40,
            reason: "Previous visit",
            locked: false,
          },
        ],
      };
      let attempts = 0;
      const selection = {
        select: vi.fn(async () => ({
          title: "Provider-backed test plan",
          summary: "",
          stops: [
            { placeId: a.id, minutes: 40, reason: "Locked visit" },
            {
              placeId: b.id,
              minutes: attempts++ === 0 ? 80 : 40,
              reason: "Adjusted visit",
            },
          ],
        })),
      };
      const places = new GooglePlaces(),
        routes = new GoogleRoutes();
      // Fresh providers per individual lookup reproduce the previous independent
      // HTTP calls, without replacing providerFetch or any real validation code.
      const result = await new Planner(
        reuse
          ? places
          : {
              search: places.search.bind(places),
              location: places.location.bind(places),
              details: (...args: Parameters<GooglePlaces["details"]>) =>
                new GooglePlaces().details(...args),
            },
        reuse
          ? routes
          : {
              leg: (...args: Parameters<GoogleRoutes["leg"]>) =>
                new GoogleRoutes().leg(...args),
            },
        selection,
      ).generate(r, original, "More relaxing");
      expect(selection.select).toHaveBeenCalledTimes(2);
      expect(result.stops[0]).toMatchObject({
        placeId: a.id,
        minutes: 40,
        locked: true,
        reason: "Locked visit",
      });
      expect(result.totalMinutes).toBe(90);
      const calls = fetcher.mock.calls.map(([url]) => url);
      expect(calls.filter((url) => /\/v1\/places\//.test(url))).toHaveLength(
        reuse ? 2 : 3,
      );
      expect(
        calls.filter((url) => url.includes("routes.googleapis.com")),
      ).toHaveLength(reuse ? 2 : 4);
      expect(calls).toHaveLength(reuse ? 6 : 9);
      // A second server planner()/provider pair represents another API operation.
      await planner(r).explore(r);
      expect(
        fetcher.mock.calls.filter(([url]) => /\/v1\/places\//.test(url)),
      ).toHaveLength(reuse ? 4 : 5);
    },
  );
});
