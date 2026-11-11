import { beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";
import { GET, POST } from "@/app/api/[...path]/route";
import { crowdFor, sentiment, slug, toSignals } from "@/lib/crowd";
import { buildRequest, interpret } from "@/lib/intent";
import {
  applyPoll,
  nextPoll,
  placeKeys,
  polls,
  SignalBatch,
} from "@/lib/polls";
import { emptyProfile } from "@/lib/profile";
import { invalidateCrowd, memoryStore } from "@/lib/server/signals";
import type { Itinerary } from "@/lib/schema";

vi.mock("@/lib/server/supabase", () => ({
  currentUser: async () => null,
  requireUser: async () => {
    throw new Error("no user");
  },
  supabase: async () => ({ rpc: vi.fn(async () => ({ error: null })) }),
}));
const ctx = (path: string) => ({
  params: Promise.resolve({ path: path.split("/") }),
});
const headers = {
  "Content-Type": "application/json",
  "X-Whimway-Client": "app",
};
const post = (path: string, input: unknown) =>
  POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    }),
    ctx(path),
  );
const get = (path: string) =>
  GET(new Request(`http://localhost:3000/api/${path}`, { headers }), ctx(path));
const install = (i: number) => `install-${String(i).padStart(4, "0")}`;

beforeEach(() => {
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  vi.stubEnv("DAILY_GUEST_GENERATIONS", "1000");
  memoryStore.signals.clear();
  memoryStore.answers.clear();
  invalidateCrowd();
});

describe("Crowd maths", () => {
  it("ignores keys until five people have weighed in, then smooths", () => {
    expect(sentiment({ up: 4, down: 0 })).toBe(0);
    expect(sentiment({ up: 5, down: 0 })).toBeCloseTo(5 / 13);
    expect(sentiment({ up: 1, down: 9 })).toBeLessThan(-0.4);
    expect(Math.abs(sentiment({ up: 500, down: 0 }))).toBeLessThan(1);
  });
  it("combines place, type and category into one bounded score", () => {
    const place = { id: "abc", category: "Board game café", types: ["cafe"] };
    expect(slug(place.category)).toBe("board game cafe");
    const crowd = toSignals({
      "place:abc": { up: 20, down: 0 },
      "cat:board game cafe": { up: 10, down: 0 },
    });
    expect(crowdFor(place, crowd)).toBeGreaterThan(0.5);
    expect(crowdFor(place, crowd)).toBeLessThanOrEqual(1);
  });
  it("only accepts safe, well-formed signal keys", () => {
    const ok = {
      installId: install(1),
      source: "stop",
      entries: [{ key: "cat:board game cafe", value: 1 }],
    };
    expect(SignalBatch.safeParse(ok).success).toBe(true);
    expect(
      SignalBatch.safeParse({
        ...ok,
        entries: [{ key: "drop table", value: 1 }],
      }).success,
    ).toBe(false);
    expect(
      SignalBatch.safeParse({ ...ok, entries: [{ key: "cat:x", value: 5 }] })
        .success,
    ).toBe(false);
    expect(
      placeKeys({
        id: "gta-bar-raval",
        category: "Cocktail bar",
        types: ["cocktail_bar"],
      }),
    ).toEqual(["cat:cocktail bar", "type:cocktail_bar", "place:gta-bar-raval"]);
  });
});

describe("Polls", () => {
  it("tune the user's own taste immediately and rotate", () => {
    const poll = polls.find((p) => p.id === "late-night")!;
    const p = applyPoll(emptyProfile(), poll, "a");
    expect(p.affinity.cocktail_bar).toBe(0.3);
    expect(p.affinity.ice_cream_shop).toBe(-0.1);
    expect(p.polls["late-night"]).toBe("a");
    expect(nextPoll(p.polls)?.id).not.toBe("late-night");
  });
  it("return live tallies and feed community signals", async () => {
    for (let i = 0; i < 7; i++)
      expect(
        (
          await post("polls/answer", {
            pollId: "date-idea",
            choice: i < 5 ? "b" : "a",
            installId: install(i),
          })
        ).status,
      ).toBe(200);
    const last = await (
      await post("polls/answer", {
        pollId: "date-idea",
        choice: "b",
        installId: install(0),
      })
    ).json();
    expect(last.tally).toEqual({ a: 2, b: 5 }); // re-voting replaces, never double counts
    const listed = await (await get("polls")).json();
    expect(listed.polls.length).toBeGreaterThan(5);
    expect(listed.tallies["date-idea"]).toEqual({ a: 2, b: 5 });
    expect(
      (
        await post("polls/answer", {
          pollId: "nope",
          choice: "a",
          installId: install(1),
        })
      ).status,
    ).toBe(404);
  });
});

describe("Community signals change recommendations", () => {
  const future = DateTime.now().setZone("America/Toronto").plus({ days: 3 });
  const text =
    "romantic but adventurous night with my girlfriend downtown, $100 total";
  const request = () => ({
    ...buildRequest(text, interpret(text, future), emptyProfile(), future),
    date: future.toISODate()!,
    startTime: "18:30",
  });
  const generate = async () =>
    (await (
      await post("generate", { request: request(), demo: true })
    ).json()) as Itinerary;

  it("a venue many people dislike drops out of new plans; a handful of votes does not", async () => {
    const before = await generate();
    const target = before.stops.find(
      (s) => !/restaurant/.test(s.place.types.join()),
    )!;
    const down = (i: number) =>
      post("signals", {
        installId: install(i),
        source: "stop",
        entries: placeKeys(target.place).map((key) => ({ key, value: -1 })),
      });

    for (let i = 0; i < 4; i++) await down(i);
    expect((await generate()).stops.map((s) => s.placeId)).toContain(
      target.placeId,
    );

    for (let i = 4; i < 12; i++) await down(i);
    expect((await generate()).stops.map((s) => s.placeId)).not.toContain(
      target.placeId,
    );
  });

  it("post-outing feedback counts as community signal", async () => {
    const plan = await generate();
    const stop = plan.stops[0];
    for (let i = 0; i < 6; i++)
      await post("feedback", {
        planId: plan.id,
        installId: install(100 + i),
        went: "yes",
        rating: 5,
        stops: [
          { placeId: stop.placeId, category: stop.place.category, reaction: 1 },
        ],
      });
    const tallies = await memoryStore.tallies();
    expect(tallies[`place:${stop.placeId}`]).toEqual({ up: 6, down: 0 });
  });
});
