import { describe, it, expect, vi, beforeEach } from "vitest";
import { DateTime } from "luxon";
import { POST } from "@/app/api/[...path]/route";
import { buildRequest, interpret } from "@/lib/intent";
import { emptyProfile } from "@/lib/profile";
import { decodeShare, encodeShare, shareUrl } from "@/lib/share-link";
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
function call(path: string, input: unknown, headers: Record<string, string>) {
  return POST(
    new Request(`http://localhost:3000/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(input),
    }),
    ctx(path),
  );
}
const app = { "X-Whimway-Client": "app" };
const future = DateTime.now().setZone("America/Toronto").plus({ days: 2 });
const req = () => ({
  ...buildRequest(
    "romantic night with my girlfriend, $100 total",
    interpret("romantic night with my girlfriend, $100 total", future),
    emptyProfile(),
    future,
  ),
  date: future.toISODate()!,
  startTime: "18:30",
});

beforeEach(() => {
  vi.stubEnv("WHIMWAY_DEMO_MODE", "true");
  vi.stubEnv("DAILY_GUEST_GENERATIONS", "100");
  vi.stubEnv("DAILY_REMIX_LIMIT", "100");
});

describe("Native app access", () => {
  it("accepts the app header without an Origin and generates a GTA demo plan", async () => {
    const r = await call("generate", { request: req(), demo: true }, app);
    expect(r.status).toBe(200);
    const plan = (await r.json()) as Itinerary;
    expect(plan.stops.length).toBeGreaterThanOrEqual(2);
    expect(plan.request.budgetBasis).toBe("total");
  });
  it("still rejects cross-site browsers and header-less requests", async () => {
    expect(
      (
        await call(
          "generate",
          { request: req(), demo: true },
          { Origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await call(
          "generate",
          { request: req(), demo: true },
          { ...app, Origin: "https://evil.example" },
        )
      ).status,
    ).toBe(403);
    expect(
      (await call("generate", { request: req(), demo: true }, {})).status,
    ).toBe(403);
  });
});

describe("Magic edit endpoint", () => {
  it("returns the edited plan, what changed and a human summary", async () => {
    const plan = (await (
      await call("generate", { request: req(), demo: true }, app)
    ).json()) as Itinerary;
    const r = await call(
      "magic-edit",
      {
        spec: plan,
        instruction: "Keep the first two stops, but change the last one",
      },
      app,
    );
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.kind).toBe("replace");
    expect(body.changed).toHaveLength(1);
    expect(body.summary).toMatch(/stop/);
    expect(
      body.plan.stops.slice(0, -1).map((s: { placeId: string }) => s.placeId),
    ).toEqual(plan.stops.slice(0, -1).map((s) => s.placeId));
    expect(body.done).toMatch(/^(Reworked|Swapped|Replaced)/);
  });
  it("explains a no-op instead of inventing a change", async () => {
    const plan = (await (
      await call("generate", { request: req(), demo: true }, app)
    ).json()) as Itinerary;
    const locked = {
      ...plan,
      stops: plan.stops.map((s) => ({ ...s, locked: true })),
    };
    const r = await call(
      "magic-edit",
      { spec: locked, instruction: "make it more romantic" },
      app,
    );
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("NOTHING_TO_CHANGE");
  });
});

describe("Events and feedback", () => {
  it("accepts allow-listed events only", async () => {
    expect(
      (
        await call(
          "events",
          {
            name: "plan_saved",
            installId: "abcdef12-3456",
            props: { stops: 3 },
          },
          app,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "events",
          { name: "keylogger", installId: "abcdef12-3456" },
          app,
        )
      ).status,
    ).toBe(400);
    expect(
      (await call("events", { name: "plan_saved", installId: "x" }, app))
        .status,
    ).toBe(400);
  });
  it("keeps guest feedback on device", async () => {
    const r = await call(
      "feedback",
      {
        planId: "c394c03b-cf7b-4b6a-8f24-69d119cb8e80",
        went: "yes",
        rating: 5,
      },
      app,
    );
    expect(await r.json()).toEqual({ stored: "device" });
  });
});

describe("Account-free share links", () => {
  it("round-trips a redacted plan through the URL fragment", async () => {
    const r = {
      ...req(),
      dietary: "nut allergy",
      accessibility: "step-free",
      affinity: { bar: 2 },
      prompt: "secret",
    };
    const plan = (await (
      await call("generate", { request: r, demo: true }, app)
    ).json()) as Itinerary;
    const url = shareUrl("https://whimway.app/", plan);
    expect(url.startsWith("https://whimway.app/p#")).toBe(true);
    const decoded = decodeShare(url.split("#")[1]);
    expect(decoded.stops.map((s) => s.placeId)).toEqual(
      plan.stops.map((s) => s.placeId),
    );
    expect(decoded.request).toMatchObject({
      prompt: "",
      dietary: "",
      accessibility: "",
      affinity: {},
    });
    expect(decoded.request.location.center).toEqual({ lat: 0, lng: 0 });
    expect(encodeShare(plan).length).toBeLessThan(2500);
  });
  it("rejects tampered links", () => {
    expect(() => decodeShare("bm90LWEtcGxhbg")).toThrow();
  });
});

describe("Crash reports and anchors", () => {
  it("accepts scrubbed crash reports and rejects anything bigger", async () => {
    expect(
      (
        await call(
          "errors",
          { name: "TypeError", message: "x is undefined", platform: "ios" },
          app,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await call(
          "errors",
          { name: "TypeError", message: "x".repeat(500), platform: "ios" },
          app,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await call(
          "errors",
          { name: "E", message: "m", platform: "toaster" },
          app,
        )
      ).status,
    ).toBe(400);
  });
  it("never puts anchored favourites into share links", async () => {
    const plan = (await (
      await call(
        "generate",
        {
          request: { ...req(), anchorPlaceIds: ["gta-bang-bang"] },
          demo: true,
        },
        app,
      )
    ).json()) as Itinerary;
    expect(plan.stops.some((s) => s.placeId === "gta-bang-bang")).toBe(true);
    expect(decodeShare(encodeShare(plan)).request.anchorPlaceIds).toEqual([]);
  });
});

describe("Rate-limit buckets", () => {
  it("analytics and reactions never use up the allowance for saves and edits", async () => {
    for (let i = 0; i < 60; i++)
      expect(
        (
          await call(
            "events",
            { name: "app_opened", installId: "bucket-test-1" },
            app,
          )
        ).status,
      ).toBe(200);
    const plan = (await (
      await call("generate", { request: req(), demo: true }, app)
    ).json()) as Itinerary;
    const edit = await call(
      "magic-edit",
      { spec: plan, instruction: "Change the last stop" },
      app,
    );
    expect(edit.status).toBe(200);
  });
});
