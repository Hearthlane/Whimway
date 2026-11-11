import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import {
  interpret,
  buildRequest,
  describe as describeRequest,
} from "@/lib/intent";
import { interpretEdit, type EditStop } from "@/lib/magic-edit";
import { applyFeedback, emptyProfile } from "@/lib/profile";
import { areaByKey, findArea } from "@/lib/areas";
import { Planner, candidatesFor, score } from "@/lib/planner";
import {
  FixturePlaces,
  FixtureRoutes,
  FixtureAI,
} from "@/lib/providers/fixtures";
import { gtaCatalog } from "@/lib/providers/gta-demo";
import { navigationUrl, stopDirectionsUrl } from "@/lib/navigation";

// Wednesday 11 Nov 2026, 3pm in Toronto.
const now = DateTime.fromISO("2026-11-11T15:00", { zone: "America/Toronto" });
const profile = {
  ...emptyProfile(),
  budget: 40,
  mode: "TRANSIT" as const,
  homeArea: "queen-west",
};

describe("Natural-language intent", () => {
  it("understands the flagship date-night prompt", () => {
    const text =
      "Plan a spontaneous Saturday night with my girlfriend. We have $100 total, we're near Toronto, we want something romantic but adventurous, and we don't want to drive too far.";
    const d = interpret(text, now);
    expect(d.companions).toBe("partner");
    expect(d.participants).toBe(2);
    expect(d.budget).toEqual({ amount: 100, basis: "total" });
    expect(d.date).toBe("2026-11-14");
    expect(d.startTime).toBe("18:30");
    expect(d.vibes).toEqual(
      expect.arrayContaining(["romantic", "adventurous"]),
    );
    expect(d.mode).toBe("DRIVE");
    expect(d.radius).toBe(8000);
    const r = buildRequest(text, d, profile, now);
    expect(r.budget).toBe(50); // per person
    expect(r.budgetBasis).toBe("total");
    expect(r.location.name).toBe("Downtown Toronto");
    expect(describeRequest(r, now).budget).toBe("$100 total · $50/person");
  });
  it("reads per-person budgets and friend counts", () => {
    const d = interpret(
      "An adventurous Saturday with three friends under $40 each.",
      now,
    );
    expect(d.companions).toBe("friends");
    expect(d.participants).toBe(4);
    expect(d.budget).toEqual({ amount: 40, basis: "person" });
    const r = buildRequest("x", d, profile, now);
    expect(r.budget).toBe(40);
    expect(r.participants).toBe(4);
  });
  it("treats rainy prompts as indoor and keeps cafés", () => {
    const d = interpret(
      "Plan a cozy rainy afternoon with cafés and hidden gems.",
      now,
    );
    expect(d.indoorOnly).toBe(true);
    expect(d.vibes).toContain("cozy");
    expect(d.interests).toEqual(
      expect.arrayContaining(["Food & drinks", "Hidden gems"]),
    );
    expect(d.interests).not.toContain("Outdoors");
    expect(d.startTime).toBe("16:00"); // afternoon already passed today → soon
  });
  it("handles tonight, explicit clock times and transit", () => {
    const d = interpret(
      "Something cinematic and romantic tonight at 8pm, we'll take the TTC",
      now,
    );
    expect(d.date).toBe("2026-11-11");
    expect(d.startTime).toBe("20:00");
    expect(d.mode).toBe("TRANSIT");
    expect(d.vibes).toEqual(["romantic", "cinematic"]);
  });
  it("picks up GTA areas and occasions", () => {
    expect(findArea("birthday dinner in Richmond Hill")?.key).toBe(
      "richmond-hill",
    );
    expect(findArea("north york ramen")?.key).toBe("north-york");
    expect(
      interpret("Surprise me with a memorable birthday experience", now)
        .occasion,
    ).toBe("birthday");
    expect(
      interpret("Surprise me with a memorable birthday experience", now)
        .interests,
    ).toContain("Surprise me");
  });
  it("does not mistake Eaton or words containing keywords", () => {
    const d = interpret("meet near the eaton centre", now);
    expect(d.interests).not.toContain("Food & drinks");
  });
  it("falls back to profile defaults and a sensible evening start", () => {
    const r = buildRequest(
      "",
      interpret("", now),
      { ...profile, interests: ["Arts & culture"] },
      now,
    );
    expect(r.mode).toBe("TRANSIT");
    expect(r.location.name).toBe("Queen West & Ossington");
    expect(r.startTime).toBe("18:30");
    expect(r.interests).toEqual(["Arts & culture"]);
    expect(r.budget).toBe(40);
  });
  it("rolls to tomorrow evening when it is already late", () => {
    const late = now.set({ hour: 22, minute: 10 });
    const r = buildRequest("", interpret("", late), profile, late);
    expect(r.date).toBe("2026-11-12");
    expect(r.startTime).toBe("18:30");
  });
});

