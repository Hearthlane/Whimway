import { describe, expect, it } from "vitest";
import { bookingOptions } from "@/lib/booking";
import { summarize, type LoggedEvent } from "@/lib/metrics";
import { candidatesFor } from "@/lib/planner";
import { isAlcoholLed } from "@/lib/planner-filters";
import {
  countPlan,
  editsLeft,
  FREE,
  isPlus,
  plansLeft,
  yearlySaving,
} from "@/lib/plus";
import { emptyProfile } from "@/lib/profile";
import { gtaCatalog } from "@/lib/providers/gta-demo";
import { request } from "./helpers";

describe("Whimway Plus limits", () => {
  const now = new Date("2026-11-12T12:00:00Z");
  it("gives free users a monthly allowance that resets each month", () => {
    let p = emptyProfile();
    expect(plansLeft(p, now)).toBe(FREE.plansPerMonth);
    for (let i = 0; i < FREE.plansPerMonth; i++) p = countPlan(p, now);
    expect(plansLeft(p, now)).toBe(0);
    expect(plansLeft(p, new Date("2026-12-01T12:00:00Z"))).toBe(
      FREE.plansPerMonth,
    );
  });
  it("removes limits for active Plus and restores them when it lapses", () => {
    const plus = {
      ...emptyProfile(),
      plus: {
        active: true,
        plan: "yearly" as const,
        since: "2026-11-01",
        until: "2026-11-20T00:00:00Z",
        demo: true,
      },
    };
    expect(isPlus(plus, now)).toBe(true);
    expect(plansLeft(plus, now)).toBe(Infinity);
    expect(editsLeft(plus, 99)).toBe(Infinity);
    expect(isPlus(plus, new Date("2026-11-21T00:00:00Z"))).toBe(false);
    expect(editsLeft(emptyProfile(), 3)).toBe(0);
    expect(yearlySaving).toBeGreaterThan(40);
  });
});

describe("Booking options", () => {
  const ctx = {
    date: "2026-11-14",
    time: "19:00",
    people: 2,
    mode: "TRANSIT" as const,
    demo: false,
    directionsUrl: "https://maps.example/d",
  };
  const place = (id: string) => gtaCatalog.find((p) => p.id === id)!;
  it("offers a table search for restaurants, tickets for attractions, never both", () => {
    const dinner = bookingOptions(place("gta-pai"), ctx).map((o) => o.kind);
    expect(dinner).toContain("reserve");
    expect(dinner).not.toContain("tickets");
    const aquarium = bookingOptions(place("gta-ripleys"), ctx).map(
      (o) => o.kind,
    );
    expect(aquarium).toContain("tickets");
    expect(aquarium).not.toContain("reserve");
    const park = bookingOptions(place("gta-trinity-bellwoods"), ctx).map(
      (o) => o.kind,
    );
    expect(park).toEqual(["directions", "ride"]);
  });
  it("builds honest, well-formed hand-off links and skips rides when walking", () => {
    const reserve = bookingOptions(place("gta-pai"), ctx).find(
      (o) => o.kind === "reserve",
    )!;
    const url = new URL(reserve.url);
    expect(url.hostname).toBe("www.opentable.ca");
    expect(url.searchParams.get("covers")).toBe("2");
    expect(reserve.hint).toMatch(/isn’t checked/);
    expect(
      bookingOptions(place("gta-pai"), { ...ctx, mode: "WALK" }).some(
        (o) => o.kind === "ride",
      ),
    ).toBe(false);
  });
});

describe("Alcohol-free planning", () => {
  it("drops bars and breweries but keeps restaurants and game venues", () => {
    const bar = gtaCatalog.find((p) => p.id === "gta-bar-raval")!;
    const brewery = gtaCatalog.find((p) => p.id === "gta-steam-whistle")!;
    const restaurant = gtaCatalog.find((p) => p.id === "gta-bar-buca")!;
    expect(isAlcoholLed(bar)).toBe(true);
    expect(isAlcoholLed(brewery)).toBe(true);
    expect(isAlcoholLed(restaurant)).toBe(false);
    const r = {
      ...request(),
      alcoholFree: true,
      area: { ...request().area, locked: false },
    };
    const kept = candidatesFor(r, gtaCatalog);
    expect(kept.some((p) => p.id === "gta-steam-whistle")).toBe(false);
    expect(kept.some((p) => p.id === "gta-pai")).toBe(true);
  });
});

describe("Metrics summary", () => {
  const ev = (
    name: string,
    installId: string,
    at: string,
    props?: LoggedEvent["props"],
  ): LoggedEvent => ({ name, installId, at, props });
  const now = new Date("2026-11-12T18:00:00Z");
  const events = [
    ev("app_opened", "a", "2026-11-01T10:00:00Z"),
    ev("plan_generated", "a", "2026-11-01T10:01:00Z", { ms: 2000 }),
    ev("plan_generated", "a", "2026-11-04T10:00:00Z", { ms: 4000 }),
    ev("plan_saved", "a", "2026-11-04T10:02:00Z"),
    ev("app_opened", "b", "2026-11-12T09:00:00Z"),
    ev("plan_generated", "b", "2026-11-12T09:01:00Z", { ms: 3000 }),
    ev("plan_generated", "b", "2026-11-12T09:05:00Z", { ms: 9000 }),
    ev("feedback_submitted", "a", "2026-11-05T10:00:00Z", { went: "yes" }),
    ev("feedback_submitted", "b", "2026-11-12T12:00:00Z", { went: "no" }),
    ev("plan_pulse", "b", "2026-11-12T09:02:00Z", {
      value: -1,
      reason: "too_pricey",
    }),
    ev("paywall_viewed", "a", "2026-11-04T11:00:00Z"),
    ev("paywall_viewed", "b", "2026-11-12T09:06:00Z"),
    ev("plus_started", "a", "2026-11-04T11:01:00Z"),
  ];
  it("computes funnel, history, repeat use and conversion", () => {
    const s = summarize(events, now);
    expect(s.totals.installs).toBe(2);
    expect(s.totals.plans).toBe(4);
    expect(s.funnel.find((f) => f.name === "plan_generated")!.installs).toBe(2);
    expect(s.series).toHaveLength(14);
    expect(s.series.at(-1)).toMatchObject({
      day: "2026-11-12",
      plans: 2,
      active: 1,
    });
    // Same-session replans do not count as coming back; a return three days later does.
    expect(s.repeat).toEqual({ cohort: 2, within7d: 1, within30d: 1 });
    expect(s.wentRate).toBe(0.5);
    expect(s.paywallConversion).toBe(0.5);
    expect(s.pulseReasons).toEqual({ too_pricey: 1 });
    expect(s.timeToPlanMs).toBe(4000);
  });
  it("handles an empty log", () => {
    const s = summarize([], now);
    expect(s.totals.installs).toBe(0);
    expect(s.wentRate).toBeNull();
  });
});
