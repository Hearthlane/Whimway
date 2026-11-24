import { describe, it, expect, vi, afterEach } from "vitest";
import {
  providerCache,
  GooglePlaces,
  GoogleRoutes,
  normalize,
} from "@/lib/providers/google";
import { OpenAIRecommender } from "@/lib/providers/ai";
import { request } from "./helpers";
import { counter, requestOrigin } from "@/lib/server/security";
import { demoAllowed } from "@/lib/server/providers";
const raw = {
  id: "ChIJ-test",
  displayName: { text: "Retrieved café" },
  location: { latitude: 43.65, longitude: -79.38 },
  primaryType: "cafe",
  types: ["cafe"],
  formattedAddress: "Toronto",
  businessStatus: "OPERATIONAL",
  priceLevel: "PRICE_LEVEL_INEXPENSIVE",
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe("Provider integrations", () => {
  it("keeps auth redirects on the browser host behind a development proxy", () => {
    const req = new Request("http://localhost:3000/api/auth/signin", {
      headers: { Host: "127.0.0.1:3000", Origin: "http://127.0.0.1:3000" },
    });
    expect(requestOrigin(req)).toBe("http://127.0.0.1:3000");
    vi.stubEnv("APP_ORIGIN", "https://whimway.example");
    expect(requestOrigin(req)).toBe("https://whimway.example");
  });

  it("does not convert qualitative price levels to monetary prices", () =>
    expect(normalize(raw, "CAD").price).toMatchObject({
      high: null,
      source: "unknown",
    }));
  it("keeps photo author attribution and removes unsafe links", () => {
    const p = normalize(
      {
        ...raw,
        photos: [
          {
            name: "places/id/photos/ref",
            authorAttributions: [
              { displayName: "Photographer", uri: "javascript:alert(1)" },
            ],
          },
        ],
      },
      "CAD",
    );
    expect(p.photos[0].authors[0]).toEqual({
      name: "Photographer",
      uri: undefined,
    });
  });
  it("reads published Money ranges without converting currencies", () => {
    const p = {
      ...raw,
      priceRange: {
        startPrice: { currencyCode: "CAD", units: "20", nanos: 500000000 },
        endPrice: { currencyCode: "CAD", units: "35" },
      },
    };
    expect(normalize(p, "CAD").price).toMatchObject({ low: 20.5, high: 35 });
    expect(normalize(p, "JPY").price.high).toBeNull();
  });
  it("searches multiple interests with bounded field masks", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response(JSON.stringify({ places: [raw] }))),
      );
    vi.stubGlobal("fetch", fetcher);
    const r = request();
    r.interests = ["Food & drinks", "Shopping", "Outdoors"];
    const p = await new GooglePlaces().search(r);
    // Every search returns the same place here, and a place appears once.
    expect(p).toHaveLength(1);
    // Two interests, the moods and a time-of-day search (at most four text searches), plus nearby.
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(fetcher.mock.calls.length).toBeLessThanOrEqual(5);
    const bodies = fetcher.mock.calls.map((c) => JSON.parse(String(c[1].body ?? "{}")) as { textQuery?: string });
    expect(bodies.filter((b) => b.textQuery).length).toBeLessThanOrEqual(4);
    const init = fetcher.mock.calls[0][1];
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("*");
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("photos");
  });
  it("asks Google once for repeated identical searches, and never caches failures", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    providerCache.clear();
    let fail = true;
    const fetcher = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(
          fail
            ? new Response(JSON.stringify({ error: { message: "quota" } }), {
                status: 429,
              })
            : new Response(JSON.stringify({ places: [raw] })),
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const r = request();
    r.interests = ["Food & drinks"];
    await new GooglePlaces().search(r).catch(() => undefined);
    const afterFailure = fetcher.mock.calls.length;
    fail = false;
    await new GooglePlaces().search(r);
    expect(fetcher.mock.calls.length).toBeGreaterThan(afterFailure); // retried, not cached
    const afterSuccess = fetcher.mock.calls.length;
    await Promise.all([
      new GooglePlaces().search(r),
      new GooglePlaces().search(r),
    ]);
    expect(fetcher.mock.calls.length).toBe(afterSuccess); // served from cache
    providerCache.clear();
  });
  it("normalizes real route duration and geometry", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                duration: "151s",
                distanceMeters: 410,
                polyline: { encodedPolyline: "abc" },
              },
            ],
          }),
        ),
      ),
    );
    const p = await new GoogleRoutes().leg(
      { lat: 1, lng: 1 },
      { lat: 1.1, lng: 1.1 },
      "WALK",
      "a",
      "b",
    );
    expect(p).toMatchObject({
      minutes: 3,
      meters: 410,
      verified: true,
      polyline: "abc",
    });
  });
  it("fails clearly when route data is missing or quota limited", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [] }))),
    );
    await expect(
      new GoogleRoutes().leg(
        { lat: 1, lng: 1 },
        { lat: 2, lng: 2 },
        "WALK",
        "a",
        "b",
      ),
    ).rejects.toThrow("No usable route");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 429 })),
    );
    await expect(new GooglePlaces().details("test", "CAD")).rejects.toThrow(
      "usage limit",
    );
  });
  it("requires explicit model and AI credentials", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(
      new OpenAIRecommender().select(request(), [], []),
    ).rejects.toThrow("not configured");
  });
  it("fails closed without distributed limits in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    await expect(counter("test", 60)).rejects.toThrow(
      "production usage protection",
    );
  });
  it("blocks test fixtures in production even if configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
    expect(demoAllowed()).toBe(false);
  });
});