const stop = (
  name: string,
  category: string,
  types: string[],
  priceHigh: number | null,
  locked = false,
): EditStop => ({
  placeId: name,
  locked,
  name,
  category,
  types,
  priceHigh,
  travel: 800,
});
const evening = [
  stop("Ripley's Aquarium", "aquarium", ["aquarium"], 50),
  stop("Pai Northern Thai Kitchen", "thai restaurant", ["restaurant"], 40),
  stop("Trinity Bellwoods Park", "park", ["park"], 0),
];
const req = {
  budget: 50,
  mode: "WALK" as const,
  duration: 240,
  vibes: [],
  indoorOnly: false,
  area: { center: { lat: 0, lng: 0 }, radius: 2000, locked: true },
};

describe("Magic Edit interpretation", () => {
  it("replaces only the dinner when asked", () => {
    const op = interpretEdit(
      "Replace dinner with something adventurous",
      evening,
      req,
    );
    expect(op.kind).toBe("replace");
    expect(op.targets).toEqual([1]);
    expect(op.patch.vibes).toContain("adventurous");
  });
  it("keeps the first two stops and changes the last", () => {
    const op = interpretEdit(
      "Keep the first two stops, but change the last one",
      evening,
      req,
    );
    expect(op.targets).toEqual([2]);
  });
  it("makes it cheaper by swapping the priciest paid stops and lowering budget", () => {
    const op = interpretEdit("Make it cheaper", evening, req);
    expect(op.targets).toEqual([0]);
    expect(op.patch.budget).toBe(30);
  });
  it("moves only outdoor stops indoors when the weather changes", () => {
    const op = interpretEdit(
      "The weather changed; make it indoors",
      evening,
      req,
    );
    expect(op.targets).toEqual([2]);
    expect(op.patch.indoorOnly).toBe(true);
  });
  it("reduces walking by replacing the farthest stop", () => {
    const far = evening.map((s, i) => ({ ...s, travel: [0, 300, 2500][i] }));
    expect(interpretEdit("Reduce walking", far, req).targets).toEqual([2]);
  });
  it("re-tunes vibe by replacing stops that do not fit", () => {
    const op = interpretEdit("Make it more romantic", evening, req);
    expect(op.kind).toBe("replace");
    expect(op.targets.length).toBeGreaterThan(0);
    expect(op.targets.length).toBeLessThan(3);
  });
  it("never targets a user-locked stop", () => {
    const locked = evening.map((s, i) => ({ ...s, locked: i === 1 }));
    expect(
      interpretEdit("Replace dinner with tacos", locked, req).targets,
    ).not.toContain(1);
    expect(
      interpretEdit("Surprise me, change everything", locked, req).targets,
    ).toEqual([0, 2]);
  });
  it("removes and adds stops structurally", () => {
    expect(interpretEdit("Drop the park", evening, req)).toMatchObject({
      kind: "remove",
      targets: [2],
    });
    const add = interpretEdit("Add dessert at the end", evening, req);
    expect(add.kind).toBe("add");
    expect(add.patch.duration).toBe(300);
  });
  it("reports a no-op honestly", () => {
    const free = evening.map((s) => ({ ...s, priceHigh: 0 }));
    expect(interpretEdit("Make it cheaper", free, req).kind).toBe("noop");
  });
});

describe("Personalization", () => {
  it("nudges category affinity from feedback and excludes disliked places", () => {
    const p = applyFeedback(
      emptyProfile(),
      {
        planId: "c394c03b-cf7b-4b6a-8f24-69d119cb8e80",
        went: "yes",
        rating: 5,
        stops: [
          { placeId: "a", category: "Cocktail Bar", reaction: 1 },
          { placeId: "b", category: "museum", reaction: -1 },
        ],
        note: "",
      },
      ["cocktail bar", "museum"],
    );
    expect(p.affinity["cocktail bar"]).toBe(0.7);
    expect(p.affinity.museum).toBe(-0.3);
    expect(p.disliked).toEqual(["b"]);
  });
  it("bounds affinity", () => {
    let p = emptyProfile();
    for (let i = 0; i < 20; i++)
      p = applyFeedback(p, {
        planId: "c394c03b-cf7b-4b6a-8f24-69d119cb8e80",
        went: "yes",
        stops: [{ placeId: "x", category: "bar", reaction: 1 }],
        note: "",
      });
    expect(p.affinity.bar).toBe(3);
  });
  it("affinity reorders ranking but never overrides constraints", () => {
    const bar = gtaCatalog.find((p) => p.id === "gta-bar-raval")!;
    const museum = gtaCatalog.find((p) => p.id === "gta-rom")!;
    expect(score(bar, { affinity: { "cocktail bar": 3 } })).toBeGreaterThan(
      score(museum, { affinity: { "cocktail bar": 3 } }),
    );
    const r = buildRequest("rainy", interpret("rainy", now), profile, now);
    expect(
      candidatesFor(r, gtaCatalog).some((p) => p.types.includes("park")),
    ).toBe(false);
  });
});

