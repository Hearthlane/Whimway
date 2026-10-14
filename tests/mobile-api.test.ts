import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST, DELETE } from "@/app/api/[...path]/route";
import { body, rateLimit } from "@/lib/server/security";
import { PlanningIntent, PlanRequest, TravelLeg } from "@/lib/schema";
import { DateTime } from "luxon";
import { request, spec } from "./helpers";

const ctx = (path: string) => ({
  params: Promise.resolve({ path: path.split("/") }),
});
const nativeRequest = (
  path: string,
  data: unknown,
  headers: HeadersInit = {},
) =>
  new Request(`http://localhost:3000/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(data),
  });
const post = (path: string, data: unknown, headers?: HeadersInit) =>
  POST(nativeRequest(path, data, headers), ctx(path));
beforeEach(() => {
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
  vi.stubEnv("DAILY_GUEST_GENERATIONS", "100");
  vi.stubEnv("DAILY_GUEST_INTENTS", "100");
  vi.stubEnv("GLOBAL_DAILY_PROVIDER_REQUEST_LIMIT", "1000");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function aiResponse(preferences: unknown) {
  return new Response(
    JSON.stringify({
      id: "resp_synthetic",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "test-model",
      output: [
        {
          id: "msg_synthetic",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            {
              type: "output_text",
              text: JSON.stringify(preferences),
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
const extracted = (overrides: object = {}) => ({
  locationQuery: null,
  dateChoice: null,
  date: null,
  startTime: null,
  duration: null,
  budget: null,
  participants: null,
  companion: null,
  energy: null,
  vibes: null,
  interests: null,
  mode: null,
  dietary: null,
  accessibility: null,
  warnings: [],
  ...overrides,
});

describe("Native API boundary", () => {
  it("allows anonymous JSON planning without browser cookies or an Origin", async () => {
    const result = await post("generate", { request: request(), demo: true });
    expect(result.status).toBe(200);
    expect((await result.json()).stops.length).toBeGreaterThan(0);
  });
  it("does not allow a native marker to bypass cookie or cross-site CSRF checks", async () => {
    const attempts: Record<string, string>[] = [
      { Cookie: "session=browser", "X-Whimway-Native": "true" },
      { Origin: "https://attacker.example", "X-Whimway-Native": "true" },
      { "Sec-Fetch-Site": "cross-site", "X-Whimway-Native": "true" },
    ];
    for (const headers of attempts) {
      const result = await post(
        "generate",
        { request: request(), demo: true },
        headers,
      );
      expect(result.status).toBe(403);
      expect((await result.json()).code).toBe("INVALID_ORIGIN");
    }
  });
  it("enforces streamed payload limits even without a content-length", async () => {
    await expect(
      body(nativeRequest("intent", { prompt: "x".repeat(33000) })),
    ).rejects.toMatchObject({ code: "TOO_LARGE", status: 413 });
  });
  it("keeps saved cloud resources private for native guests", async () => {
    const result = await GET(
      new Request("http://localhost:3000/api/plans"),
      ctx("plans"),
    );
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe("PERSISTENCE_DISABLED");
    const deletion = await DELETE(
      new Request(`http://localhost:3000/api/plans/${spec().id}`, {
        method: "DELETE",
      }),
      ctx(`plans/${spec().id}`),
    );
    expect(deletion.status).toBe(503);
  });
  it("reopens a started or historical plan without permitting a new past outing", async () => {
    const saved = spec();
    saved.request.date = DateTime.now()
      .setZone(saved.request.location.timezone)
      .minus({ days: 2 })
      .toISODate()!;
    const reopened = await post("hydrate", saved);
    expect(reopened.status).toBe(200);
    const hydrated = await reopened.json();
    expect(hydrated.request.date).toBe(saved.request.date);
    expect(hydrated.stops[0].arrival.slice(0, 10)).toBe(saved.request.date);
    expect(
      (await post("generate", { request: saved.request, demo: true })).status,
    ).toBe(400);
    expect(
      (await post("edit", { spec: saved, stops: saved.stops })).status,
    ).toBe(400);
  });
  it("rejects malformed authorization rather than treating it as a fresh guest", async () => {
    const result = await post(
      "generate",
      { request: request(), demo: true },
      { Authorization: "Basic invented" },
    );
    expect(result.status).toBe(401);
    expect((await result.json()).code).toBe("INVALID_AUTH");
  });
  it("does not reset quotas with caller-supplied forwarding headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2044-05-10T12:00:00Z"));
    vi.stubEnv("DAILY_GUEST_GENERATIONS", "1");
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("TRUSTED_PROXY_HEADERS", "false");
    await rateLimit(
      nativeRequest("generate", {}, { "X-Forwarded-For": "1.2.3.4" }),
      "generate",
    );
    await expect(
      rateLimit(
        nativeRequest(
          "generate",
          {},
          { "X-Forwarded-For": "5.6.7.8", "X-Vercel-Forwarded-For": "9.8.7.6" },
        ),
        "generate",
      ),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", status: 429 });
  });
});

