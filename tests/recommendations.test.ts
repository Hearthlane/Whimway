import { afterEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import {
  preferenceScore,
  retrievalPreferences,
} from "@/lib/providers/preferences";
import { candidatesFor, Planner, schedule } from "@/lib/planner";
import {
  fixturePlaces,
  FixturePlaces,
  FixtureRoutes,
  FixtureAI,
} from "@/lib/providers/fixtures";
import {
  normalize,
  GoogleRoutes,
  GooglePlaces,
  resolvePoint,
} from "@/lib/providers/google";
import { currencyForCountry } from "@/lib/providers/currency-data";
import { OpenAIRecommender } from "@/lib/providers/ai";
import { AppError } from "@/lib/errors";
import { request, spec } from "./helpers";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("Real preference influence without inferred venue facts", () => {
  it("uses companion, energy and vibes to retrieve suitable categories when interests are unspecified", () => {
    const original = {
      ...request(),
      companion: "family" as const,
      energy: "chill" as const,
      vibes: ["hidden-gems" as const],
    };
    const retrieval = retrievalPreferences(original);
    expect(retrieval.interests).toEqual([
      "Family",
      "Relaxation",
      "Hidden gems",
    ]);
    expect(retrieval.area).toEqual(original.area);
    expect(retrieval.date).toBe(original.date);
    expect(original.interests).toEqual(["Surprise me"]);
  });
  it("retains explicit interests and prioritizes a requested remix", () => {
    const retrieval = retrievalPreferences(
      {
        ...request(),
        interests: ["Shopping"],
        companion: "family",
        energy: "chill",
      },
      "More food",
    );
    expect(retrieval.interests).toEqual([
      "Food & drinks",
      "Shopping",
      "Family",
      "Relaxation",
    ]);
  });
  it("ranks provider categories for companion and energy while preserving venue facts", () => {
    const base = fixturePlaces(request())[0];
    const park = { ...base, types: ["park"] };
    const bowling = { ...base, types: ["bowling_alley"] };
    const library = { ...base, types: ["public_library"] };
    expect(
      preferenceScore({ ...request(), companion: "family" }, park),
    ).toBeGreaterThan(
      preferenceScore({ ...request(), companion: "family" }, bowling),
    );
    expect(
      preferenceScore({ ...request(), companion: "date" }, bowling),
    ).toBeGreaterThan(
      preferenceScore({ ...request(), companion: "solo" }, bowling),
    );
    expect(
      preferenceScore({ ...request(), energy: "chill" }, library),
    ).toBeGreaterThan(
      preferenceScore({ ...request(), energy: "chill" }, bowling),
    );
    expect(
      preferenceScore({ ...request(), energy: "active" }, bowling),
    ).toBeGreaterThan(
      preferenceScore({ ...request(), energy: "active" }, library),
    );
    expect(library).not.toHaveProperty("familyFriendly");
  });
  it("prefers lower published cost for a budget vibe and does not claim unknown costs", () => {
    const base = fixturePlaces(request())[0];
    const inexpensive = { ...base, price: { ...base.price, low: 5, high: 10 } };
    const expensive = { ...base, price: { ...base.price, low: 40, high: 60 } };
    const unknown = {
      ...base,
      price: { ...base.price, low: null, high: null },
    };
    const preference = { ...request(), vibes: ["budget-friendly" as const] };
    expect(preferenceScore(preference, inexpensive)).toBeGreaterThan(
      preferenceScore(preference, expensive),
    );
    expect(preferenceScore(preference, inexpensive)).toBeGreaterThan(
      preferenceScore(preference, unknown),
    );
    expect(unknown.price.high).toBeNull();
  });
  it("gives an explicit remix priority over the previous outing's soft mood before AI selection", () => {
    const base = fixturePlaces(request())[0];
    const gallery = {
      ...base,
      category: "art gallery",
      types: ["art_gallery"],
    };
    const bowling = {
      ...base,
      category: "bowling alley",
      types: ["bowling_alley"],
    };
    const cozy = {
      ...request(),
      energy: "chill" as const,
      vibes: ["cozy" as const],
    };
    expect(preferenceScore(cozy, bowling, "More exciting")).toBeGreaterThan(
      preferenceScore(cozy, gallery, "More exciting"),
    );
    const exciting = {
      ...request(),
      energy: "active" as const,
      vibes: ["exciting" as const],
    };
    expect(preferenceScore(exciting, gallery, "More relaxing")).toBeGreaterThan(
      preferenceScore(exciting, bowling, "More relaxing"),
    );
    const food = { ...base, category: "cafe", types: ["cafe"] };
    expect(preferenceScore(request(), food, "More food")).toBeGreaterThan(
      preferenceScore(request(), gallery, "More food"),
    );
  });
  it("actually changes the bounded live-provider shortlist before AI selection", async () => {
    const r = { ...request(), energy: "chill" as const };
    const base = fixturePlaces(r)[0];
    const places = Array.from({ length: 12 }, (_, index) => ({
      ...base,
      id: `retrieved-${index}`,
      category: "place",
      types: [index >= 10 ? "park" : "bar"],
      point: r.area.center,
    }));
    const selected = vi
      .fn()
      .mockImplementation(async (_request, candidates) => ({
        title: "Synthetic provider response",
        summary: "",
        stops: [
          {
            placeId: candidates[0].id,
            minutes: 45,
            reason: "Retrieved candidate",
          },
        ],
      }));
    const search = vi.fn().mockResolvedValue(places);
    await new Planner(
      {
        search,
        details: async (id) => places.find((place) => place.id === id)!,
        location: async () => r.location,
      },
      new FixtureRoutes(),
      { select: selected },
    ).generate(r);
    expect(search.mock.calls[0][0].interests).toContain("Relaxation");
    expect(selected.mock.calls[0][1]).toHaveLength(10);
    expect(
      selected.mock.calls[0][1].map((place: { id: string }) => place.id),
    ).toContain("retrieved-11");
  });
  it("keeps explicit fixture personalization deterministic, labelled and distinct", async () => {
    const r = request();
    const places = fixturePlaces(r);
    const normal = await new FixtureAI().select(r, places, []);
    const family = await new FixtureAI().select(
      { ...r, companion: "family", energy: "chill" },
      places,
      [],
    );
    expect(family.stops.map((stop) => stop.placeId)).not.toEqual(
      normal.stops.map((stop) => stop.placeId),
    );
    expect(family.summary).toContain("Development fixture");
    const cheaper = await new FixtureAI().select(
      r,
      places,
      [],
      "Make it cheaper",
    );
    expect(cheaper.stops.map((stop) => stop.placeId)).not.toContain(
      places[2].id,
    );
  });
  it("uses the same personalized candidate system for unqueried replacement browsing", async () => {
    const r = {
      ...request(),
      companion: "family" as const,
      energy: "chill" as const,
    };
    const places = fixturePlaces(r);
    const search = vi.fn().mockResolvedValue(places);
    const planner = new Planner(
      {
        search,
        details: async (id) => places.find((place) => place.id === id)!,
        location: async () => r.location,
      },
      new FixtureRoutes(),
      new FixtureAI(),
    );
    await planner.explore(r);
    expect(search.mock.calls[0][0].interests).toEqual(["Family", "Relaxation"]);
    await planner.explore(r, "specific user query");
    expect(search.mock.calls[1][0].interests).toEqual(["Surprise me"]);
    expect(search.mock.calls[1][1]).toBe("specific user query");
  });
});

describe("Truthful availability, prices, routes and locks", () => {
  it("generates an estimated-free outing without paid or unknown costs when the user selects a zero ceiling", async () => {
    const r = { ...request(), budget: 0, hardBudget: true };
    const places = fixturePlaces(r);
    places[1].price = {
      ...places[1].price,
      high: null,
      low: null,
      source: "unknown",
      confidence: "unknown",
    };
    const plan = await new Planner(
      {
        search: async () => places,
        details: async (id) => places.find((place) => place.id === id)!,
        location: async () => r.location,
      },
      new FixtureRoutes(),
      new FixtureAI(),
      true,
    ).generate(r);
    expect(plan.cost.high).toBe(0);
    expect(plan.cost.unknown).toBe(0);
    expect(plan.stops.every((stop) => stop.place.price.high === 0)).toBe(true);
    expect(
      plan.issues.some((issue) => issue.code === "BROWSING_ESTIMATE"),
    ).toBe(true);
  });
  it("resolves budgets in locally sourced currencies outside the original small country list", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    for (const [country, currency] of [
      ["CO", "COP"],
      ["PE", "PEN"],
      ["SA", "SAR"],
      ["RO", "RON"],
      ["BG", "EUR"],
      ["ZW", "ZWG"],
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              id: "selected-area",
              displayName: { text: "Area returned by provider" },
              location: { latitude: 4.71, longitude: -74.07 },
              addressComponents: [{ shortText: country, types: ["country"] }],
            }),
          ),
        ),
      );
      expect(
        (await new GooglePlaces().location("selected-area")).currency,
      ).toBe(currency);
    }
  });
  it("never silently labels an unresolved country or ocean pin as USD", async () => {
    expect(() => currencyForCountry(undefined)).toThrow(AppError);
    expect(() => currencyForCountry("ZZ")).toThrow(AppError);
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "ZERO_RESULTS",
            results: [],
          }),
        ),
      ),
    );
    await expect(resolvePoint({ lat: 0, lng: 0 })).rejects.toMatchObject({
      code: "CURRENCY_UNAVAILABLE",
    });
  });
  it("uses the same confirmed country currency for a reverse-geocoded map pin", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            status: "OK",
            results: [
              {
                formatted_address: "Lima, Peru",
                address_components: [{ short_name: "PE", types: ["country"] }],
              },
            ],
          }),
        ),
      ),
    );
    expect(await resolvePoint({ lat: -12.05, lng: -77.05 })).toMatchObject({
      currency: "PEN",
      timezone: "America/Lima",
    });
  });
  it("rejects a provider duration that cannot be represented as finite travel time", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                duration: `${"9".repeat(400)}s`,
                distanceMeters: 800,
                polyline: { encodedPolyline: "??AA" },
              },
            ],
          }),
        ),
      ),
    );
    await expect(
      new GoogleRoutes().leg(
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        "WALK",
        "from",
        "to",
      ),
    ).rejects.toMatchObject({ code: "NO_ROUTE" });
  });
  it("rejects malformed encoded geometry before marking a Google route verified", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    for (const polyline of ["abc", "!", "??"]) {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              routes: [
                {
                  duration: "600s",
                  distanceMeters: 800,
                  polyline: { encodedPolyline: polyline },
                },
              ],
            }),
          ),
        ),
      );
      await expect(
        new GoogleRoutes().leg(
          { lat: 0, lng: 0 },
          { lat: 1, lng: 1 },
          "WALK",
          "from",
          "to",
        ),
      ).rejects.toMatchObject({ code: "NO_ROUTE" });
    }
  });
  it("accepts a genuine zero-distance provider result without inventing a visible path", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                duration: "0s",
                distanceMeters: 0,
                polyline: { encodedPolyline: "??" },
              },
            ],
          }),
        ),
      ),
    );
    expect(
      await new GoogleRoutes().leg(
        { lat: 0, lng: 0 },
        { lat: 0, lng: 0 },
        "WALK",
        "from",
        "to",
      ),
    ).toMatchObject({ verified: true, meters: 0, minutes: 0, polyline: "??" });
  });
  it("explicitly distinguishes browsing cost estimates from verified free admission", async () => {
    const s = spec();
    const plan = await schedule(
      s,
      fixturePlaces(s.request),
      new FixtureRoutes(),
    );
    expect(
      plan.issues.find((issue) => issue.code === "BROWSING_ESTIMATE")?.message,
    ).toContain("not verified free admission");
  });
  it("rejects known closed businesses even if their old hours would fit", () => {
    const r = request();
    const places = fixturePlaces(r);
    places[0].businessStatus = "CLOSED_PERMANENTLY";
    places[1].businessStatus = "CLOSED_TEMPORARILY";
    expect(candidatesFor(r, places).map((place) => place.id)).not.toContain(
      places[0].id,
    );
    expect(candidatesFor(r, places).map((place) => place.id)).not.toContain(
      places[1].id,
    );
  });
  it("does not turn wrong-currency or malformed published park prices into free admission", () => {
    const raw = {
      id: "retrieved-park",
      displayName: { text: "Provider park" },
      primaryType: "park",
      location: { latitude: 43.65, longitude: -79.38 },
      priceRange: {
        startPrice: { units: "10", currencyCode: "USD" },
        endPrice: { units: "20", currencyCode: "USD" },
      },
    };
    expect(normalize(raw, "CAD").price).toMatchObject({
      low: null,
      high: null,
      source: "unknown",
      confidence: "unknown",
      optional: false,
    });
    expect(
      normalize(
        {
          ...raw,
          priceRange: {
            startPrice: { units: "30", currencyCode: "CAD" },
            endPrice: { units: "10", currencyCode: "CAD" },
          },
        },
        "CAD",
      ).price.high,
    ).toBeNull();
  });
  it("preserves an edited locked visit above 180 minutes during remix", async () => {
    const previous = spec();
    previous.request.duration = 720;
    previous.stops[0] = { ...previous.stops[0], minutes: 240, locked: true };
    const result = await new Planner(
      new FixturePlaces(previous.request),
      new FixtureRoutes(),
      new FixtureAI(),
      true,
    ).generate(previous.request, previous, "More relaxing");
    expect(
      result.stops.find((stop) => stop.placeId === previous.stops[0].placeId),
    ).toMatchObject({
      minutes: 240,
      locked: true,
      reason: previous.stops[0].reason,
    });
  });
  it("does not ask the AI to keep a locked place that known availability makes impossible", async () => {
    const previous = spec();
    previous.stops[0].locked = true;
    const places = fixturePlaces(previous.request);
    places[0].businessStatus = "CLOSED_PERMANENTLY";
    const select = vi.fn();
    const provider = {
      search: async () => places,
      details: async (id: string) => places.find((place) => place.id === id)!,
      location: async () => previous.request.location,
    };
    await expect(
      new Planner(provider, new FixtureRoutes(), { select }).generate(
        previous.request,
        previous,
        "More relaxing",
      ),
    ).rejects.toMatchObject({ code: "LOCK_CONFLICT", status: 422 });
    expect(select).not.toHaveBeenCalled();
  });
  it("rejects new AI visits over 180 minutes instead of silently truncating them", async () => {
    const r = request();
    const selected = {
      select: async () => ({
        title: "Synthetic",
        summary: "",
        stops: [
          {
            placeId: fixturePlaces(r)[0].id,
            minutes: 200,
            reason: "Synthetic",
          },
        ],
      }),
    };
    await expect(
      new Planner(new FixturePlaces(r), new FixtureRoutes(), selected).generate(
        r,
      ),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
  });
  it("omits a known unavailable route only in a clearly labelled partial plan", async () => {
    const s = spec();
    const brokenId = s.stops[1].placeId;
    const route = new FixtureRoutes();
    const leg = vi
      .fn()
      .mockImplementation(async (...args: Parameters<FixtureRoutes["leg"]>) => {
        if (args[4] === brokenId)
          throw new AppError("NO_ROUTE", "No route", 422);
        return route.leg(...args);
      });
    const result = await schedule(s, fixturePlaces(s.request), { leg }, true);
    expect(result.stops.map((stop) => stop.placeId)).toEqual([
      s.stops[0].placeId,
      s.stops[2].placeId,
    ]);
    expect(result.legs[0]).toMatchObject({
      from: s.stops[0].placeId,
      to: s.stops[2].placeId,
    });
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["NO_ROUTE", "PARTIAL"]),
    );
    s.stops[1].locked = true;
    await expect(
      schedule(s, fixturePlaces(s.request), { leg }, true),
    ).rejects.toMatchObject({ code: "NO_ROUTE" });
  });
  it("still fails closed for a provider outage rather than presenting a misleading partial route", async () => {
    const s = spec();
    await expect(
      schedule(
        s,
        fixturePlaces(s.request),
        {
          leg: async () => {
            throw new AppError("PROVIDER_TIMEOUT", "Unavailable", 502);
          },
        },
        true,
      ),
    ).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  });
});