describe("GTA demo planning end-to-end", () => {
  const planner = (r: ReturnType<typeof buildRequest>) =>
    new Planner(
      new FixturePlaces(r),
      new FixtureRoutes(),
      new FixtureAI(),
      true,
    );
  const future = DateTime.now().setZone("America/Toronto").plus({ days: 3 });
  const make = (text: string) => {
    const r = buildRequest(text, interpret(text, future), profile, future);
    return { ...r, date: future.toISODate()!, startTime: "18:30" };
  };
  it("builds a 2–4 stop date with one meal, real catalogue IDs, timing and costs", async () => {
    const r = make(
      "romantic but adventurous night with my girlfriend in Queen West, $100 total",
    );
    const plan = await planner(r).generate(r);
    expect(plan.stops.length).toBeGreaterThanOrEqual(2);
    expect(plan.stops.length).toBeLessThanOrEqual(4);
    expect(plan.stops.every((s) => s.placeId.startsWith("gta-"))).toBe(true);
    expect(
      plan.stops.filter((s) => /restaurant/.test(s.place.types.join())).length,
    ).toBeLessThanOrEqual(1);
    expect(plan.legs).toHaveLength(plan.stops.length - 1);
    expect(plan.cost.currency).toBe("CAD");
    expect(plan.demo).toBe(true);
    for (let i = 1; i < plan.stops.length; i++)
      expect(plan.stops[i].arrival >= plan.stops[i - 1].departure).toBe(true);
  });
  it("magic edit replaces only the targeted stop and keeps the rest verbatim", async () => {
    const r = make("romantic dinner night with my partner downtown");
    const p = planner(r);
    const plan = await p.generate(r);
    const {
      plan: edited,
      op,
      changed,
    } = await planner(r).magicEdit(
      plan,
      "Keep the first two stops, but change the last one",
    );
    expect(op.targets).toEqual([plan.stops.length - 1]);
    expect(edited.stops.slice(0, -1).map((s) => s.placeId)).toEqual(
      plan.stops.slice(0, -1).map((s) => s.placeId),
    );
    expect(changed).toHaveLength(1);
    expect(changed[0]).not.toBe(plan.stops.at(-1)!.placeId);
    expect(edited.title).toBe(plan.title);
    expect(edited.stops.every((s) => !s.locked)).toBe(true);
  });
  it("magic edit preserves user locks and can add a stop", async () => {
    const r = make("chill afternoon with friends downtown");
    const plan = await planner(r).generate(r);
    const spec = {
      ...plan,
      stops: plan.stops.map((s, i) => ({ ...s, locked: i === 0 })),
    };
    const { plan: edited } = await planner(r).magicEdit(
      spec,
      "Add dessert at the end",
    );
    expect(edited.stops).toHaveLength(plan.stops.length + 1);
    expect(edited.stops[0]).toMatchObject({
      placeId: plan.stops[0].placeId,
      locked: true,
    });
    expect(edited.request.duration).toBe(r.duration + 60);
  });
  it("magic edit indoors swaps outdoor stops for indoor ones", async () => {
    const r = make("outdoorsy park walk and coffee in Queen West");
    const plan = await planner(r).generate(r);
    if (!plan.stops.some((s) => s.place.types.includes("park"))) return;
    const { plan: edited } = await planner(r).magicEdit(
      plan,
      "It's raining now, make it indoors",
    );
    expect(edited.stops.some((s) => s.place.types.includes("park"))).toBe(
      false,
    );
    expect(edited.request.indoorOnly).toBe(true);
  });
});

describe("Transit navigation", () => {
  it("links individual transit legs because Maps URLs drop transit waypoints", () => {
    const url = new URL(
      stopDirectionsUrl(
        { point: { lat: 1, lng: 2 }, placeId: "abc" },
        "TRANSIT",
        { lat: 3, lng: 4 },
      ),
    );
    expect(url.searchParams.get("travelmode")).toBe("transit");
    expect(url.searchParams.get("origin")).toBe("3,4");
    expect(areaByKey("markham")?.city).toBe("Markham");
    expect(navigationUrl).toBeTypeOf("function");
  });
});
