import { describe, expect, it } from "vitest";
import { eventNames } from "@/lib/analytics";
import { emptyProfile, mergeProfiles, type TasteProfile } from "@/lib/profile";
import { readFileSync, readdirSync } from "node:fs";

const profile = (patch: Partial<TasteProfile>): TasteProfile => ({ ...emptyProfile(), ...patch });
const person = (id: string, name: string) => ({ id, name, relation: "friend" as const, likes: [], note: "" });
const fav = (id: string) => ({ id, name: id });

describe("signing in: device and account profiles", () => {
  it("with nothing on the account, keeps the device profile", () => {
    const device = profile({ onboarded: true, name: "Ana" });
    expect(mergeProfiles(device, null)).toBe(device);
  });

  it("a fresh device takes the account's finished profile as it is (welcome back)", () => {
    const account = profile({ onboarded: true, name: "Ana", vibes: ["cozy"], people: [person("p1", "Sam")] });
    const merged = mergeProfiles(emptyProfile(), account);
    expect(merged).toMatchObject({ onboarded: true, name: "Ana", vibes: ["cozy"] });
    expect(merged.people.map((p) => p.name)).toEqual(["Sam"]);
  });

  it("a set-up device keeps its own choices and combines lists from both", () => {
    const device = profile({
      onboarded: true,
      vibes: ["lively"],
      budget: 80,
      favourites: [fav("a"), fav("b")],
      people: [person("p1", "Sam")],
      disliked: ["x"],
      polls: { q1: "a" },
      affinity: { arcade: 2 },
      stats: { plans: 3, edits: 1, shares: 0 },
    });
    const account = profile({
      onboarded: true,
      name: "Ana",
      vibes: ["cozy"],
      budget: 40,
      favourites: [fav("b"), fav("c")],
      people: [person("p1", "Sam (old)"), person("p2", "Lee")],
      disliked: ["x", "y"],
      polls: { q1: "b", q2: "a" },
      affinity: { arcade: 1, museum: -1 },
      stats: { plans: 7, edits: 0, shares: 2 },
    });
    const m = mergeProfiles(device, account);
    expect(m.vibes).toEqual(["lively"]);
    expect(m.budget).toBe(80);
    expect(m.name).toBe("Ana");
    expect(m.favourites.map((f) => f.id)).toEqual(["a", "b", "c"]);
    expect(m.people.map((p) => p.name)).toEqual(["Sam", "Lee"]);
    expect(m.disliked).toEqual(["x", "y"]);
    expect(m.polls).toEqual({ q1: "a", q2: "a" });
    expect(m.affinity).toEqual({ arcade: 1.5, museum: -1 });
    expect(m.stats).toEqual({ plans: 7, edits: 1, shares: 2 });
  });

  it("keeps an active Plus from either side and stays within limits", () => {
    const plus = { active: true, plan: "yearly" as const, since: "2026-01-01", demo: false };
    expect(mergeProfiles(profile({ onboarded: true }), profile({ onboarded: true, plus })).plus).toEqual(plus);
    const many = (prefix: string) => Array.from({ length: 25 }, (_, i) => person(`${prefix}${i}`, `P${i}`));
    const m = mergeProfiles(profile({ onboarded: true, people: many("d") }), profile({ onboarded: true, people: many("a") }));
    expect(m.people).toHaveLength(30);
  });
});

describe("sign-in analytics", () => {
  it("allow-lists the sign-in events in the app and in the latest database migration", () => {
    expect(eventNames).toContain("auth_code_sent");
    expect(eventNames).toContain("auth_signed_in");
    const dir = new URL("../supabase/migrations/", import.meta.url);
    const latest = readdirSync(dir)
      .filter((f) => readFileSync(new URL(f, dir), "utf8").includes("events_name_check"))
      .sort()
      .pop()!;
    const sql = readFileSync(new URL(latest, dir), "utf8");
    for (const name of eventNames) expect(sql).toContain(`'${name}'`);
  });
});