function wire(data: unknown) {
  return new Response(
    JSON.stringify({
      id: "resp_test",
      object: "response",
      status: "completed",
      created_at: 1,
      model: "test-model",
      output: [
        {
          id: "msg_test",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(data),
              annotations: [],
            },
          ],
        },
      ],
      usage: {
        input_tokens: 10,
        output_tokens: 10,
        total_tokens: 20,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
describe("Actual SDK selection context", () => {
  it("sends personalized controls, destination calendar context and provider evidence to the structured AI", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "test-model");
    const r = {
      ...request(1),
      companion: "date" as const,
      energy: "chill" as const,
      vibes: ["cozy" as const],
    };
    const places = fixturePlaces(r);
    const send = vi
      .fn()
      .mockResolvedValueOnce(
        wire({
          explicitRequirements: [],
          preferences: [],
          suggestions: [],
          conflicts: [],
        }),
      )
      .mockResolvedValueOnce(
        wire({
          title: "Synthetic",
          summary: "",
          stops: [{ placeId: places[0].id, minutes: 45, reason: "Synthetic" }],
        }),
      );
    vi.stubGlobal("fetch", send);
    await new OpenAIRecommender().select(r, places, []);
    const intentInput = JSON.parse(
      JSON.parse(send.mock.calls[0][1].body).input[1].content,
    );
    expect(intentInput.currentDate).toBe(
      DateTime.now().setZone("Asia/Tokyo").toISODate(),
    );
    const selectionInput = JSON.parse(
      JSON.parse(send.mock.calls[1][1].body).input[1].content,
    );
    expect(
      JSON.parse(send.mock.calls[1][1].body).text.format.schema.properties.stops
        .items.properties.minutes.maximum,
    ).toBe(240);
    expect(selectionInput.request).toMatchObject({
      companion: "date",
      energy: "chill",
      vibes: ["cozy"],
    });
    expect(selectionInput.candidates[0]).toMatchObject({
      types: places[0].types,
      businessStatus: "OPERATIONAL",
      hoursSource: "typical",
    });
  });
  it("reports genuine conflicts before selection without a fallback that ignores the controls", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "test-model");
    const send = vi.fn().mockResolvedValueOnce(
      wire({
        explicitRequirements: [],
        preferences: [],
        suggestions: [],
        conflicts: ["The prompt requires driving but walking is selected."],
      }),
    );
    vi.stubGlobal("fetch", send);
    await expect(
      new OpenAIRecommender().select(request(), fixturePlaces(request()), []),
    ).rejects.toMatchObject({ code: "CONFLICTING_REQUEST", status: 422 });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
