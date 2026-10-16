import { describe, it, expect, vi, afterEach } from "vitest";
import { GooglePlaces, GoogleRoutes, normalize } from "@/lib/providers/google";
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
    expect(p).toHaveLength(3);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const init = fetcher.mock.calls[0][1];
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("*");
    expect(init.headers["X-Goog-FieldMask"]).not.toContain("photos");
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
                polyline: { encodedPolyline: "??AA" },
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
      polyline: "??AA",
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
