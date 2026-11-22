import Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRequest, interpret } from "@/lib/intent";
import { emptyProfile } from "@/lib/profile";
import { Planner } from "@/lib/planner";
import {
  ClaudeRecommender,
  claudeConfigured,
  claudeModel,
} from "@/lib/providers/claude";
import { FixturePlaces, FixtureRoutes } from "@/lib/providers/fixtures";
import { gtaCatalog } from "@/lib/providers/gta-demo";

const future = DateTime.now().setZone("America/Toronto").plus({ days: 3 });
const request = () => ({
  ...buildRequest(
    "friends night out, fun",
    interpret("friends night out, fun", future),
    { ...emptyProfile(), mode: "TRANSIT" as const },
    future,
  ),
  date: future.toISODate()!,
  startTime: "18:30",
});
const candidates = gtaCatalog.filter((p) =>
  ["gta-la-carnita", "gta-captive", "gta-millie", "gta-rec-room"].includes(
    p.id,
  ),
);

/** A real SDK client whose network returns `answer` as Claude's structured output. */
function claudeReturning(answer: unknown, extra: Record<string, unknown> = {}) {
  const calls: {
    url: string;
    body: Record<string, unknown>;
    headers: Headers;
  }[] = [];
  const fetch = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      });
      return new Response(
        JSON.stringify({
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: claudeModel(),
          content: [{ type: "text", text: JSON.stringify(answer) }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1200, output_tokens: 300 },
          ...extra,
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  );
  return {
    client: new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 }),
    calls,
  };
}

beforeEach(() => vi.unstubAllEnvs());

describe("Claude as the planner", () => {
  it("is used only when its key is set, and defaults to Haiku", () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(claudeConfigured()).toBe(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    expect(claudeConfigured()).toBe(true);
    expect(claudeModel()).toBe("claude-haiku-5-5");
    vi.stubEnv("WHIMWAY_CLAUDE_MODEL", "claude-sonnet-5-5");
    expect(claudeModel()).toBe("claude-sonnet-5-5");
  });

  it("asks for structured output over the offered places only, and returns a valid selection", async () => {
    const { client, calls } = claudeReturning({
      title: "Tacos Then Puzzles",
      summary: "Dinner, then an escape room.",
      stops: [
        {
          placeId: "gta-la-carnita",
          minutes: 75,
          reason: "Shared plates for the group.",
        },
        {
          placeId: "gta-captive",
          minutes: 60,
          reason: "Work together to get out.",
        },
      ],
    });
    const selection = await new ClaudeRecommender(client).select(
      request(),
      candidates,
      [],
    );
    expect(selection.stops.map((s) => s.placeId)).toEqual([
      "gta-la-carnita",
      "gta-captive",
    ]);
    expect(selection.title).toBe("Tacos Then Puzzles");
    const sent = calls[0].body;
    expect(sent.model).toBe("claude-haiku-5-5");
    expect(
      (sent.output_config as { format: { type: string } }).format.type,
    ).toBe("json_schema");
    const payload = JSON.parse(
      (sent.messages as { content: string }[])[0].content,
    );
    expect(payload.candidates.map((c: { id: string }) => c.id).sort()).toEqual(
      candidates.map((c) => c.id).sort(),
    );
    expect(JSON.stringify(sent)).not.toContain("test-key");
  });

  it("keeps locked stops exactly and clamps visit lengths", async () => {
    const lock = { placeId: "gta-captive", minutes: 60, reason: "Your pick." };
    const { client } = claudeReturning({
      title: "Night",
      summary: "x",
      stops: [
        {
          placeId: "gta-captive",
          minutes: 999,
          reason: "Rewritten by the model",
        },
        { placeId: "gta-millie", minutes: 5, reason: "Dessert." },
      ],
    });
    const s = await new ClaudeRecommender(client).select(
      request(),
      candidates,
      [lock],
    );
    expect(s.stops[0]).toEqual(lock);
    expect(s.stops[1].minutes).toBe(15);
  });

  it("rejects a place that wasn't offered, a refusal, and a bad key, without saving anything", async () => {
    const invented = claudeReturning({
      title: "x",
      summary: "x",
      stops: [{ placeId: "made-up-place", minutes: 60, reason: "x" }],
    });
    await expect(
      new ClaudeRecommender(invented.client).select(request(), candidates, []),
    ).rejects.toMatchObject({ code: "INVALID_AI_OUTPUT" });
    const refused = claudeReturning(
      { title: "", summary: "", stops: [] },
      {
        stop_reason: "refusal",
        stop_details: { type: "refusal", category: null, explanation: null },
      },
    );
    await expect(
      new ClaudeRecommender(refused.client).select(request(), candidates, []),
    ).rejects.toMatchObject({ code: "AI_DECLINED" });
    const badKey = new Anthropic({
      apiKey: "bad",
      maxRetries: 0,
      fetch: async () =>
        new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "authentication_error",
              message: "invalid x-api-key",
            },
          }),
          { status: 401, headers: { "content-type": "application/json" } },
        ),
    });
    await expect(
      new ClaudeRecommender(badKey).select(request(), candidates, []),
    ).rejects.toMatchObject({ code: "AI_FAILED" });
  });

  it("plugs into the planner: Claude's picks go through the same hours, travel and cost checks", async () => {
    const r = request();
    // A fake Claude that picks the first two places it is offered.
    const fetch = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const payload = JSON.parse(
          JSON.parse(String(init?.body)).messages[0].content,
        );
        const ids = payload.candidates
          .map((c: { id: string }) => c.id)
          .slice(0, 2);
        const answer = {
          title: "Claude Picked These",
          summary: "Two stops.",
          stops: ids.map((placeId: string) => ({
            placeId,
            minutes: 60,
            reason: "Fits the group.",
          })),
        };
        return new Response(
          JSON.stringify({
            id: "m",
            type: "message",
            role: "assistant",
            model: "claude-haiku-5-5",
            content: [{ type: "text", text: JSON.stringify(answer) }],
            stop_reason: "end_turn",
            stop_sequence: null,
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
          { headers: { "content-type": "application/json" } },
        );
      },
    );
    const client = new Anthropic({ apiKey: "test-key", fetch, maxRetries: 0 });
    const plan = await new Planner(
      new FixturePlaces(r),
      new FixtureRoutes(),
      new ClaudeRecommender(client),
    ).generate(r);
    expect(plan.title).toBe("Claude Picked These");
    expect(plan.stops.length).toBeGreaterThanOrEqual(1);
    expect(plan.stops.every((s) => s.arrival && s.departure && s.reason)).toBe(
      true,
    );
    expect(fetch).toHaveBeenCalled();
  });
  it("with a proxy-injected key, never sends the placeholder", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "proxy-injected");
    const seen: Headers[] = [];
    vi.stubGlobal("fetch", async (_u: unknown, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return new Response(
        JSON.stringify({
          id: "m",
          type: "message",
          role: "assistant",
          model: "claude-haiku-5-5",
          content: [
            {
              type: "text",
              text: JSON.stringify({
                title: "T",
                summary: "S",
                stops: [{ placeId: "gta-captive", minutes: 60, reason: "R" }],
              }),
            },
          ],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    });
    await new ClaudeRecommender().select(request(), candidates, []);
    expect(seen[0].has("x-api-key")).toBe(false);
    vi.unstubAllGlobals();
  });
});
