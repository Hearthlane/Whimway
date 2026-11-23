import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { buildRequest, describe as chips, interpret } from "@/lib/intent";
import { emptyProfile } from "@/lib/profile";

// A Sunday at 3 pm in Toronto, so "Saturday" and "next sunday" are in the future.
const now = DateTime.fromISO("2026-11-22T15:00", { zone: "America/Toronto" });
const plan = (text: string, profile = emptyProfile()) =>
  buildRequest(text, interpret(text, now), profile, now);

describe("what people say they need is applied, not just read", () => {
  it("'sober', 'no bars', 'halal' and 'don't drink' switch on alcohol-free", () => {
    for (const text of [
      "first date, sober, somewhere quiet where we can talk",
      "fun sunday with 2 friends, halal food, no bars",
      "we don't drink, something chill",
      "alcohol-free birthday",
    ])
      expect(plan(text).alcoholFree, text).toBe(true);
    expect(plan("cocktails and dancing").alcoholFree).toBe(false);
  });

  it("onboarding notes count too, and alcohol-free removes nightlife", () => {
    const r = plan("something fun", { ...emptyProfile(), dietary: "Halal only, no bars", interests: ["Nightlife", "Interactive fun"] });
    expect(r.alcoholFree).toBe(true);
    expect(r.interests).toEqual(["Interactive fun"]);
    expect(chips(r).alcohol).toBe("Alcohol-free");
  });

  it("food needs in the words reach the planner", () => {
    const r = plan("full saturday with my two kids, vegetarian, halal", { ...emptyProfile(), dietary: "nut allergy" });
    expect(r.dietary).toBe("nut allergy, halal, vegetarian");
  });

  it("a stated number beats a keyword: 'cheap … under 25 each' is $25 a person", () => {
    const r = plan("cheap fun night w 4 friends friday 7pm, karaoke, under 25 each");
    expect(r.budget).toBe(25);
    expect(r.budgetBasis).toBe("person");
    expect(r.participants).toBe(5);
    expect(plan("max 40pp tonight").budget).toBe(40);
  });

  it("end times set the length: 'home by 4', '10am to 8pm'", () => {
    const lunch = plan("nice quiet lunch tomorrow at noon with my wife, home by 4");
    expect(lunch.startTime).toBe("12:00");
    expect(lunch.duration).toBe(240);
    const day = plan("anniversary saturday 10am to 8pm");
    expect(day.startTime).toBe("10:00");
    expect(day.duration).toBe(600);
    expect(plan("saturday 7pm until 11").duration).toBe(240);
  });

  it("'about 3 hours' is three hours", () => {
    expect(plan("saturday evening, about 3 hours").duration).toBe(180);
  });

  it("a first date is called a first date, not 'your partner'", () => {
    const r = plan("first date saturday evening");
    expect(r.companions).toBe("partner");
    expect(chips(r).who).toBe("A first date");
    expect(chips(plan("dinner with my partner")).who).toBe("The two of you");
  });

  it("'quiet' reads as a calm mood", () => {
    expect(plan("somewhere quiet saturday").vibes).toContain("chill");
  });
});