describe("Prompt intake before required planning answers", () => {
  it("returns supplied preferences without requiring a location object or date", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "test-model");
    const send = vi.fn().mockResolvedValue(
      aiResponse(
        extracted({
          locationQuery: "Eaton Centre",
          dateChoice: "tomorrow",
          budget: 70,
          companion: "date",
          participants: 2,
          interests: ["Food & drinks", "Shopping", "Interactive fun"],
          vibes: ["exciting"],
        }),
      ),
    );
    vi.stubGlobal("fetch", send);
    const result = await post("intent", {
      prompt:
        "A fun date around Eaton Centre tomorrow, $70 each, food, shopping and something exciting.",
    });
    expect(result.status).toBe(200);
    const draft = PlanningIntent.parse(await result.json());
    expect(draft).toMatchObject({
      locationQuery: "Eaton Centre",
      dateChoice: "tomorrow",
      budget: 70,
      companion: "date",
    });
    expect(draft).not.toHaveProperty("date");
    expect(draft).not.toHaveProperty("startTime");
    expect(draft).not.toHaveProperty("duration");
    expect(draft).not.toHaveProperty("location");
    const outbound = JSON.parse(send.mock.calls[0][1].body);
    expect(outbound.store).toBe(false);
    expect(outbound.text.format.strict).toBe(true);
  });
  it("does not resolve tomorrow in a supplied device timezone", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "test-model");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          aiResponse(extracted({ dateChoice: "tomorrow", date: "2026-10-14" })),
        ),
    );
    const result = await post("intent", {
      prompt: "A relaxed outing tomorrow",
      timezone: "Asia/Tokyo",
    });
    expect(await result.json()).toEqual({
      dateChoice: "tomorrow",
      warnings: [],
    });
  });
  it("fails honestly if the AI is unconfigured", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    const result = await post("intent", { prompt: "A fun day in Toronto" });
    expect(result.status).toBe(503);
    expect((await result.json()).code).toBe("NOT_CONFIGURED");
  });
  it("rejects impossible dates from structured AI output", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "test-model");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          aiResponse(extracted({ dateChoice: "specific", date: "2027-02-30" })),
        ),
    );
    const result = await post("intent", { prompt: "Explore on February 30" });
    expect(result.status).toBe(502);
    expect((await result.json()).code).toBe("INVALID_AI_OUTPUT");
  });
  it("keeps adaptive preferences optional for existing web plans", () => {
    expect(PlanRequest.parse(request())).not.toHaveProperty("companion");
    expect(
      PlanRequest.parse({
        ...request(),
        companion: "family",
        energy: "chill",
        vibes: ["cozy"],
      }),
    ).toMatchObject({ companion: "family", energy: "chill", vibes: ["cozy"] });
  });
});

describe("Current location to stop routes", () => {
  const route = {
    from: { lat: 43.65, lng: -79.38 },
    to: { lat: 43.66, lng: -79.39 },
    toId: "verified-place",
    mode: "WALK",
  };
  it("returns Google geometry and duration for a native current-position route", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    const send = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            routes: [
              {
                duration: "600s",
                distanceMeters: 800,
                polyline: { encodedPolyline: "??AA" },
              },
            ],
          }),
        ),
      );
    vi.stubGlobal("fetch", send);
    const result = await post("route", route);
    expect(result.status).toBe(200);
    expect(TravelLeg.parse(await result.json())).toMatchObject({
      from: "current",
      to: "verified-place",
      minutes: 10,
      meters: 800,
      polyline: "??AA",
      verified: true,
    });
    expect(
      JSON.parse(send.mock.calls[0][1].body).origin.location.latLng.latitude,
    ).toBe(43.65);
  });
  it("does not invent geometry when Google has no route", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ routes: [] }))),
    );
    const result = await post("route", route);
    expect(result.status).toBe(422);
    expect((await result.json()).code).toBe("NO_ROUTE");
  });
  it("rejects empty geometry and negative provider distances", async () => {
    vi.stubEnv("GOOGLE_MAPS_SERVER_KEY", "test-key");
    for (const malformed of [
      {
        duration: "600s",
        distanceMeters: 800,
        polyline: { encodedPolyline: "" },
      },
      {
        duration: "600s",
        distanceMeters: -1,
        polyline: { encodedPolyline: "geometry" },
      },
    ]) {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ routes: [malformed] })),
          ),
      );
      const result = await post("route", route);
      expect(result.status).toBe(422);
      expect((await result.json()).code).toBe("NO_ROUTE");
    }
  });
  it("requires an explicit development fixture and labels it unverified", async () => {
    const result = await post("route", { ...route, demo: true });
    expect(TravelLeg.parse(await result.json())).toMatchObject({
      polyline: "",
      verified: false,
    });
    vi.stubEnv("WHIMWAY_DEMO_MODE", "false");
    const disabled = await post("route", { ...route, demo: true });
    expect(disabled.status).toBe(403);
  });
});
