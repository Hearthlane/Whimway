import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { emptyProfile, TasteProfile } from "@/lib/profile";
import { today, whenLabel, type PlanSummary } from "@/lib/today";

const zone = "America/Toronto";
const t = (s: string) => DateTime.fromISO(s, { zone });
const stop = (name: string, from: string, to: string) => ({
  placeId: name.toLowerCase(),
  name,
  kind: "sights",
  at: t(from).toISO()!,
  until: t(to).toISO()!,
  mapsUrl: `https://maps.example/${name}`,
});
const plan = (stops: ReturnType<typeof stop>[], title = "Night out"): PlanSummary => ({
  meta: {
    title,
    date: stops[0].at.slice(0, 10),
    startTime: stops[0].at.slice(11, 16),
    stops: stops.length,
    brief: stops,
  },
});
const night = plan([
  stop("Dinner", "2026-11-22T18:00", "2026-11-22T19:15"),
  stop("Arcade", "2026-11-22T19:30", "2026-11-22T21:00"),
  stop("Dessert", "2026-11-22T21:10", "2026-11-22T21:50"),
]);

describe("home screen: today's plan", () => {
  it("shows nothing when no plan is ahead", () => {
    expect(today({ a: night }, t("2026-11-22T23:00"))).toBeUndefined();
    expect(today({}, t("2026-11-22T12:00"))).toBeUndefined();
  });

  it("before the day, shows when and the stops", () => {
    const s = today({ a: night }, t("2026-11-21T12:00"))!;
    expect(s.live).toBe(false);
    expect(s.label).toBe("Coming up");
    expect(s.headline).toBe("Next up: Tomorrow, 6:00 PM");
    expect(s.sub).toBe("Dinner → Arcade → Dessert");
  });

  it("counts down in the two hours before the first stop", () => {
    const s = today({ a: night }, t("2026-11-22T16:35"))!;
    expect(s.live).toBe(true);
    expect(s.label).toBe("Today");
    expect(s.headline).toBe("Starts in 1 h 25 min");
    expect(s.sub).toBe("Dinner at 6:00 PM");
    expect(s.directions).toContain("Dinner");
  });

  it("during a stop, shows it, what's next, progress and directions to the next", () => {
    const s = today({ a: night }, t("2026-11-22T19:45"))!;
    expect(s.label).toBe("Happening now");
    expect(s.headline).toBe("Now: Arcade");
    expect(s.sub).toBe("Then Dessert at 9:10 PM");
    expect([s.done, s.total]).toEqual([1, 3]);
    expect(s.directions).toContain("Dessert");
  });

  it("between stops, points to the next one; on the last stop, says so", () => {
    expect(today({ a: night }, t("2026-11-22T19:20"))!.headline).toBe(
      "Next: Arcade",
    );
    const last = today({ a: night }, t("2026-11-22T21:30"))!;
    expect(last.headline).toBe("Now: Dessert");
    expect(last.sub).toBe("Last stop, until 9:50 PM");
  });

  it("picks the soonest plan and ignores ones more than a week away", () => {
    const later = plan([stop("Brunch", "2026-11-24T11:00", "2026-11-24T12:00")]);
    const far = plan([stop("Show", "2026-12-20T19:00", "2026-12-20T21:00")]);
    expect(today({ b: later, a: night, c: far }, t("2026-11-22T10:00"))!.id).toBe("a");
    expect(today({ c: far }, t("2026-11-22T10:00"))).toBeUndefined();
    expect(whenLabel(later, t("2026-11-22T10:00"))).toBe("Tuesday, 11:00 AM");
  });
});

describe("profile: people you go out with", () => {
  it("defaults to none and keeps a valid person", () => {
    expect(emptyProfile().people).toEqual([]);
    const p = TasteProfile.parse({
      ...emptyProfile(),
      people: [{ id: "p1", name: "Sam", relation: "friend", likes: ["games"] }],
    });
    expect(p.people[0]).toEqual({ id: "p1", name: "Sam", relation: "friend", likes: ["games"], note: "" });
  });

  it("rejects a nameless person or an unknown relation", () => {
    const bad = (person: object) =>
      TasteProfile.safeParse({ ...emptyProfile(), people: [person] }).success;
    expect(bad({ id: "p", name: "", relation: "friend" })).toBe(false);
    expect(bad({ id: "p", name: "Sam", relation: "boss" })).toBe(false);
  });

  it("a full people list still fits the account's 16 KB preferences limit alongside typical favourites", () => {
    const profile = TasteProfile.parse({
      ...emptyProfile(),
      people: Array.from({ length: 30 }, (_, i) => ({
        id: `p${i}m3k9x2`,
        name: "Alexandra Montgomery",
        relation: "friend",
        likes: ["japanese", "games", "shows", "drinks"],
        note: "Vegetarian, prefers somewhere quiet",
      })),
      favourites: Array.from({ length: 25 }, (_, i) => ({
        id: `ChIJ${"x".repeat(23)}${i}`,
        name: "A Restaurant With A Long Name",
        area: "queen-west",
        category: "Japanese restaurant",
      })),
    });
    expect(() =>
      TasteProfile.parse({ ...profile, people: [...profile.people, profile.people[0]] }),
    ).toThrow();
    expect(JSON.stringify({ taste: profile }).length).toBeLessThan(16384);
  });
});
