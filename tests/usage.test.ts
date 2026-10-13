import { describe, it, expect, vi, afterEach } from "vitest";
import { meteredFetch, tokenUsage } from "@/lib/server/usage";
import { OpenAIRecommender } from "@/lib/providers/ai";
import { fixturePlaces } from "@/lib/providers/fixtures";
import { request } from "./helpers";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});
describe("Actual provider-request allowances", () => {
  it("blocks the next network request when the global attempt allowance is exhausted", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-01T12:00Z"));
    vi.stubEnv("GLOBAL_DAILY_PROVIDER_REQUEST_LIMIT", "1");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const send = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", send);
    await meteredFetch("https://places.googleapis.com/v1/places/example");
    await expect(
      meteredFetch("https://routes.googleapis.com/directions/v2:computeRoutes"),
    ).rejects.toMatchObject({ code: "PROVIDER_DAILY_LIMIT", status: 429 });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("fails closed before any provider network call when production Redis is absent", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const send = vi.fn();
    vi.stubGlobal("fetch", send);
    await expect(
      meteredFetch("https://api.openai.com/v1/responses"),
    ).rejects.toMatchObject({ code: "LIMITER_NOT_CONFIGURED" });
    expect(send).not.toHaveBeenCalled();
  });
  it("records safe counts without logging URLs, credentials, place IDs or prompts", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2040-01-02T12:00Z"));
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
    await meteredFetch(
      "https://maps.googleapis.com/maps/api/geocode/json?key=secret-value&latlng=43.6,-79.3",
    );
    tokenUsage({ input_tokens: 100, output_tokens: 20 });
    const records = log.mock.calls.map(([s]) => JSON.parse(s));
    expect(records[0]).toMatchObject({
      event: "provider_request",
      provider: "google_maps",
    });
    expect(records[1]).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(JSON.stringify(records)).not.toMatch(/secret-value|latlng|43\.6/);
  });
});
function wire(data: unknown) {
  return new Response(
    JSON.stringify({
      id: "resp_fixture",
      object: "response",
      created_at: 1,
      status: "completed",
      model: "fixture-model",
      output: [
        {
          id: "msg_fixture",
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
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
}
describe("Real Responses SDK with synthetic HTTP fixtures", () => {
  it("parses structured intent and selection and uses only retrieved candidates", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "fixture-model");
    const r = request();
    const p = fixturePlaces(r);
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
          title: "A structured fixture outing",
          summary: "Fixture response",
          stops: [
            { placeId: p[0].id, minutes: 45, reason: "A fixture reason." },
          ],
        }),
      );
    vi.stubGlobal("fetch", send);
    const result = await new OpenAIRecommender().select(r, p, []);
    expect(result.stops[0].placeId).toBe(p[0].id);
    expect(send).toHaveBeenCalledTimes(2);
    for (const call of send.mock.calls) {
      const body = JSON.parse(call[1].body);
      expect(body.text.format.type).toBe("json_schema");
      expect(body.text.format.strict).toBe(true);
    }
  });
  it("rejects an invented place ID after SDK parsing rather than displaying it", async () => {
    vi.stubEnv("WHIMWAY_OPENAI_KEY", "test-key");
    vi.stubEnv("WHIMWAY_OPENAI_MODEL", "fixture-model");
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
          title: "Invalid fixture",
          summary: "",
          stops: [{ placeId: "invented", minutes: 45, reason: "Fixture" }],
        }),
      );
    vi.stubGlobal("fetch", send);
    await expect(
      new OpenAIRecommender().select(request(), fixturePlaces(request()), []),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
  });
});

describe("Provider request cancellation", () => {
  it("propagates a disconnected application request to an in-flight provider fetch", async () => {
    const { withProviderContext } =
      await import("@/lib/server/provider-context");
    const controller = new AbortController();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(init.signal!.reason),
              { once: true },
            );
          }),
      ),
    );
    const pending = withProviderContext(controller.signal, () =>
      meteredFetch("https://places.googleapis.com/v1/places/example"),
    );
    const expected = expect(pending).rejects.toMatchObject({
      code: "REQUEST_CANCELLED",
      status: 499,
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();
    await expected;
  });
  it("enforces a whole-operation deadline rather than allowing sequential calls to outlive the client", async () => {
    const { withProviderContext } =
      await import("@/lib/server/provider-context");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener(
              "abort",
              () => reject(init.signal!.reason),
              { once: true },
            );
          }),
      ),
    );
    await expect(
      withProviderContext(
        new AbortController().signal,
        () =>
          meteredFetch(
            "https://routes.googleapis.com/directions/v2:computeRoutes",
          ),
        30,
      ),
    ).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 504 });
  });
});
