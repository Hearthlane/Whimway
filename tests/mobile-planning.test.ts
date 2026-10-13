import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { applyIntent, budgetPresets, choosePreferences, defaultStart, relativeDate, remainingSteps, requestFromDraft, withLocation, type Draft } from "../apps/mobile/src/core/planning";
import { commitPlan } from "../apps/mobile/src/core/plan-commit";
import { fixtureLocations } from "@/lib/providers/fixtures";
import { publicSpec } from "@/lib/storage";
import { spec } from "./helpers";
const now = DateTime.fromISO("2026-10-13T20:00:00Z");
const empty = (): Draft => ({ prompt: "", known: [], demo: false });

describe("Adaptive native planning", () => {
  it("preserves explicit guided controls when late intent extraction returns conflicting answers", () => {
    const draft: Draft = { ...empty(), location: fixtureLocations[0], interests: ["Outdoors"], budget: 30, companion: "friends", participants: 4,
      date: "2026-10-20", dateChoice: "specific", startTime: "14:00", known: ["interests", "budget", "companion", "date", "startTime"] };
    const next = applyIntent(draft, { interests: ["Nightlife"], budget: 200, companion: "date", participants: 2, dateChoice: "tomorrow", startTime: "20:00", energy: "active", warnings: [] }, now);
    expect(next).toMatchObject({ interests: ["Outdoors"], budget: 30, companion: "friends", participants: 4, date: "2026-10-20", dateChoice: "specific", startTime: "14:00", energy: "active" });
  });
  it("can prefill a previously skipped optional question without replacing a real choice", () => {
    const next = applyIntent({ ...empty(), known: ["budget"] }, { budget: 70, warnings: [] }, now);
    expect(next.budget).toBe(70);
  });
  it("lets explicit prompt preferences replace saved profile defaults", () => {
    const next = applyIntent({ ...empty(), known: ["interests", "budget"], preferenceFields: ["interests", "budget"], interests: ["Outdoors"], budget: 60 },
      { interests: ["Arts & culture"], budget: 80, warnings: [] }, now);
    expect(next).toMatchObject({ interests: ["Arts & culture"], budget: 80, preferenceFields: [] });
  });
  it("treats a manually edited profile default as an explicit choice thereafter", () => {
    const source: Draft = { ...empty(), known: ["budget"], preferenceFields: ["budget"], budget: 70, savedBudget: { amount: 70, currency: "CAD" } };
    const chosen = choosePreferences(source, { budget: 100 });
    expect(withLocation(chosen, fixtureLocations[0], now).budget).toBe(100);
    expect(applyIntent(chosen, { budget: 30, warnings: [] }, now).budget).toBe(100);
    expect(chosen.preferenceFields).not.toContain("budget");
    expect(chosen.savedBudget).toBeUndefined();
  });
  it("reuses a saved budget only after confirming the same destination currency", () => {
    const source: Draft = { ...empty(), preferenceFields: ["budget"], savedBudget: { amount: 70, currency: "CAD" } };
    const toronto = withLocation(source, fixtureLocations[0], now);
    expect(toronto.budget).toBe(70);
    expect(toronto.known).toContain("budget");
    const tokyo = withLocation(toronto, fixtureLocations[1], now);
    expect(tokyo.budget).toBeUndefined();
    expect(remainingSteps(tokyo)).toContain("budget");
    expect(requestFromDraft(tokyo, now).budget).toBe(6000);
    const supplied = applyIntent(tokyo, { budget: 12000, warnings: [] }, now);
    expect(withLocation(supplied, fixtureLocations[0], now).budget).toBe(12000);
  });
  it("skips supplied prompt answers while keeping unknown preferences available", () => {
    const draft = applyIntent(empty(), {
      locationQuery: "Eaton Centre", dateChoice: "tomorrow", companion: "date", participants: 2,
      interests: ["Food & drinks", "Interactive fun"], budget: 70, vibes: ["romantic"], warnings: [],
    }, now);
    expect(remainingSteps(draft)).toEqual(["location", "energy", "duration"]);
    expect(draft.location).toBeUndefined();
    const located = withLocation(draft, fixtureLocations[0], now);
    expect(requestFromDraft(located, now)).toMatchObject({ date: "2026-10-14", budget: 70, participants: 2, companion: "date" });
  });
  it("resolves relative dates using the destination on a different calendar day", () => {
    const tokyo = withLocation(applyIntent(empty(), { dateChoice: "tomorrow", startTime: "15:30", warnings: [] }, now), fixtureLocations[1], now);
    expect(tokyo.date).toBe("2026-10-15");
    expect(tokyo.startTime).toBe("15:30");
    expect(defaultStart(fixtureLocations[0], now).date).toBe("2026-10-14");
  });
  it("preserves an explicit date and start time when confirming another area", () => {
    const draft = applyIntent(empty(), { dateChoice: "specific", date: "2026-10-20", startTime: "18:30", warnings: [] }, now);
    const next = withLocation(draft, fixtureLocations[1], now);
    expect(next).toMatchObject({ date: "2026-10-20", startTime: "18:30" });
  });
  it("uses visible defaults for skipped or cleared optional controls", () => {
    const draft = withLocation({ ...empty(), budget: undefined, duration: undefined }, fixtureLocations[0], now);
    expect(requestFromDraft(draft, now)).toMatchObject({ duration: 240, budget: 60, mode: "WALK", participants: 1, date: "2026-10-14" });
    expect(remainingSteps(draft)).toContain("budget");
  });
  it("rejects malformed custom inputs with a concise recovery message", () => {
    const draft = withLocation(empty(), fixtureLocations[0], now);
    expect(() => requestFromDraft({ ...draft, budget: NaN }, now)).toThrow("Enter a budget");
    expect(() => requestFromDraft({ ...draft, duration: 10 }, now)).toThrow("60 to 720");
    expect(() => requestFromDraft({ ...draft, startTime: "2:" }, now)).toThrow("HH:mm");
    expect(() => requestFromDraft({ ...draft, date: "2027-02-30" }, now)).toThrow("local time");
  });
  it("never silently schedules a today request in yesterday's clock slot", () => {
    const late = DateTime.fromISO("2026-10-14T03:30:00Z"); // 23:30 Toronto.
    expect(() => relativeDate("today", fixtureLocations[0], late)).toThrow("Choose tomorrow");
    const draft = applyIntent({ ...empty(), location: fixtureLocations[0] }, { dateChoice: "today", budget: 70, warnings: [] }, late);
    expect(draft.budget).toBe(70);
    expect(remainingSteps(draft)).toContain("date");
    expect(draft.known).not.toContain("date");
  });
  it("allows a supplied upcoming time late today and rejects past dates before sending", () => {
    const late = DateTime.fromISO("2026-10-14T03:30:00Z");
    const draft = applyIntent({ ...empty(), location: fixtureLocations[0] }, { dateChoice: "today", startTime: "23:45", warnings: [] }, late);
    expect(requestFromDraft(draft, late)).toMatchObject({ date: "2026-10-13", startTime: "23:45" });
    expect(() => requestFromDraft({ ...draft, startTime: "10:00" }, late)).toThrow("future start");
  });
  it("scales local budget preferences without pretending to convert exchange rates", () => {
    expect(budgetPresets("JPY")).toEqual([3000, 6000, 12000]);
    expect(requestFromDraft(withLocation(empty(), fixtureLocations[1], now), now).budget).toBe(6000);
  });
  it("scrubs optional personal preferences from public plan copies", () => {
    const original = spec();
    original.request.companion = "date";
    original.request.energy = "chill";
    original.request.vibes = ["romantic"];
    const copy = publicSpec(original);
    expect(copy.request.companion).toBeUndefined();
    expect(copy.request.energy).toBeUndefined();
    expect(copy.request.vibes).toBeUndefined();
    expect(original.request.companion).toBe("date");
  });
});
describe("Atomic native plan commits", () => {
  it("keeps the displayed plan unchanged when persistence fails", async () => {
    let displayed = "previous";
    let reminders = false;
    await expect(commitPlan("edited", { persist: async () => { throw new Error("Storage full"); }, commit: value => { displayed = value; }, refreshReminders: async () => { reminders = true; } })).rejects.toThrow("Storage full");
    expect(displayed).toBe("previous");
    expect(reminders).toBe(false);
  });
  it("does not display or schedule a result canceled during persistence", async () => {
    const controller = new AbortController();
    let displayed = "previous";
    let reminders = false;
    await expect(commitPlan("edited", { persist: async () => { controller.abort(); }, commit: value => { displayed = value; }, refreshReminders: async () => { reminders = true; } }, { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(displayed).toBe("previous");
    expect(reminders).toBe(false);
  });
  it("hydrates in memory without overwriting stored references", async () => {
    let persisted = "latest edited references";
    let displayed = "previous";
    const events: string[] = [];
    await commitPlan("hydrated", { persist: async value => { persisted = value; }, commit: value => { displayed = value; events.push("display"); }, refreshReminders: async () => { events.push("reminders"); } }, { persist: false });
    expect(persisted).toBe("latest edited references");
    expect(displayed).toBe("hydrated");
    expect(events).toEqual(["display", "reminders"]);
  });
});
